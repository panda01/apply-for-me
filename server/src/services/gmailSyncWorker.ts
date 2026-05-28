/**
 * Fire-and-forget worker that drives a single GmailSyncSession from
 * `running` → `succeeded` / `failed`. Invoked by the inbox-scan route after
 * it creates the session row with {@link createSession}.
 *
 * The worker walks through three named steps in order so the UI can render
 * a phase indicator alongside the persistent "Syncing…" button:
 *
 *   1. `fetching_emails`  — list Gmail messages matching the keyword query
 *   2. `finding_jobs`     — fetch each message + run the extractor + upsert DiscoveredJob rows
 *   3. `saving_jobs`      — tally results, then {@link finishSucceeded}
 *
 * Any thrown error is caught at the top level and recorded via
 * {@link finishFailed}, so a session row never lingers in `running` unless
 * the entire Node process dies (which the boot-time
 * {@link markStaleRunningAsFailed} reconciles on the next start).
 *
 * Exposed as `void startScanWorker(sessionId, days)` — the caller never
 * awaits this; that's the whole point of returning immediately to the HTTP
 * client.
 */

import { getFirstConnectionId } from "./gmailMessageReaderService.js";
import { runScanWorkInline } from "./discoveredJobsService.js";
import {
  finishFailed,
  finishSucceeded,
  getLastSucceededSession,
  transitionStep,
} from "./gmailSyncSessionService.js";
import { createSyncLogger } from "./syncLogger.js";

/**
 * Number of milliseconds in one day. Used to translate the `days` argument
 * into the absolute `sinceDate` passed to the scan core.
 */
const MILLISECONDS_PER_DAY = 86400 * 1000;

/**
 * Starts the scan worker for the given session id. The route layer calls
 * this as `void startScanWorker(...)` — the promise resolves only when the
 * session has been finalized (succeeded or failed), so awaiting it would
 * block the HTTP response. The worker NEVER throws to its caller: every
 * possible failure path routes to {@link finishFailed} so the session row
 * remains the source of truth for the UI.
 *
 * @param {number} sessionId - The GmailSyncSession id created by the route
 * @param {number} days - Lower bound on email received-at, in days back from now
 * @returns {Promise<void>} Resolves once the session is finalized
 */
export async function startScanWorker(sessionId: number, days: number): Promise<void> {
  const logger = createSyncLogger(sessionId);
  try {
    // Step 1: fetching_emails. Resolves the connection, then the runScanWorkInline
    // helper's `listJobKeywordMessages` call fires under this label.
    await transitionStep(sessionId, "fetching_emails");
    await logger.log("fetching_emails", "Resolving Gmail connection");
    const connectionId = await getFirstConnectionId();

    // Pick `sinceDate` as the MIN of the user's period window and the last
    // succeeded scan's start time. Taking the min (the earlier of the two
    // dates) means the user can always widen the window past prior scans —
    // e.g. selecting "Last month" after a 3-day-old scan now backfills the
    // full month instead of being clamped to 3 days. When the period is
    // narrower (more recent) than the last scan, we still use the last
    // scan's start so we don't re-scan emails already covered. On a
    // backfill, the already-scanned guard inside runScanWorkInline /
    // processSingleMessage short-circuits any messages we previously
    // ingested, so widening the window is cheap for the overlap region.
    const periodSinceDate = new Date(Date.now() - days * MILLISECONDS_PER_DAY);
    const previousSucceededSession = await getLastSucceededSession(connectionId);
    let sinceDate = periodSinceDate;
    let syncStrategy: "incremental" | "period_window" | "backfill" = "period_window";
    if (previousSucceededSession !== null) {
      const previousScanStartedAt = new Date(previousSucceededSession.startedAt);
      const periodIsNarrowerThanGapToPreviousScan = periodSinceDate >= previousScanStartedAt;
      if (periodIsNarrowerThanGapToPreviousScan) {
        sinceDate = previousScanStartedAt;
        syncStrategy = "incremental";
      } else {
        sinceDate = periodSinceDate;
        syncStrategy = "backfill";
      }
    }
    await logger.log(
      "fetching_emails",
      `Fetching emails after ${sinceDate.toISOString()} (strategy=${syncStrategy})`,
      {
        sinceDate: sinceDate.toISOString(),
        days,
        syncStrategy,
        previousSucceededSessionId: previousSucceededSession?.id ?? null,
      }
    );

    // Step 2: finding_jobs. The per-message extractor + upsert runs here.
    // runScanWorkInline calls processSingleMessage for each message id; with
    // the logger threaded in, each call emits its own `finding_jobs` line.
    await transitionStep(sessionId, "finding_jobs");
    await logger.log("finding_jobs", "Running extractor over candidate messages");
    const scanResult = await runScanWorkInline({ connectionId, sinceDate, logger });
    await logger.log("finding_jobs", "Extractor pass complete", {
      scanned: scanResult.scanned,
      found: scanResult.found,
      newDiscoveries: scanResult.newDiscoveries,
    });

    // Step 3: saving_jobs. Discoveries are already persisted at this point
    // (the DB writes happen during step 2); this step is the
    // "finalize + tally" pass that flips the session to succeeded.
    await transitionStep(sessionId, "saving_jobs");
    await logger.log("saving_jobs", "Tallying scan results");
    await finishSucceeded(sessionId, scanResult);
    await logger.log("saving_jobs", "Session finalized as succeeded", {
      scanned: scanResult.scanned,
      newDiscoveries: scanResult.newDiscoveries,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Best-effort error log; if the row was deleted mid-scan, the logger
    // append no-ops and we still finalize the row below (which will also
    // no-op if the row is gone — Prisma will throw, caught + swallowed).
    await logger.error(null, "Worker failed", { error: errorMessage }).catch(() => {
      /* logger failure must not mask the original error path */
    });
    try {
      await finishFailed(sessionId, errorMessage);
    } catch {
      // The session row may have been deleted; nothing to recover.
    }
  }
}
