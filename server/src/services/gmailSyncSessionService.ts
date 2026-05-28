/**
 * CRUD layer for `GmailSyncSession` rows. Wraps Prisma so the route handlers
 * and the worker speak in the same `PublicGmailSyncSession` projection and
 * never need to think about the JSON-as-text serialization of `logs` or
 * `result`.
 *
 * Session-lifecycle methods exposed here:
 *   - {@link createSession}            — INSERT a brand-new running row
 *   - {@link transitionStep}           — UPDATE current_step
 *   - {@link finishSucceeded}          — UPDATE status="succeeded" + result
 *   - {@link finishFailed}             — UPDATE status="failed" + last_error
 *   - {@link getActiveSession}         — SELECT running row for a connection
 *   - {@link getLastSession}           — SELECT most recent row for a connection
 *   - {@link getSessionById}           — SELECT by id
 *   - {@link markStaleRunningAsFailed} — Boot-time recovery (called from server/src/index.ts)
 *   - {@link projectSessionRow}        — Internal mapper from row → PublicGmailSyncSession
 */

import prisma from "../prismaClient.js";
import type { GmailSyncSession } from "../../prisma/generated/client/client.js";
import {
  GmailSyncSessionStatus,
  GmailSyncStep,
} from "../../prisma/generated/client/client.js";
import type {
  PublicGmailSyncSession,
  SyncLogEntry,
  SyncSessionResult,
  SyncStep,
} from "./gmailSyncTypes.js";

/**
 * Projects a raw Prisma `GmailSyncSession` row into the HTTP-safe
 * {@link PublicGmailSyncSession} shape. Parses the JSON-as-text columns and
 * normalizes Date columns to ISO strings so callers don't have to.
 *
 * @param {GmailSyncSession} row - The Prisma row to project
 * @returns {PublicGmailSyncSession} Public projection ready for JSON serialization
 */
export function projectSessionRow(row: GmailSyncSession): PublicGmailSyncSession {
  let parsedLogs: SyncLogEntry[] = [];
  try {
    const candidate = JSON.parse(row.logs) as unknown;
    if (Array.isArray(candidate)) {
      parsedLogs = candidate as SyncLogEntry[];
    }
  } catch {
    // Corrupted logs JSON degrades to an empty array — the row is still
    // useful to the UI; only the per-step audit trail is missing.
  }

  let parsedResult: SyncSessionResult | null = null;
  if (row.result !== null) {
    try {
      const candidate = JSON.parse(row.result) as unknown;
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        "scanned" in candidate &&
        "found" in candidate &&
        "newDiscoveries" in candidate
      ) {
        parsedResult = candidate as SyncSessionResult;
      }
    } catch {
      // Same as above — corrupted result JSON shows as null result.
    }
  }

  return {
    id: row.id,
    gmailConnectionId: row.gmail_connection_id,
    status: row.status as PublicGmailSyncSession["status"],
    currentStep: row.current_step === null ? null : (row.current_step as SyncStep),
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at === null ? null : row.finished_at.toISOString(),
    daysRequested: row.days_requested,
    lastError: row.last_error,
    result: parsedResult,
    logs: parsedLogs,
  };
}

/**
 * Inserts a brand-new GmailSyncSession row in the `running` state with no
 * current step yet (the worker will transition into `fetching_emails` as
 * its first act).
 *
 * @param {object} args - Session-creation parameters
 * @param {number} args.gmailConnectionId - The GmailConnection this scan targets
 * @param {number} args.daysRequested - The `days` value the route was called with (persisted for audit)
 * @returns {Promise<{ sessionId: number }>} The newly created session id
 */
export async function createSession(args: {
  gmailConnectionId: number;
  daysRequested: number;
}): Promise<{ sessionId: number }> {
  const createdRow = await prisma.gmailSyncSession.create({
    data: {
      gmail_connection_id: args.gmailConnectionId,
      days_requested: args.daysRequested,
      status: GmailSyncSessionStatus.running,
      current_step: null,
    },
  });
  return { sessionId: createdRow.id };
}

/**
 * Updates the `current_step` column on a running session. Used by the worker
 * between phases. Throws if the session doesn't exist (the worker should
 * never call this for a vanished row).
 *
 * @param {number} sessionId - The GmailSyncSession id to transition
 * @param {SyncStep} step - The step value to write
 * @returns {Promise<void>}
 */
export async function transitionStep(sessionId: number, step: SyncStep): Promise<void> {
  await prisma.gmailSyncSession.update({
    where: { id: sessionId },
    data: { current_step: step as GmailSyncStep },
  });
}

/**
 * Finalizes a session as `succeeded`. Writes `result` (JSON-encoded),
 * clears `current_step`, and stamps `finished_at`. Called by the worker
 * when the scan completes without error.
 *
 * @param {number} sessionId - The GmailSyncSession id to finalize
 * @param {SyncSessionResult} result - The terminal scan tally to persist
 * @returns {Promise<void>}
 */
