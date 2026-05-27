/**
 * Frontend API service for the inbox-discovery endpoints under /api/inbox.
 * Mirrors the response shapes in server/src/services/inboxTypes.ts. Real
 * implementations land in Unit C of the parallel fan-out; for now they hit
 * the (501-returning) stub routes so the client side compiles and gets a
 * predictable failure mode rather than 404.
 */
import { requestJson } from "./httpClient";

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
  salary: string | null;
  description: string | null;
  confidence: number;
  email: DiscoveredJobEmail;
  duplicateOf: DiscoveredJobReference | null;
  importedAs: DiscoveredJobReference | null;
  createdDate: string;
}

/**
 * Return type of POST /api/inbox/scan. Counts: messages scanned, jobs found
 * across all messages (before dedup), newly-inserted rows.
 */
export interface ScanResultResponse {
  scanned: number;
  found: number;
  newDiscoveries: number;
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
 * Triggers a synchronous inbox scan over the given window.
 * @param {number} days - Lower bound on email received-at, in days back from now
 * @returns {Promise<ScanResultResponse>} Scan counters
 * @throws {Error} On non-2xx response
 */
export async function scanInbox(days: number): Promise<ScanResultResponse> {
  return requestJson<ScanResultResponse>(
    "/api/inbox/scan",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    },
    "Failed to scan inbox"
  );
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
