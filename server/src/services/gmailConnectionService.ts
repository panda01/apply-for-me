/**
 * Database layer for GmailConnection rows plus the only place outside
 * gmailOAuthService that touches the OAuth client. Keeps the persistence
 * concerns (which fields go in which column, how to upsert by google_email)
 * separate from the protocol concerns (how to talk to Google).
 *
 * Public surface:
 *
 *   - createConnectionFromTokens(): write the tokens returned by the OAuth
 *     code-exchange to a GmailConnection row. Upserts by google_email so
 *     reconnecting an already-linked inbox updates that row in place.
 *
 *   - listConnections(): return every connection minus the secret fields,
 *     for display in the integrations UI.
 *
 *   - deleteConnection(): revoke the refresh token at Google's end, then
 *     delete the row. The revoke happens BEFORE the delete so a Google-side
 *     failure (e.g. already-revoked) is observable in logs and the row is
 *     not orphaned with a dangling refresh token.
 *
 *   - getValidAccessToken(): return an access token guaranteed fresh for the
 *     next ACCESS_TOKEN_REFRESH_SKEW_MS, refreshing+persisting if needed.
 *     This is the function future Gmail-API callers will use to get a token
 *     to put in the Authorization header.
 */

import { GmailConnection } from "../../prisma/generated/client/client.js";
import prisma from "../prismaClient.js";
import {
  exchangeCodeForTokens as exchangeOAuthCode,
  refreshAccessToken as refreshOAuthAccessToken,
  revokeRefreshToken as revokeOAuthRefreshToken,
} from "./gmailOAuthService.js";

/**
 * How long before an access token's recorded expiry we treat it as expired
 * and proactively refresh. Avoids handing out a token that's about to expire
 * mid-request. 60 seconds is comfortable headroom for Google's typical
 * 3600-second access token lifetime.
 */
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60 * 1000;

/**
 * Subset of GmailConnection safe to expose over HTTP — strips the token
 * fields so they never leak in API responses. The route layer returns this
 * shape; never the raw model.
 */
export interface PublicGmailConnection {
  id: number;
  google_email: string;
  scopes: string;
  access_token_expires_at: string;
  created_date: string;
  updated_date: string;
}

/**
 * Strips secret fields off a GmailConnection row so it's safe to return over
 * HTTP. Centralized so route handlers can't accidentally forget to omit a
 * token field.
 *
 * @param {GmailConnection} row - The full row from Prisma
 * @returns {PublicGmailConnection} The HTTP-safe projection
 */
function toPublicConnection(row: GmailConnection): PublicGmailConnection {
  return {
    id: row.id,
    google_email: row.google_email,
    scopes: row.scopes,
    access_token_expires_at: row.access_token_expires_at.toISOString(),
    created_date: row.created_date.toISOString(),
    updated_date: row.updated_date.toISOString(),
  };
}

/**
 * Persists the tokens returned by exchangeCodeForTokens. Upserts by
 * google_email so re-connecting an inbox updates the existing row (and its
 * refresh token) rather than creating a duplicate, which would violate the
 * @unique constraint anyway.
 *
 * @param {string} code - The authorization code from Google's callback
 * @returns {Promise<PublicGmailConnection>} The persisted row, minus token fields
 */
export async function createConnectionFromCode(code: string): Promise<PublicGmailConnection> {
  const tokens = await exchangeOAuthCode(code);
  const upserted = await prisma.gmailConnection.upsert({
    where: { google_email: tokens.googleEmail },
    create: {
      google_email: tokens.googleEmail,
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken,
      access_token_expires_at: tokens.accessTokenExpiresAt,
      scopes: tokens.scopes,
    },
    update: {
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken,
      access_token_expires_at: tokens.accessTokenExpiresAt,
      scopes: tokens.scopes,
    },
  });
  return toPublicConnection(upserted);
}

/**
 * Lists every persisted GmailConnection in created-date-descending order so
 * the most recently connected inbox appears first.
 *
 * @returns {Promise<PublicGmailConnection[]>} The list with token fields omitted
 */
export async function listConnections(): Promise<PublicGmailConnection[]> {
  const rows = await prisma.gmailConnection.findMany({
    orderBy: { created_date: "desc" },
  });
  return rows.map(toPublicConnection);
}

/**
 * Revokes the refresh token at Google's end, then deletes the row locally.
 * Order matters: a revoke failure (e.g. already-revoked) is logged but does
 * not block the delete — the user's intent is "disconnect," and stranding a
 * dead row would be worse than the small risk of leaving a revoked-but-
 * unforgotten token at Google.
 *
 * @param {number} id - The GmailConnection.id to disconnect
 * @returns {Promise<{ deleted: PublicGmailConnection; revokeWarning: string | null }>}
 *   The deleted row (post-revoke) plus an optional warning if the revoke step
 *   reported an error.
 */
export async function deleteConnection(id: number): Promise<{
  deleted: PublicGmailConnection;
  revokeWarning: string | null;
}> {
  const existing = await prisma.gmailConnection.findUnique({ where: { id } });
  if (existing === null) {
    throw new Error(`GmailConnection ${String(id)} not found`);
  }

  let revokeWarning: string | null = null;
  try {
    await revokeOAuthRefreshToken(existing.refresh_token);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    revokeWarning = `Google rejected the revoke request: ${errorMessage}`;
  }

  const deleted = await prisma.gmailConnection.delete({ where: { id } });
  return { deleted: toPublicConnection(deleted), revokeWarning };
}

/**
 * Returns an access token guaranteed valid for at least the next
 * ACCESS_TOKEN_REFRESH_SKEW_MS. Refreshes and persists transparently when the
 * cached token is at or past its skew-adjusted expiry. Future Gmail-API
 * callers should always go through this rather than reading
 * GmailConnection.access_token directly.
 *
 * @param {number} connectionId - The GmailConnection.id to use
 * @returns {Promise<string>} A valid access token
 * @throws {Error} If the connection doesn't exist or the refresh fails
 */
export async function getValidAccessToken(connectionId: number): Promise<string> {
  const connection = await prisma.gmailConnection.findUnique({ where: { id: connectionId } });
  if (connection === null) {
    throw new Error(`GmailConnection ${String(connectionId)} not found`);
  }

  const refreshThresholdEpochMs = Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS;
  const expiryEpochMs = connection.access_token_expires_at.getTime();
  const isStillFresh = expiryEpochMs > refreshThresholdEpochMs;
  if (isStillFresh) {
    return connection.access_token;
  }

  const refreshed = await refreshOAuthAccessToken(connection.refresh_token);
  await prisma.gmailConnection.update({
    where: { id: connectionId },
    data: {
      access_token: refreshed.accessToken,
      access_token_expires_at: refreshed.accessTokenExpiresAt,
    },
  });
  return refreshed.accessToken;
}
