/**
 * Frontend API service for the inbox-discovery endpoints under /api/inbox.
 * Mirrors the response shapes in server/src/services/inboxTypes.ts. Real
 * implementations land in Unit C of the parallel fan-out; for now they hit
 * the (501-returning) stub routes so the client side compiles and gets a
 * predictable failure mode rather than 404.
 */
import { requestJson } from "./httpClient";
import { type WorkArrangement } from "../components/WorkArrangementChip";

/**
 * String-literal mirror of the server's DiscoveredJobStatus enum.
 */
export type DiscoveredJobStatus = "pending" | "imported" | "duplicate" | "dismissed";

/**
 * Embedded email metadata on every DiscoveredJob row. Used by the inbox page
 * to render the .email-tag deep-link back into Gmail.
 */
export interface DiscoveredJobEmail {
  messageId: string;
  threadId: string | null;
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string | null;
  receivedAt: string;
  labelColor: string | null;
  gmailUrl: string;
}

/**
 * Summary of an existing JobListing referenced by a discovery's duplicate-of
 * or imported-as relationship. Powers the design's "Already saved as …" link.
 */
export interface DiscoveredJobReference {
  jobListingId: number;
  title: string;
  status: string;
}

/**
 * HTTP-safe DiscoveredJob projection. Embeds the email metadata + duplicate /
 * imported references inline so the page doesn't need a second round-trip
 * per row.
 */
export interface DiscoveredJobResponse {
  id: number;
  status: DiscoveredJobStatus;
  title: string;
  company: string;
  jobUrl: string;
  location: string | null;
  workArrangement: WorkArrangement | null;
  salary: string | null;
  description: string | null;
  confidence: number;
  email: DiscoveredJobEmail;
  duplicateOf: DiscoveredJobReference | null;
  importedAs: DiscoveredJobReference | null;
  createdDate: string;
}

/**
 * Final-tally shape stored on a settled GmailSyncSession's `result` column
 * and surfaced to the UI when a scan finishes. Counts: messages scanned,
 * jobs found across all messages (before dedup), newly-inserted rows.
 */
export interface ScanResultResponse {
  scanned: number;
  found: number;
  newDiscoveries: number;
}

/**
 * String-literal mirror of the server's GmailSyncStep enum. Must stay
 * byte-identical to the SyncStep union in server/src/services/gmailSyncTypes.ts.
 */
export type SyncStep = "fetching_emails" | "finding_jobs" | "saving_jobs";

/**
 * String-literal mirror of the server's GmailSyncSessionStatus enum.
 * "running" | "succeeded" | "failed".
 */
export type SyncSessionStatus = "running" | "succeeded" | "failed";

/**
 * One persisted log entry from a GmailSyncSession's `logs` JSON column.
 * Each scan step emits one or more of these for post-hoc debugging.
 */
export interface SyncLogEntry {
  ts: string;
  step: SyncStep | null;
  level: "info" | "error";
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * HTTP-safe projection of a GmailSyncSession. Returned by every
 * /api/inbox/scan/* endpoint that exposes session state.
 */
export interface GmailSyncSessionResponse {
  id: number;
  gmailConnectionId: number;
  status: SyncSessionStatus;
  currentStep: SyncStep | null;
  startedAt: string;
  finishedAt: string | null;
  daysRequested: number;
  lastError: string | null;
  result: ScanResultResponse | null;
  logs: SyncLogEntry[];
}

/**
 * Body shape returned by POST /api/inbox/scan when a new session is started.
 * `reused` is `false` here — the route returns 409 (handled via the
 * {@link ScanAlreadyRunningError} thrown below) when an active session
 * already exists, so this shape never carries `reused: true` today.
 */
export interface StartScanResponse {
  sessionId: number;
  status: "running";
  reused: boolean;
}

/**
 * Thrown by {@link scanInbox} when the server responds 409 Conflict because
 * a scan is already running for the connection. Carries the existing
 * session's id so the caller can transparently join the in-flight scan.
 */
export class ScanAlreadyRunningError extends Error {
  /** The id of the GmailSyncSession that's already running. */
  public readonly sessionId: number;