export async function finishSucceeded(
  sessionId: number,
  result: SyncSessionResult
): Promise<void> {
  await prisma.gmailSyncSession.update({
    where: { id: sessionId },
    data: {
      status: GmailSyncSessionStatus.succeeded,
      current_step: null,
      finished_at: new Date(),
      result: JSON.stringify(result),
    },
  });
}

/**
 * Finalizes a session as `failed`. Writes `last_error`, clears
 * `current_step`, and stamps `finished_at`. Called by the worker's catch
 * block when anything throws, and by {@link markStaleRunningAsFailed} for
 * crash-recovery on boot.
 *
 * @param {number} sessionId - The GmailSyncSession id to finalize
 * @param {string} errorMessage - Human-readable failure reason
 * @returns {Promise<void>}
 */
export async function finishFailed(
  sessionId: number,
  errorMessage: string
): Promise<void> {
  await prisma.gmailSyncSession.update({
    where: { id: sessionId },
    data: {
      status: GmailSyncSessionStatus.failed,
      current_step: null,
      finished_at: new Date(),
      last_error: errorMessage,
    },
  });
}

/**
 * Returns the currently-running session for a connection, or null when no
 * scan is in flight. Backs `GET /api/inbox/scan/active` and gates the
 * 409-conflict check on `POST /api/inbox/scan`.
 *
 * @param {number} gmailConnectionId - The GmailConnection to query
 * @returns {Promise<PublicGmailSyncSession | null>} The running session, or null
 */
export async function getActiveSession(
  gmailConnectionId: number
): Promise<PublicGmailSyncSession | null> {
  const row = await prisma.gmailSyncSession.findFirst({
    where: {
      gmail_connection_id: gmailConnectionId,
      status: GmailSyncSessionStatus.running,
    },
    orderBy: { started_at: "desc" },
  });
  if (row === null) {
    return null;
  }
  return projectSessionRow(row);
}

/**
 * Returns the most recent session for a connection regardless of status.
 * Backs `GET /api/inbox/scan/last` so the UI can render "last scan finished
 * N seconds ago — found 4 new" after a reload.
 *
 * @param {number} gmailConnectionId - The GmailConnection to query
 * @returns {Promise<PublicGmailSyncSession | null>} The most recent session, or null when none exist
 */
export async function getLastSession(
  gmailConnectionId: number
): Promise<PublicGmailSyncSession | null> {
  const row = await prisma.gmailSyncSession.findFirst({
    where: { gmail_connection_id: gmailConnectionId },
    orderBy: { started_at: "desc" },
  });
  if (row === null) {
    return null;
  }
  return projectSessionRow(row);
}

/**
 * Returns the most recent successfully-finished session for a connection, or
 * null when no scan has ever succeeded. Used by the worker as the
 * "incremental sync since" anchor so consecutive re-scans don't re-fetch
 * emails the previous successful scan already saw.
 *
 * Uses `started_at` (not `finished_at`) deliberately — the previous scan's
 * Gmail `after:` query used its own `started_at`, so anchoring the next
 * scan to that same timestamp is loss-less (re-fetched emails are
 * upserted, never missed).
 *
 * @param {number} gmailConnectionId - The GmailConnection to query
 * @returns {Promise<PublicGmailSyncSession | null>} The last succeeded session, or null
 */
export async function getLastSucceededSession(
  gmailConnectionId: number
): Promise<PublicGmailSyncSession | null> {
  const row = await prisma.gmailSyncSession.findFirst({
    where: {
      gmail_connection_id: gmailConnectionId,
      status: GmailSyncSessionStatus.succeeded,
    },
    orderBy: { started_at: "desc" },
  });
  if (row === null) {
    return null;
  }
  return projectSessionRow(row);
}

/**
 * Returns a session by its id, or null when no such row exists. Backs
 * `GET /api/inbox/scan/:sessionId`.
 *
 * @param {number} sessionId - The id to look up
 * @returns {Promise<PublicGmailSyncSession | null>} The session, or null when not found
 */
export async function getSessionById(
  sessionId: number
): Promise<PublicGmailSyncSession | null> {
  const row = await prisma.gmailSyncSession.findUnique({ where: { id: sessionId } });
  if (row === null) {
    return null;
  }
  return projectSessionRow(row);
}

/**
 * Reconciles any sessions left in `running` after a server crash. Called
 * once at boot, before `app.listen` accepts requests, so the very first
 * `/active` request after boot already sees a consistent picture. Sets
 * `status="failed"`, `last_error="server restart"`, and `finished_at=now`
 * on each affected row, and logs the count to stdout.
 *
 * @returns {Promise<{ markedCount: number }>} How many rows were reconciled
 */
export async function markStaleRunningAsFailed(): Promise<{ markedCount: number }> {
  const updateOutcome = await prisma.gmailSyncSession.updateMany({
    where: { status: GmailSyncSessionStatus.running },
    data: {
      status: GmailSyncSessionStatus.failed,
      current_step: null,
      finished_at: new Date(),
      last_error: "server restart",
    },
  });
  const markedCount = updateOutcome.count;
  if (markedCount > 0) {
    process.stdout.write(
      `[gmail-sync boot] reconciled ${String(markedCount)} stale running session(s) → failed (server restart)\n`
    );
  }
  return { markedCount };
}
