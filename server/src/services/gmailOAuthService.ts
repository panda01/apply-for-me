/**
 * Thin wrapper around google-auth-library's OAuth2Client that hides the
 * library specifics from the rest of the codebase. Responsible for:
 *
 *   1. Building the Google authorization URL the client redirects the user to.
 *   2. Exchanging the one-time auth `code` for access + refresh tokens, and
 *      decoding the `id_token` to determine which Google account just
 *      consented (so we can key GmailConnection rows by `google_email`).
 *   3. Refreshing an expired access token using a stored refresh token.
 *   4. Revoking a refresh token at Google's end during disconnect.
 *
 * State-token store: a small in-memory Map<state, createdAt> with a 10-minute
 * TTL provides CSRF protection on the OAuth callback. State tokens are
 * single-use; consumeState() deletes them on read. The store is intentionally
 * not persisted — a server restart mid-flow will fail the callback, which is
 * acceptable for local dev.
 *
 * Required env vars:
 *   - GMAIL_OAUTH_CLIENT_ID
 *   - GMAIL_OAUTH_CLIENT_SECRET
 *   - GMAIL_OAUTH_REDIRECT_URI (must match an Authorized redirect URI in GCP)
 *
 * Scopes requested:
 *   - https://www.googleapis.com/auth/gmail.readonly — read mail (restricted scope)
 *   - openid + email — to derive `google_email` for the connection row
 */

import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

/**
 * Scopes requested on every authorization. Adding a scope here requires the
 * user to reconnect (Google does not auto-grant new scopes to an existing
 * refresh token).
 */
const GMAIL_OAUTH_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
];

/**
 * Lifetime of an unconsumed CSRF state token. After this elapses, a callback
 * that presents the state is rejected as expired. 10 minutes is plenty of
 * time for the user to complete Google's consent screen.
 */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * In-memory store of unconsumed CSRF state tokens. Each value is the wall-clock
 * time the token was issued. Pruned on every read by removing tokens older than
 * STATE_TTL_MS.
 */
const pendingStates = new Map<string, number>();

/**
 * Reads a required environment variable, throwing a descriptive error when
 * missing. Centralized so startup-time misconfiguration produces a single
 * predictable error type.
 *
 * @param {string} name - The environment variable name
 * @returns {string} The non-empty value of the variable
 * @throws {Error} When the variable is missing or empty
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  const isMissing = !value || value.length === 0;
  if (isMissing) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

/**
 * Constructs a fresh OAuth2Client for one operation. We don't reuse a single
 * instance across calls because the library mutates internal credentials state
 * on refresh, and a per-call client makes concurrent flows independent.
 *
 * @returns {OAuth2Client} A configured client ready for one operation
 */
function buildOAuth2Client(): OAuth2Client {
  return new OAuth2Client({
    clientId: getRequiredEnv("GMAIL_OAUTH_CLIENT_ID"),
    clientSecret: getRequiredEnv("GMAIL_OAUTH_CLIENT_SECRET"),
    redirectUri: getRequiredEnv("GMAIL_OAUTH_REDIRECT_URI"),
  });
}

/**
 * Removes any state token older than STATE_TTL_MS from the pendingStates map.
 * Called before every read/write so the map never grows unbounded.
 */
function pruneExpiredStates(): void {
  const cutoffEpochMs = Date.now() - STATE_TTL_MS;
  for (const [state, createdAtEpochMs] of pendingStates) {
    const isExpired = createdAtEpochMs < cutoffEpochMs;
    if (isExpired) {
      pendingStates.delete(state);
    }
  }
}

/**
 * Generates the Google authorization URL the client redirects the user to,
 * along with the CSRF state token that must match in the eventual callback.
 *
 * Forces `prompt=consent` so Google issues a refresh_token even on subsequent
 * connects — the default behavior of returning only an access_token after the
 * first consent would leave us unable to refresh later.
 *
 * @returns {{ url: string; state: string }} The authorization URL plus the
 *   single-use CSRF state token; the state is stashed server-side and verified
 *   by consumeState() on the callback.
 */
export function buildAuthorizationUrl(): { url: string; state: string } {
  pruneExpiredStates();
  const state = randomBytes(32).toString("hex");
  pendingStates.set(state, Date.now());

  const client = buildOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: [...GMAIL_OAUTH_SCOPES],
    state,
    prompt: "consent",
    include_granted_scopes: true,
  });
  return { url, state };
}

/**
 * Validates and consumes a CSRF state token returned by Google on the
 * callback. Single-use: a matching token is deleted from the store so it
 * cannot be replayed.
 *
 * @param {string} state - The state value returned in the callback query string
 * @returns {boolean} true when the state was recognized and consumed,
 *   false when missing, unknown, or expired
 */
