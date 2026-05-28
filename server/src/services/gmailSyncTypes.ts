/**
 * Shared types for the Gmail sync-session feature. Mirrors the Prisma enums
 * declared in schema.prisma so route handlers, the worker, the logger, and
 * the (string-literally identical) client types can all reference one
 * canonical definition.
 *
 * Prisma's TypeScript output emits the enum names as both a type and a
 * runtime const object, but co-existing string-literal unions here make the
 * union usable in switch-exhaustiveness checks and request validation
 * without dragging Prisma's generated module into every consumer.
 */

/**
 * Discrete steps the scan worker progresses through. Stored as
 * `GmailSyncSession.current_step` and surfaced to the UI as the three labels
 * on the sync step indicator: "Fetching emails", "Finding jobs in emails",
 * "Saving jobs". Must stay byte-identical to the `GmailSyncStep` enum values
 * in schema.prisma.
 */
export type SyncStep = "fetching_emails" | "finding_jobs" | "saving_jobs";

/**
 * Possible lifecycle states for a GmailSyncSession row. Mirrors the
 * `GmailSyncSessionStatus` Prisma enum.
 *   running    — Worker is actively processing this scan
 *   succeeded  — Worker finished without error; `result` is populated
 *   failed     — Worker threw, or the row was reconciled at boot after a crash
 */
export type SyncSessionStatus = "running" | "succeeded" | "failed";

/**
 * One entry inside `GmailSyncSession.logs` (which is stored as a JSON-as-text
 * array). Captures step-scoped progress + error reports so the row alone is
 * enough to reconstruct what the worker did. `step` may be `null` for log
 * lines emitted before any transition (e.g. an early failure during setup).
 */
export interface SyncLogEntry {
  ts: string;
  step: SyncStep | null;
  level: "info" | "error";
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * Tally returned by a completed scan worker, mirrored from `ScanResult` in
 * inboxTypes.ts. Persisted onto `GmailSyncSession.result` (as JSON-as-text)
 * so the UI can render "Found N new" the moment the session settles.
 */
export interface SyncSessionResult {
  scanned: number;
  found: number;
  newDiscoveries: number;
}

/**
 * HTTP-safe projection of a GmailSyncSession row. Returned by every endpoint
 * that exposes session state (POST /api/inbox/scan, GET /api/inbox/scan/active,
 * GET /api/inbox/scan/last, GET /api/inbox/scan/:sessionId). Parses the
 * JSON-as-text columns (`logs`, `result`) into typed values so the client
 * doesn't have to double-parse.
 */
export interface PublicGmailSyncSession {
  id: number;
  gmailConnectionId: number;
  status: SyncSessionStatus;
  currentStep: SyncStep | null;
  startedAt: string;
  finishedAt: string | null;
  daysRequested: number;
  lastError: string | null;
  result: SyncSessionResult | null;
  logs: SyncLogEntry[];
}
