/**
 * Tiny step-scoped logger for the Gmail sync worker. Every call writes a
 * formatted `[gmail-sync session=<id> step=<name>] <message>` line to
 * stdout (so `npm run dev` / production logs show progress in real time) AND
 * appends a structured `SyncLogEntry` to the session row's `logs` JSON
 * column (so the row alone is enough to debug a finished session).
 *
 * Deliberately library-free — no pino/winston — so the only thing on disk
 * is one tiny module with no surface area. If we ever need centralized log
 * routing, we can replace the implementation here without touching callers.
 */

import prisma from "../prismaClient.js";
import type { SyncLogEntry, SyncStep } from "./gmailSyncTypes.js";

/**
 * Public interface of a session-scoped logger. One instance bound to one
 * GmailSyncSession id; the worker creates one via {@link createSyncLogger}
 * and passes it down to the per-message helpers.
 */
export interface SyncLogger {
  /**
   * Records an info-level log entry. Writes to stdout and appends to the
   * session row's `logs` column atomically.
   *
   * @param {SyncStep | null} step - Current step the worker is in; null when emitted before any transition
   * @param {string} message - Human-readable progress line
   * @param {Record<string, unknown>} [detail] - Optional structured payload (e.g. counts, ids)
   * @returns {Promise<void>}
   */
  log(step: SyncStep | null, message: string, detail?: Record<string, unknown>): Promise<void>;

  /**
   * Records an error-level log entry. Same persistence semantics as
   * {@link SyncLogger.log} but `level` is `"error"` and the line is routed to
   * stderr instead of stdout.
   *
   * @param {SyncStep | null} step - Current step when the error was caught; null when emitted before any transition
   * @param {string} message - Human-readable failure description
   * @param {Record<string, unknown>} [detail] - Optional structured payload
   * @returns {Promise<void>}
   */
  error(step: SyncStep | null, message: string, detail?: Record<string, unknown>): Promise<void>;
}

/**
 * Formats one structured log entry for stdout/stderr. Centralized so info
 * and error lines share the exact same prefix shape — easy to grep, easy to
 * parse from server logs after the fact.
 *
 * @param {number} sessionId - The session id the entry belongs to
 * @param {SyncLogEntry} entry - The structured entry to render
 * @returns {string} A single newline-terminated console line
 */
function formatConsoleLine(sessionId: number, entry: SyncLogEntry): string {
  const stepLabel = entry.step === null ? "-" : entry.step;
  const detailSuffix =
    entry.detail === undefined ? "" : ` ${JSON.stringify(entry.detail)}`;
  return `[gmail-sync session=${String(sessionId)} step=${stepLabel}] ${entry.message}${detailSuffix}\n`;
}

/**
 * Reads the current `logs` JSON column for the session, appends `newEntry`,
 * and writes the array back — all inside a single Prisma transaction so
 * concurrent appenders can't interleave-corrupt the array. Defensive parsing
 * recovers a row with malformed JSON by starting from an empty array; the
 * worker is the only writer in practice, but we're still careful.
 *
 * @param {number} sessionId - The GmailSyncSession id to append onto
 * @param {SyncLogEntry} newEntry - The entry to push onto the JSON array
 * @returns {Promise<void>}
 */
async function appendLogEntryToSession(
  sessionId: number,
  newEntry: SyncLogEntry
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sessionRow = await tx.gmailSyncSession.findUnique({
      where: { id: sessionId },
      select: { logs: true },
    });
    const sessionWasDeleted = sessionRow === null;
    if (sessionWasDeleted) {
      // The session row vanished mid-scan (extremely unlikely outside tests).
      // Skip the append; the stdout line already preserves the entry for
      // debugging without erroring the worker out of the rest of its work.
      return;
    }
    let existingLogEntries: SyncLogEntry[] = [];
    try {
      const parsed = JSON.parse(sessionRow.logs) as unknown;
      if (Array.isArray(parsed)) {
        existingLogEntries = parsed as SyncLogEntry[];
      }
    } catch {
      // Treat unparseable text as an empty log; start fresh on the new entry.
    }
    existingLogEntries.push(newEntry);
    await tx.gmailSyncSession.update({
      where: { id: sessionId },
      data: { logs: JSON.stringify(existingLogEntries) },
    });
  });
}

/**
 * Builds a session-scoped logger bound to one GmailSyncSession id. The
 * returned object's `log` and `error` methods each (a) write a formatted
 * line to stdout/stderr and (b) atomically append a structured entry to the
 * session row's `logs` JSON column.
 *
 * @param {number} sessionId - The GmailSyncSession id the logger writes against
 * @returns {SyncLogger} A logger bound to that session
 */
export function createSyncLogger(sessionId: number): SyncLogger {
  /**
   * Internal writer used by both log/error after the entry's level + stream
   * have been decided. Encapsulates the format-and-append flow so the two
   * public methods are tiny wrappers around the level setting.
   *
   * @param {SyncLogEntry} entry - The structured entry to emit + persist
   * @param {NodeJS.WriteStream} stream - The console stream to write to (stdout or stderr)
   * @returns {Promise<void>}
   */
  async function emitLogEntry(
    entry: SyncLogEntry,
    stream: NodeJS.WriteStream
  ): Promise<void> {
    stream.write(formatConsoleLine(sessionId, entry));
    await appendLogEntryToSession(sessionId, entry);
  }

  return {
    log: async (step, message, detail) => {
      const entry: SyncLogEntry = {
        ts: new Date().toISOString(),
        step,
        level: "info",
        message,
        ...(detail === undefined ? {} : { detail }),
      };
      await emitLogEntry(entry, process.stdout);
    },
    error: async (step, message, detail) => {
      const entry: SyncLogEntry = {
        ts: new Date().toISOString(),
        step,
        level: "error",
        message,
        ...(detail === undefined ? {} : { detail }),
      };
      await emitLogEntry(entry, process.stderr);
    },
  };
}
