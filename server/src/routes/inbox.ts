/**
 * Express router for the inbox-discovery endpoints under /api/inbox.
 * Bridges HTTP requests to the discoveredJobsService, which owns all
 * business logic + persistence for DiscoveredJob rows. This module is
 * intentionally thin: parse + validate input, dispatch to the service,
 * translate service errors into the right HTTP status code, and return
 * the service's payload otherwise. Mount point is /api/inbox (see app.ts).
 */

import { Router, Request, Response } from "express";
import {
  listDiscoveries,
  importDiscoveries,
  dismissDiscovery,
  restoreDiscovery,
} from "../services/discoveredJobsService.js";
import type { DiscoveredJobStatusValue } from "../services/inboxTypes.js";
import {
  createSession,
  getActiveSession,
  getLastSession,
  getSessionById,
} from "../services/gmailSyncSessionService.js";
import { startScanWorker } from "../services/gmailSyncWorker.js";
import { getFirstConnectionId } from "../services/gmailMessageReaderService.js";
import { parseIdParam } from "./_helpers.js";

const router = Router();

/**
 * Default window (in days) applied to GET /discoveries when the query string
 * omits `days`. Matches the design's default tab — the most-recent two weeks
 * of inbox activity.
 */
const DEFAULT_DISCOVERY_WINDOW_DAYS = 14;

/**
 * Allowed runtime values for the optional `status` filter on GET /discoveries.
 * Must stay byte-identical to the DiscoveredJobStatusValue union in inboxTypes.ts
 * so requests and DB writes line up.
 */
const DISCOVERED_JOB_STATUS_VALUES = ["pending", "imported", "duplicate", "dismissed"] as const;

/**
 * Parses a value-from-anywhere into a strict positive integer. Returns null
 * when the value is not a whole positive number. Accepts numbers (from a JSON
 * body) and numeric strings (from a query string) — both must round-trip
 * cleanly to an integer.
 *
 * @param {unknown} raw - Raw input from req.body or req.query
 * @returns {number | null} The parsed positive integer, or null when invalid
 */
function parsePositiveInteger(raw: unknown): number | null {
  if (typeof raw === "number") {
    const isPositiveWhole = Number.isFinite(raw) && Number.isInteger(raw) && raw > 0;
    return isPositiveWhole ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const isEmpty = trimmed.length === 0;
    if (isEmpty) {
      return null;
    }
    const parsed = Number(trimmed);
    const isPositiveWhole = Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0;
    return isPositiveWhole ? parsed : null;
  }
  return null;
}

/**
 * Validates an unknown value as a DiscoveredJobStatusValue.
 *
 * @param {unknown} raw - Raw status query value
 * @returns {DiscoveredJobStatusValue | null} The status when valid; null otherwise
 */
function parseStatusValue(raw: unknown): DiscoveredJobStatusValue | null {
  const isString = typeof raw === "string";
  const isAllowed = isString && (DISCOVERED_JOB_STATUS_VALUES as readonly string[]).includes(raw);
  if (!isAllowed) {
    return null;
  }
  return raw as DiscoveredJobStatusValue;
}

/**
 * GET /api/inbox/discoveries
 * Lists persisted DiscoveredJob rows within a time window, optionally
 * filtered by status. Both query parameters are optional; `days` defaults to
 * 14 when omitted.
 * @param {number} [req.query.days] - Lower bound on email received-at; defaults to 14
 * @param {string} [req.query.status] - Optional status filter ("pending" | "imported" | "duplicate" | "dismissed")
 * @returns {object[]} 200 - Array of PublicDiscoveredJob
 * @returns {object} 400 - Invalid `days` or `status`
 */
router.get("/discoveries", async (req: Request, res: Response) => {
  const daysQuery = req.query["days"];
  const statusQuery = req.query["status"];

  const daysWasProvided = daysQuery !== undefined;
  let days: number = DEFAULT_DISCOVERY_WINDOW_DAYS;
  if (daysWasProvided) {
    const parsedDays = parsePositiveInteger(daysQuery);
    if (parsedDays === null) {
      res.status(400).json({ error: "days must be a positive integer when provided" });
      return;
    }
    days = parsedDays;
  }

  const statusWasProvided = statusQuery !== undefined;
  let status: DiscoveredJobStatusValue | undefined;
  if (statusWasProvided) {
    const parsedStatus = parseStatusValue(statusQuery);
    if (parsedStatus === null) {
      res.status(400).json({
        error: `status must be one of: ${DISCOVERED_JOB_STATUS_VALUES.join(", ")}`,
      });
      return;
    }
    status = parsedStatus;
  }

  const discoveries = await listDiscoveries(status === undefined ? { days } : { days, status });
  res.json(discoveries);
});

