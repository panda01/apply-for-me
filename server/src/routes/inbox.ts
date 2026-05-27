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
  scanInbox,
  listDiscoveries,
  importDiscoveries,
  dismissDiscovery,
  restoreDiscovery,
} from "../services/discoveredJobsService.js";
import type { DiscoveredJobStatusValue } from "../services/inboxTypes.js";
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
 * Triggers an inbox scan: fetches recent Gmail messages, extracts jobs, and
 * upserts DiscoveredJob rows. The user explicitly opts into this — there is
 * no automatic background scanner — so the response is the ScanResult the
 * page renders alongside the discoveries list.
 * @param {number} req.body.days - Lower bound on email received-at, in days back
 * @returns {object} 200 - ScanResult { scanned, found, newDiscoveries }
 * @returns {object} 400 - Missing or invalid `days`
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

  try {
    const result = await scanInbox({ days });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const isNoGmailAccount = message.includes("No Gmail account connected");
    if (isNoGmailAccount) {
      res.status(503).json({ error: message });
      return;
    }
    throw err;
  }
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