export function consumeState(state: string): boolean {
  pruneExpiredStates();
  const isKnownState = pendingStates.has(state);
  if (!isKnownState) {
    return false;
  }
  pendingStates.delete(state);
  return true;
}

/**
 * Shape returned by exchangeCodeForTokens. Mirrors the fields persisted on
 * GmailConnection so the caller can pass it directly to the create/upsert
 * step without further massaging.
 */
export interface ExchangedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  scopes: string;
  googleEmail: string;
}

/**
 * Exchanges a one-time authorization code for access + refresh tokens, then
 * decodes the included id_token to extract the user's Google email address.
 *
 * @param {string} code - The `code` query parameter from Google's callback
 * @returns {Promise<ExchangedTokens>} Tokens plus the resolved Google email
 * @throws {Error} If Google omits a required field (missing refresh_token is
 *   usually a sign that the user already granted consent without `prompt=consent`
 *   — fixable by revoking in https://myaccount.google.com/permissions and retrying)
 */
export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const client = buildOAuth2Client();
  const { tokens } = await client.getToken(code);

  const isMissingAccessToken = !tokens.access_token;
  if (isMissingAccessToken) {
    throw new Error("Google token response missing access_token");
  }
  const isMissingRefreshToken = !tokens.refresh_token;
  if (isMissingRefreshToken) {
    throw new Error(
      "Google token response missing refresh_token — revoke the app at https://myaccount.google.com/permissions and reconnect"
    );
  }
  const isMissingIdToken = !tokens.id_token;
  if (isMissingIdToken) {
    throw new Error("Google token response missing id_token");
  }
  const isMissingExpiryDate = !tokens.expiry_date;
  if (isMissingExpiryDate) {
    throw new Error("Google token response missing expiry_date");
  }

  const idTokenTicket = await client.verifyIdToken({
    idToken: tokens.id_token as string,
    audience: getRequiredEnv("GMAIL_OAUTH_CLIENT_ID"),
  });
  const idTokenPayload = idTokenTicket.getPayload();
  const isMissingEmail = !idTokenPayload?.email;
  if (isMissingEmail) {
    throw new Error("Google id_token payload missing email claim");
  }

  return {
    accessToken: tokens.access_token as string,
    refreshToken: tokens.refresh_token as string,
    accessTokenExpiresAt: new Date(tokens.expiry_date as number),
    scopes: tokens.scope ?? GMAIL_OAUTH_SCOPES.join(" "),
    googleEmail: idTokenPayload?.email as string,
  };
}

/**
 * Shape returned by refreshAccessToken. Just the fields that change on
 * refresh — the refresh_token itself is long-lived and not rotated by Google
 * on a normal refresh (though it can be revoked externally; the caller
 * surfaces that as an auth error).
 */
export interface RefreshedAccessToken {
  accessToken: string;
  accessTokenExpiresAt: Date;
}

/**
 * Uses a stored refresh token to mint a new access token. Called by
 * gmailConnectionService.getValidAccessToken() when the cached access token
 * is at or past its expiry (minus a small skew).
 *
 * @param {string} refreshToken - The refresh_token persisted on GmailConnection
 * @returns {Promise<RefreshedAccessToken>} New access token + absolute expiry
 * @throws {Error} If Google rejects the refresh (e.g. token revoked externally)
 */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshedAccessToken> {
  const client = buildOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();

  const isMissingAccessToken = !credentials.access_token;
  if (isMissingAccessToken) {
    throw new Error("Google refresh response missing access_token");
  }
  const isMissingExpiryDate = !credentials.expiry_date;
  if (isMissingExpiryDate) {
    throw new Error("Google refresh response missing expiry_date");
  }

  return {
    accessToken: credentials.access_token as string,
    accessTokenExpiresAt: new Date(credentials.expiry_date as number),
  };
}

/**
 * Revokes a refresh token at Google's end so the previously-granted access is
 * fully torn down. Used by the disconnect flow before deleting the local row.
 *
 * @param {string} refreshToken - The refresh_token to revoke
 * @returns {Promise<void>}
 * @throws {Error} If Google rejects the revoke request
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const client = buildOAuth2Client();
  await client.revokeToken(refreshToken);
}

/**
 * Test-only seam: forcibly inserts a state token into the pending-states map,
 * letting unit tests assert that consumeState() returns true for known states
 * without having to call buildAuthorizationUrl() first.
 *
 * @param {string} state - The state value to register as pending
 */
export function __seedStateForTests(state: string): void {
  pendingStates.set(state, Date.now());
}

/**
 * Test-only seam: clears all pending state tokens. Lets tests run in
 * isolation without leaking state from a previous test's authorization URL.
 */
export function __clearStatesForTests(): void {
  pendingStates.clear();
}