/**
 * POST /api/inbox/scan
 * Starts an inbox scan as a background worker and immediately returns the
 * session id so the client can begin polling. The scan itself walks through
 * three named steps (fetching_emails → finding_jobs → saving_jobs) and the
 * GmailSyncSession row is the source of truth for progress.
 *
 * When a scan is already running for the connection, this returns 409
 * Conflict with the existing session's id so the second caller can
 * seamlessly join the in-flight scan instead of starting a duplicate.
 *
 * @param {number} req.body.days - Lower bound on email received-at, in days back
 * @returns {object} 200 - { sessionId, status: "running", reused: false } — worker started
 * @returns {object} 400 - Missing or invalid `days`
 * @returns {object} 409 - { error: "scan_already_running", sessionId } — a scan is already in flight
 * @returns {object} 503 - No Gmail account is connected
 * @returns {object} 500 - Unexpected service failure
 */
router.post("/scan", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const daysWasProvided = "days" in body && body["days"] !== undefined && body["days"] !== null;
  if (!daysWasProvided) {
    res.status(400).json({ error: "days is required" });
    return;
  }
  const days = parsePositiveInteger(body["days"]);
  if (days === null) {
    res.status(400).json({ error: "days must be a positive integer" });
    return;
  }

  let connectionId: number;
  try {
    connectionId = await getFirstConnectionId();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const isNoGmailAccount = message.includes("No Gmail account connected");
    if (isNoGmailAccount) {
      res.status(503).json({ error: message });
      return;
    }
    throw err;
  }

  const existingActiveSession = await getActiveSession(connectionId);
  if (existingActiveSession !== null) {
    res.status(409).json({
      error: "scan_already_running",
      sessionId: existingActiveSession.id,
    });
    return;
  }

  const { sessionId } = await createSession({
    gmailConnectionId: connectionId,
    daysRequested: days,
  });
  // Fire-and-forget. The worker writes progress into the session row; the
  // client polls /api/inbox/scan/:sessionId until it leaves the `running`
  // state. Errors inside the worker are caught and persisted to the row.
  void startScanWorker(sessionId, days);
  res.json({ sessionId, status: "running", reused: false });
});

/**
 * GET /api/inbox/scan/active
 * Returns the currently-running GmailSyncSession for the connection, or
 * `null` when no scan is in flight. The client polls this on mount and
 * while a session is running so the persistent "Syncing…" button can
 * survive page reloads.
 * @returns {object} 200 - { session: PublicGmailSyncSession | null }
 * @returns {object} 503 - No Gmail account is connected
 */
router.get("/scan/active", async (_req: Request, res: Response) => {
  let connectionId: number;
  try {
    connectionId = await getFirstConnectionId();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const isNoGmailAccount = message.includes("No Gmail account connected");
    if (isNoGmailAccount) {
      res.status(503).json({ error: message });
      return;
    }
    throw err;
  }
  const activeSession = await getActiveSession(connectionId);
  res.json({ session: activeSession });
});

/**
 * GET /api/inbox/scan/last
 * Returns the most recent GmailSyncSession for the connection, regardless
 * of status. Useful for "last scan finished N seconds ago" UI and for
 * debugging a completed (or failed) run after the fact.
 * @returns {object} 200 - { session: PublicGmailSyncSession | null }
 * @returns {object} 503 - No Gmail account is connected
 */
router.get("/scan/last", async (_req: Request, res: Response) => {
  let connectionId: number;
  try {
    connectionId = await getFirstConnectionId();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const isNoGmailAccount = message.includes("No Gmail account connected");
    if (isNoGmailAccount) {
      res.status(503).json({ error: message });
      return;
    }
    throw err;
  }
  const lastSession = await getLastSession(connectionId);
  res.json({ session: lastSession });
});

/**
 * GET /api/inbox/scan/:sessionId
 * Returns a single GmailSyncSession by id. Used by the polling hook to
 * watch a known session's status transitions (running → succeeded/failed)
 * without re-running the active-session lookup every tick.
 * @param {number} req.params.sessionId - The GmailSyncSession id
 * @returns {object} 200 - { session: PublicGmailSyncSession }
 * @returns {object} 400 - Invalid sessionId parameter
 * @returns {object} 404 - No session with that id
 */
