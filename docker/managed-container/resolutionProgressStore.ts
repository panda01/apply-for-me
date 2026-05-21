/**
 * In-memory progress map for application-URL resolver attempts hosted by this
 * container. The server inserts an ApplicationUrlResolutionLog row up-front
 * and hands the resulting `logId` to this container via
 * POST /resolution-progress/:logId/begin. As the server-side resolver walks
 * through each phase it POSTs step updates to /resolution-progress/:logId/step
 * (and a single /finalize at the end). This module is what those endpoints
 * read and write against.
 *
 * The store deliberately lives only in memory:
 *   - On container restart it's gone, by design — the trace page falls back
 *     to a "container did not return live progress" terminal state and the
 *     durable post-mortem remains in the server's database row.
 *   - On finalize, an eviction timer removes the entry after a TTL so an idle
 *     container doesn't accumulate state across many runs.
 *
 * Every begin / recordStep / finalize call writes one structured stdout line
 * (`[resolver:step ...]` / `[resolver:attempt ...]`) so a `docker logs` tail
 * mirrors the live UI for admin debugging.
 */

import {
  ResolutionPhase,
  StepStatus,
  ApplicationUrlResolutionOutcome,
} from "./resolutionTypes.js";

/**
 * One step in a live attempt. Mirrors the LiveStep type that the trace
 * page renders on the frontend.
 */
