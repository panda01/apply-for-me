/**
 * Frontend API service for the Gmail OAuth + connection-management endpoints
 * exposed under /api/gmail. The connect flow runs through a browser redirect
 * (window.location), so this module only handles the JSON endpoints around
 * it — initiating the redirect, listing connections, and disconnecting.
 */
import { requestJson } from "./httpClient";

/**
 * Server-side PublicGmailConnection shape after JSON serialization. Dates are
 * ISO strings in transit. Token fields (access_token / refresh_token) are
 * intentionally absent — never exposed over HTTP.
 */
export interface GmailConnectionResponse {
  id: number;
  google_email: string;
  scopes: string;
  access_token_expires_at: string;
  created_date: string;
  updated_date: string;
}

/**
 * Response from GET /api/gmail/auth/url. The client should redirect
 * window.location to `url`; `state` is informational (the CSRF token is also
 * embedded in `url`, and the server tracks it server-side).
 */
export interface GmailAuthUrlResponse {
  url: string;
  state: string;
}

/**
 * Response from DELETE /api/gmail/connections/:id. `revokeWarning` is set
 * when the local row was deleted but Google's revoke endpoint rejected the
 * call — e.g. token already revoked from myaccount.google.com.
 */
export interface DeleteGmailConnectionResponse {
  deleted: GmailConnectionResponse;
  revokeWarning: string | null;
}

/**
 * Fetches the Google authorization URL the user must visit to grant
 * gmail.readonly. The caller redirects the browser to it.
 * @returns {Promise<GmailAuthUrlResponse>} { url, state }
 * @throws {Error} If the API request fails
 */
export async function getGmailAuthorizationUrl(): Promise<GmailAuthUrlResponse> {
  return requestJson<GmailAuthUrlResponse>(
    "/api/gmail/auth/url",
    undefined,
    "Failed to fetch Gmail authorization URL"
  );
}

/**
 * Lists every connected Gmail account, newest first. Used by the
 * IntegrationsPage to render the connections table.
 * @returns {Promise<GmailConnectionResponse[]>} Array of public connection records
 * @throws {Error} If the API request fails
 */
export async function listGmailConnections(): Promise<GmailConnectionResponse[]> {
  return requestJson<GmailConnectionResponse[]>(
    "/api/gmail/connections",
    undefined,
    "Failed to list Gmail connections"
  );
}

/**
 * Disconnects a Gmail account: revokes at Google, then deletes the local row.
 * @param {number} id - The GmailConnection.id to disconnect
 * @returns {Promise<DeleteGmailConnectionResponse>} Deleted row + optional revoke warning
 * @throws {Error} If the connection is not found or the API request fails
 */
export async function deleteGmailConnection(id: number): Promise<DeleteGmailConnectionResponse> {
  return requestJson<DeleteGmailConnectionResponse>(
    `/api/gmail/connections/${String(id)}`,
    { method: "DELETE" },
    "Failed to disconnect Gmail account"
  );
}