router.get("/scan/:sessionId", async (req: Request, res: Response) => {
  const sessionIdParam = req.params["sessionId"];
  const sessionId = parsePositiveInteger(sessionIdParam);
  if (sessionId === null) {
    res.status(400).json({ error: "sessionId must be a positive integer" });
    return;
  }
  const session = await getSessionById(sessionId);
  if (session === null) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  res.json({ session });
});

/**
 * POST /api/inbox/import
 * Promotes the given pending DiscoveredJob ids to real JobListing rows. The
 * service returns a per-id breakdown so the UI can render partial success.
 * @param {number[]} req.body.ids - DiscoveredJob ids to import
 * @returns {object} 200 - ImportResult { imported, failed, duplicates }
 * @returns {object} 400 - Missing/empty/non-array/non-integer ids
 */
router.post("/import", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawIds = body["ids"];
  const idsWasProvided = "ids" in body && rawIds !== undefined && rawIds !== null;
  if (!idsWasProvided) {
    res.status(400).json({ error: "ids is required" });
    return;
  }
  const isArray = Array.isArray(rawIds);
  if (!isArray) {
    res.status(400).json({ error: "ids must be an array of positive integers" });
    return;
  }
  const idsArray = rawIds as unknown[];
  const isEmpty = idsArray.length === 0;
  if (isEmpty) {
    res.status(400).json({ error: "ids must contain at least one id" });
    return;
  }
  const parsedIds: number[] = [];
  for (const entry of idsArray) {
    const parsed = parsePositiveInteger(entry);
    if (parsed === null) {
      res.status(400).json({ error: "ids must be an array of positive integers" });
      return;
    }
    parsedIds.push(parsed);
  }

  const result = await importDiscoveries(parsedIds);
  res.json(result);
});

/**
 * POST /api/inbox/discoveries/:id/dismiss
 * Flips a DiscoveredJob to status="dismissed". Service-thrown "not found" /
 * "Cannot dismiss/restore an imported discovery" errors get mapped to 404
 * and 409 respectively.
 * @param {number} req.params.id - The DiscoveredJob id
 * @returns {object} 200 - The updated DiscoveredJob row
 * @returns {object} 400 - Invalid id parameter
 * @returns {object} 404 - The DiscoveredJob does not exist
 * @returns {object} 409 - The DiscoveredJob has already been imported
 */
router.post("/discoveries/:id/dismiss", async (req: Request, res: Response) => {
  const id = parseIdParam(req, res);
  if (id === null) {
    return;
  }
  try {
    const updated = await dismissDiscovery(id);
    res.json(updated);
  } catch (err) {
    handleDiscoveryMutationError(err, res);
  }
});

/**
 * POST /api/inbox/discoveries/:id/restore
 * Flips a dismissed DiscoveredJob back to status="pending". Service-thrown
 * "not found" / "Cannot dismiss/restore an imported discovery" errors get
 * mapped to 404 and 409 respectively.
 * @param {number} req.params.id - The DiscoveredJob id
 * @returns {object} 200 - The updated DiscoveredJob row
 * @returns {object} 400 - Invalid id parameter
 * @returns {object} 404 - The DiscoveredJob does not exist
 * @returns {object} 409 - The DiscoveredJob has already been imported
 */
router.post("/discoveries/:id/restore", async (req: Request, res: Response) => {
  const id = parseIdParam(req, res);
  if (id === null) {
    return;
  }
  try {
    const updated = await restoreDiscovery(id);
    res.json(updated);
  } catch (err) {
    handleDiscoveryMutationError(err, res);
  }
});

/**
 * Maps service-thrown errors from dismiss/restore to the right HTTP status.
 * Writes 404 for "not found" failures and 409 for the imported-row guard;
 * re-throws anything else so Express's default handler emits a 500.
 *
 * @param {unknown} err - The error caught from the service call
 * @param {Response} res - The response used to write the mapped status
 * @returns {void}
 */
function handleDiscoveryMutationError(err: unknown, res: Response): void {
  const message = err instanceof Error ? err.message : "";
  const isNotFound = message.includes("not found");
  if (isNotFound) {
    res.status(404).json({ error: message });
    return;
  }
  const isImportedConflict = message.includes("Cannot dismiss/restore an imported discovery");
  if (isImportedConflict) {
    res.status(409).json({ error: message });
    return;
  }
  throw err;
}

export { router as inboxRouter };