export interface LiveStep {
  stepIndex: number;
  phase: ResolutionPhase;
  status: StepStatus;
  message: string;
  payload: Record<string, unknown>;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

/**
 * The full live trace for a single resolver attempt. The trace page polls
 * this via GET /resolution-progress/:logId.
 */
export interface LiveProgress {
  logId: number;
  jobListingId: number;
  isFinished: boolean;
  startedAt: string;
  finishedAt: string | null;
  steps: LiveStep[];
  finalOutcome: ApplicationUrlResolutionOutcome | null;
  finalApplicationUrl: string | null;
  reason: string | null;
}

/**
 * How long (ms) to keep a finalized progress entry in memory before evicting
 * it. 10 minutes gives an admin time to refresh the trace page and review,
 * while keeping memory bounded on a container that processes many runs.
 */
const EVICT_AFTER_MS = 10 * 60 * 1000;

const store = new Map<number, LiveProgress>();
const evictTimers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Clears any pending eviction timer for the given logId. Safe to call when
 * none exists.
 *
 * @param {number} logId - The log id whose timer (if any) should be cancelled
 * @returns {void}
 */
function clearEvictTimer(logId: number): void {
  const existing = evictTimers.get(logId);
  if (existing !== undefined) {
    clearTimeout(existing);
    evictTimers.delete(logId);
  }
}

/**
 * Begins tracking a new attempt under the given logId. Replaces any prior
 * entry (and its eviction timer) so a quick re-attempt against the same
 * logId starts from a clean slate. Emits a `[resolver:attempt status=started]`
 * stdout line for the admin tail.
 *
 * @param {number} logId - The ApplicationUrlResolutionLog row id this attempt is for
 * @param {number} jobListingId - The JobListing row this attempt is resolving
 * @returns {void}
 */
export function begin(logId: number, jobListingId: number): void {
  clearEvictTimer(logId);
  const startedAt = new Date().toISOString();
  store.set(logId, {
    logId,
    jobListingId,
    isFinished: false,
    startedAt,
    finishedAt: null,
    steps: [],
    finalOutcome: null,
    finalApplicationUrl: null,
    reason: null,
  });
  console.log(`[resolver:attempt log=${String(logId)} job=${String(jobListingId)} status=started]`);
}

/**
 * Records (inserts or overwrites by stepIndex) a step for the given logId.
 * Idempotent on retry — re-sending the same stepIndex updates that slot in
 * place, which is what lets the server emit a "running" record at start and
 * a terminal-status record at end against the same index.
 *
 * Silently drops the call if no `begin` has been recorded for the logId yet
 * — the server's `/begin` POST is best-effort, so we don't want a missed
 * /begin to block step ingestion. We synthesize a placeholder progress
 * record in that case so the step is still visible to the trace page.
 *
 * Emits a single `[resolver:step ...]` stdout line per call.
 *
 * @param {number} logId - The ApplicationUrlResolutionLog row id this step belongs to
 * @param {LiveStep} step - The step record (start or terminal) to store
 * @returns {void}
 */
export function recordStep(logId: number, step: LiveStep): void {
  const existingProgress = store.get(logId);
  let progress: LiveProgress;
  if (existingProgress === undefined) {
    // Synthesize a placeholder so a step arriving before /begin (or after
    // an eviction race) still appears in the trace.
    const now = new Date().toISOString();
    progress = {
      logId,
      jobListingId: -1,
      isFinished: false,
      startedAt: now,
      finishedAt: null,
      steps: [],
      finalOutcome: null,
      finalApplicationUrl: null,
      reason: null,
    };
    store.set(logId, progress);
    console.warn(`[resolver:progress log=${String(logId)}] step arrived before begin; synthesizing placeholder`);
  } else {
    progress = existingProgress;
  }
  const existingIndex = progress.steps.findIndex((s) => s.stepIndex === step.stepIndex);
  if (existingIndex === -1) {
    progress.steps.push(step);
  } else {
    progress.steps[existingIndex] = step;
  }
  const durationPart = step.durationMs === null ? "" : ` durationMs=${String(step.durationMs)}`;
  console.log(`[resolver:step log=${String(logId)} idx=${String(step.stepIndex)} phase=${step.phase} status=${step.status}${durationPart}] "${step.message}"`);
}

/**
 * Marks the attempt as finished and schedules eviction. Subsequent
 * GET /resolution-progress/:logId calls still return the entry until the
 * timer fires, so admins watching the page see the final state.
 *
 * @param {number} logId - The ApplicationUrlResolutionLog row id this finalize is for
 * @param {ApplicationUrlResolutionOutcome | null} finalOutcome - Terminal outcome, or null when the resolver crashed before classifying
 * @param {string | null} finalApplicationUrl - The resolved URL, or null on not_found / crash
 * @param {string | null} reason - Free-text reason; usually populated on not_found
 * @returns {void}
 */
export function finalize(
  logId: number,
  finalOutcome: ApplicationUrlResolutionOutcome | null,
  finalApplicationUrl: string | null,
  reason: string | null
): void {
  const progress = store.get(logId);
  if (progress === undefined) {
    console.warn(`[resolver:progress log=${String(logId)}] finalize for unknown logId; ignoring`);
    return;
  }
  progress.isFinished = true;
  progress.finishedAt = new Date().toISOString();
  progress.finalOutcome = finalOutcome;
  progress.finalApplicationUrl = finalApplicationUrl;
  progress.reason = reason;
  console.log(`[resolver:attempt log=${String(logId)} status=finished outcome=${finalOutcome ?? "(none)"} final=${finalApplicationUrl ?? "(none)"}]`);

  clearEvictTimer(logId);
  const timer = setTimeout(() => {
    store.delete(logId);
    evictTimers.delete(logId);
    console.log(`[resolver:progress log=${String(logId)}] evicted from in-memory store after TTL`);
  }, EVICT_AFTER_MS);
  // Allow the Node process to exit without waiting for this timer.
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  evictTimers.set(logId, timer);
}

/**
 * Returns the current progress snapshot for a logId, or null when no entry
 * exists (never begun, or already evicted).
 *
 * @param {number} logId - The ApplicationUrlResolutionLog row id to look up
 * @returns {LiveProgress | null} The snapshot, or null
 */
export function get(logId: number): LiveProgress | null {
  return store.get(logId) ?? null;
}

/**
 * Test-only: drops the entry and its timer for a given logId. Exported so
 * unit tests can isolate cases without leaking state between runs.
 *
 * @param {number} logId - The log id to clear
 * @returns {void}
 */
export function clear(logId: number): void {
  clearEvictTimer(logId);
  store.delete(logId);
}

/**
 * Test-only: drops the entire store. Exported so unit tests can reset between
 * cases without restarting the module.
 *
 * @returns {void}
 */
export function clearAll(): void {
  for (const logId of evictTimers.keys()) {
    clearEvictTimer(logId);
  }
  store.clear();
}
