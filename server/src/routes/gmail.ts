/**
 * Express router for the Gmail OAuth + connection-management endpoints under
 * /api/gmail. The flow is:
 *
 *   1. Client calls GET /api/gmail/auth/url → receives { url, state }.
 *   2. Client redirects the browser to `url`. User signs in to Google,
 *      consents to gmail.readonly, then Google redirects to
 *      GET /api/gmail/auth/callback with ?code=...&state=...
 *   3. The callback validates state, exchanges code for tokens, upserts a
 *      GmailConnection row, then HTTP-redirects the browser back to the
 *      client at /integrations?connected=<email> so the SPA can show a
 *      confirmation snackbar without further client-side coordination.
 *
 * Errors during the callback are surfaced by redirecting to
 * /integrations?error=<reason> rather than rendering JSON — the user is in a
 * browser tab and needs to land on a meaningful UI either way.
 */

import { Router, Request, Response } from "express";
import {
  buildAuthorizationUrl,
  consumeState,
} from "../services/gmailOAuthService.js";
import {
  createConnectionFromCode,
  deleteConnection,
  listConnections,
} from "../services/gmailConnectionService.js";
import { parseIdParam } from "./_helpers.js";

const router = Router();

/**
 * Builds the absolute client URL to send the user back to after the OAuth
 * callback. Uses CLIENT_PORT from env to match the Vite dev server. Local-dev
 * only — a real deployment would add a CLIENT_BASE_URL env var.
 *
 * @param {string} path - Path on the client app, e.g. "/integrations?connected=foo"
 * @returns {string} Absolute URL such as "http://localhost:4173/integrations?connected=foo"
 */
function buildClientRedirectUrl(path: string): string {
  const clientPort = process.env["CLIENT_PORT"];
  const isMissingClientPort = !clientPort;
  if (isMissingClientPort) {
    throw new Error("CLIENT_PORT environment variable is not set");
  }
  return `http://localhost:${clientPort}${path}`;
}

/**
 * GET /api/gmail/auth/url
 * Returns the Google authorization URL plus the CSRF state token. The client
 * should immediately redirect window.location to `url`; the state is also
 * embedded in the URL so the server can match it on the callback.
 * @returns {object} 200 - { url: string, state: string }
 */
router.get("/auth/url", (_req: Request, res: Response) => {
  const { url, state } = buildAuthorizationUrl();
  res.json({ url, state });
});

/**
 * GET handler for the Google OAuth callback. Validates the CSRF state token,
 * exchanges the one-time `code` for tokens, persists a GmailConnection row,
 * and redirects the user back to the client at /integrations?connected=<email>.
 * On failure, redirects to /integrations?error=<reason> instead.
 *
 * Exported (rather than mounted on the gmail router) because the path it's
 * registered at is dictated by GMAIL_OAUTH_REDIRECT_URI / the redirect URI
 * configured in Google Cloud Console — currently /api/oauth/gmail rather
 * than under /api/gmail. app.ts wires this handler in directly.
 *
 * @param {string} req.query.code - Authorization code issued by Google
 * @param {string} req.query.state - CSRF state token previously issued by us
 * @param {string} [req.query.error] - Set by Google when the user denied consent
 * @returns {302} Redirect to the client integrations page (success or error path)
 */
export async function gmailOAuthCallbackHandler(req: Request, res: Response): Promise<void> {
  const googleErrorParam = typeof req.query["error"] === "string" ? req.query["error"] : null;
  if (googleErrorParam !== null) {
    res.redirect(buildClientRedirectUrl(`/integrations?error=${encodeURIComponent(googleErrorParam)}`));
    return;
  }

  const code = typeof req.query["code"] === "string" ? req.query["code"] : null;
  const state = typeof req.query["state"] === "string" ? req.query["state"] : null;
  const isMissingCodeOrState = code === null || state === null;
  if (isMissingCodeOrState) {
    res.redirect(buildClientRedirectUrl(`/integrations?error=${encodeURIComponent("missing_code_or_state")}`));
    return;
  }

  const isStateValid = consumeState(state);
  if (!isStateValid) {
    res.redirect(buildClientRedirectUrl(`/integrations?error=${encodeURIComponent("invalid_or_expired_state")}`));
    return;
  }

  try {
    const connection = await createConnectionFromCode(code);
    res.redirect(buildClientRedirectUrl(`/integrations?connected=${encodeURIComponent(connection.google_email)}`));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[gmail-oauth] callback failure: ${errorMessage}`);
    res.redirect(buildClientRedirectUrl(`/integrations?error=${encodeURIComponent("token_exchange_failed")}`));
  }
}

/**
 * GET /api/gmail/connections
 * Lists every connected Gmail account, newest-first. Token fields are stripped
 * from the response — never expose access_token / refresh_token over HTTP.
 * @returns {object[]} 200 - Array of public GmailConnection records
 */
router.get("/connections", async (_req: Request, res: Response) => {
  const connections = await listConnections();
  res.json(connections);
});

/**
 * DELETE /api/gmail/connections/:id
 * Disconnects a Gmail account: revokes the refresh token at Google's end,
 * then deletes the local row. If Google's revoke endpoint rejects the call
 * (e.g. token already revoked externally), the row is still deleted and the
 * response includes a `revokeWarning` so the UI can surface the partial
 * failure without blocking the user's intent.
 * @param {number} req.params.id - The GmailConnection.id to disconnect
 * @returns {object} 200 - { deleted: PublicGmailConnection, revokeWarning: string | null }
 * @returns {object} 400 - Invalid id parameter
 * @returns {object} 404 - Connection not found
 */
router.delete("/connections/:id", async (req: Request, res: Response) => {
  const id = parseIdParam(req, res);
  if (id === null) {
    return;
  }
  try {
    const result = await deleteConnection(id);
    res.json(result);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isNotFound = errorMessage.includes("not found");
    if (isNotFound) {
      res.status(404).json({ error: "Gmail connection not found" });
      return;
    }
    throw err;
  }
});

export { router as gmailRouter };