  /**
   * @param {number} sessionId - The currently-running session's id
   */
  constructor(sessionId: number) {
    super("scan_already_running");
    this.name = "ScanAlreadyRunningError";
    this.sessionId = sessionId;
  }
}

/**
 * Return type of POST /api/inbox/import. Per-id outcomes so the page can
 * render partial-success states.
 */
export interface ImportResultResponse {
  imported: { discoveryId: number; jobListingId: number }[];
  failed: { discoveryId: number; reason: string }[];
  duplicates: { discoveryId: number; jobListingId: number }[];
}

/**
 * Lists persisted DiscoveredJob rows within a time window.
 * @param {number} days - Lower bound on email received-at, in days back from now
 * @param {DiscoveredJobStatus} [status] - Optional status filter
 * @returns {Promise<DiscoveredJobResponse[]>} The matching discoveries
 * @throws {Error} On non-2xx response
 */
export async function listInboxDiscoveries(
  days: number,
  status?: DiscoveredJobStatus
): Promise<DiscoveredJobResponse[]> {
  const params = new URLSearchParams({ days: String(days) });
  if (status !== undefined) {
    params.set("status", status);
  }
  return requestJson<DiscoveredJobResponse[]>(
    `/api/inbox/discoveries?${params.toString()}`,
    undefined,
    "Failed to list inbox discoveries"
  );
}

/**
 * Starts a background inbox scan and returns the GmailSyncSession id so the
 * caller can poll for progress. When a scan is already running for the
 * connection, the server responds 409 Conflict with the existing session
 * id — this function throws {@link ScanAlreadyRunningError} in that case,
 * letting the caller seamlessly join the in-flight scan.
 *
 * @param {number} days - Lower bound on email received-at, in days back from now
 * @returns {Promise<StartScanResponse>} The created session id + status
 * @throws {ScanAlreadyRunningError} When a session is already running (HTTP 409)
 * @throws {Error} On any other non-2xx response
 */
export async function scanInbox(days: number): Promise<StartScanResponse> {
  const response = await fetch("/api/inbox/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
  if (response.status === 409) {
    let conflictBody: { sessionId?: number } = {};
    try {
      conflictBody = (await response.json()) as { sessionId?: number };
    } catch {
      // No JSON body — fall through to a sessionId of 0, which the hook
      // will treat as "unknown id" and recover via a fresh /active fetch.
    }
    const conflictingSessionId =
      typeof conflictBody.sessionId === "number" ? conflictBody.sessionId : 0;
    throw new ScanAlreadyRunningError(conflictingSessionId);
  }
  if (!response.ok) {
    let errorBody: { error?: string } = {};
    try {
      errorBody = (await response.json()) as { error?: string };
    } catch {
      // Fall through to the default message.
    }
    throw new Error(errorBody.error ?? "Failed to scan inbox");
  }
  return (await response.json()) as StartScanResponse;
}

/**
 * Returns the currently-running GmailSyncSession for the connection, or
 * null when no scan is in flight. Used by the polling hook to detect a
 * sync-in-progress on page load and survive across reloads.
 *
 * @returns {Promise<GmailSyncSessionResponse | null>} The running session, or null
 * @throws {Error} On non-2xx response
 */
export async function getActiveScanSession(): Promise<GmailSyncSessionResponse | null> {
  const payload = await requestJson<{ session: GmailSyncSessionResponse | null }>(
    "/api/inbox/scan/active",
    undefined,
    "Failed to load active scan session"
  );
  return payload.session;
}

/**
 * Returns the most recent GmailSyncSession for the connection, regardless
 * of status. Useful for "last scan finished N seconds ago" UI states.
 *
 * @returns {Promise<GmailSyncSessionResponse | null>} The most recent session, or null when none exist
 * @throws {Error} On non-2xx response
 */
export async function getLastScanSession(): Promise<GmailSyncSessionResponse | null> {
  const payload = await requestJson<{ session: GmailSyncSessionResponse | null }>(
    "/api/inbox/scan/last",
    undefined,
    "Failed to load last scan session"
  );
  return payload.session;
}

/**
 * Returns a specific GmailSyncSession by id. The polling hook calls this on
 * a timer while a session is running.
 *
 * @param {number} sessionId - The session id to read
 * @returns {Promise<GmailSyncSessionResponse>} The session
 * @throws {Error} On non-2xx response, including 404 when the id is unknown
 */
export async function getScanSession(sessionId: number): Promise<GmailSyncSessionResponse> {
  const payload = await requestJson<{ session: GmailSyncSessionResponse }>(
    `/api/inbox/scan/${String(sessionId)}`,
    undefined,
    "Failed to load scan session"
  );
  return payload.session;
}

/**
 * Imports the given pending DiscoveredJob ids as real JobListing rows.
 * @param {number[]} ids - DiscoveredJob ids to import
 * @returns {Promise<ImportResultResponse>} Per-id outcomes
 * @throws {Error} On non-2xx response
 */
export async function importInboxDiscoveries(ids: number[]): Promise<ImportResultResponse> {
  return requestJson<ImportResultResponse>(
    "/api/inbox/import",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    },
    "Failed to import inbox discoveries"
  );
}

/**
 * Flips a DiscoveredJob to status="dismissed".
 * @param {number} id - The DiscoveredJob id to dismiss
 * @returns {Promise<DiscoveredJobResponse>} The updated row
 * @throws {Error} On non-2xx response
 */
export async function dismissInboxDiscovery(id: number): Promise<DiscoveredJobResponse> {
  return requestJson<DiscoveredJobResponse>(
    `/api/inbox/discoveries/${String(id)}/dismiss`,
    { method: "POST" },
    "Failed to dismiss inbox discovery"
  );
}

/**
 * Flips a dismissed DiscoveredJob back to status="pending".
 * @param {number} id - The DiscoveredJob id to restore
 * @returns {Promise<DiscoveredJobResponse>} The updated row
 * @throws {Error} On non-2xx response
 */
export async function restoreInboxDiscovery(id: number): Promise<DiscoveredJobResponse> {
  return requestJson<DiscoveredJobResponse>(
    `/api/inbox/discoveries/${String(id)}/restore`,
    { method: "POST" },
    "Failed to restore inbox discovery"
  );
}
