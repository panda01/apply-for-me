/**
 * Shared types used across the inbox-discovery feature. Lives in services/
 * (not routes/) because both the route layer AND the various service modules
 * import from here. Keeping the types in one file avoids circular imports
 * between the reader, extractor, and discovery services.
 *
 * Naming convention: the union types ending in "Value" mirror Prisma enum
 * names exactly. Prisma's generator only emits TypeScript *types* (not runtime
 * values) for enums, so the runtime-comparable string-literal union is
 * declared here for use in switch statements + request validation.
 */

/**
 * String-literal mirror of Prisma's `DiscoveredJobStatus` enum. Must stay
 * byte-identical to the values in schema.prisma so DB writes and runtime
 * comparisons line up.
 */
export type DiscoveredJobStatusValue = "pending" | "imported" | "duplicate" | "dismissed";

/**
 * One job extracted from a single email by the job-discovery extractor.
 * The extractor returns an array of these (possibly empty when the email
 * is not actually about specific openings).
 *
 * `confidence` is 0..1 self-reported by the extractor — for the Claude tier
 * it comes from the LLM's own assessment; future deterministic parsers can
 * report 1.0 for clean structured matches.
 */
export interface ExtractedJob {
  title: string;
  company: string;
  jobUrl: string;
  location: string | null;
  salary: string | null;
  description: string | null;
  confidence: number;
}

/**
 * Output of `extractFromMessage`. `extractor` identifies which strategy
 * produced the result (e.g. "claude-haiku-4-5") — useful for debugging and
 * future per-extractor stats. `jobs.length === 0` is valid and means the
 * email matched the keyword search but isn't actually about job openings
 * (a newsletter, a reply chain, etc.).
 */
export interface ExtractorResult {
  extractor: string;
  jobs: ExtractedJob[];
}

/**
 * Normalized projection of a Gmail message used by the extractor. Built by
 * the message reader from Gmail's `users.messages.get?format=full` response.
 * `bodyHtml` is preferred over `bodyText` when both exist (HTML preserves
 * link structure the extractor relies on); `bodyHtml` is null when the
 * message is plaintext-only.
 */
export interface GmailMessageSummary {
  messageId: string;
  threadId: string | null;
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string | null;
  receivedAt: Date;
  bodyHtml: string | null;
  bodyText: string | null;
}

/**
 * Return type of `scanInbox`. Reported by the page after a Re-scan click so
 * the user can see how many messages were inspected vs. how many produced
 * new rows.
 *   `scanned`         — number of Gmail messages fetched and run through Claude
 *   `found`           — total number of extracted jobs across all messages (before dedup)
 *   `newDiscoveries`  — number of NEW DiscoveredJob rows inserted on this run
 *                       (upserts onto existing rows do NOT count here)
 */
export interface ScanResult {
  scanned: number;
  found: number;
  newDiscoveries: number;
}

/**
 * Return type of `importDiscoveries`. Per-id outcomes so the UI can render
 * partial-success states (some imported, some failed validation, some were
 * already duplicates).
 *   `imported`   — discoveries successfully promoted; each entry pairs the
 *                  discovery's id with the JobListing id it created
 *   `failed`     — discoveries that errored during import (DB error, race
 *                  condition, etc.); UI shows the reason inline
 *   `duplicates` — discoveries the import skipped because they were already
 *                  marked as duplicates at scan time (defensive — UI should
 *                  not allow checking these)
 */
export interface ImportResult {
  imported: { discoveryId: number; jobListingId: number }[];
  failed: { discoveryId: number; reason: string }[];
  duplicates: { discoveryId: number; jobListingId: number }[];
}

/**
 * Email-metadata projection embedded on every PublicDiscoveredJob. Mirrors
 * what the design's `.email-tag` and `.disc-group-head` render.
 *
 * `gmailUrl` is a deep link of the form `https://mail.google.com/mail/u/0/#inbox/<message_id>`
 * built by the route layer from `messageId`.
 */
export interface PublicDiscoveredJobEmail {
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
 * Summary of an existing JobListing referenced by a discovery's
 * duplicate-of or imported-as relationship. Just enough to render the
 * design's "Already saved as …" link.
 */
export interface PublicDiscoveredJobReference {
  jobListingId: number;
  title: string;
  status: string;
}

/**
 * HTTP-safe projection of a DiscoveredJob. Returned by GET /api/inbox/discoveries
 * and POST /api/inbox/scan. Embeds the email metadata and the duplicate/imported
 * references inline so the page doesn't need a second round-trip per row.
 */
export interface PublicDiscoveredJob {
  id: number;
  status: DiscoveredJobStatusValue;
  title: string;
  company: string;
  jobUrl: string;
  location: string | null;
  salary: string | null;
  description: string | null;
  confidence: number;
  email: PublicDiscoveredJobEmail;
  duplicateOf: PublicDiscoveredJobReference | null;
  importedAs: PublicDiscoveredJobReference | null;
  createdDate: string;
}
