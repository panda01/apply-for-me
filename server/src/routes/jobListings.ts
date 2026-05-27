import { Router, Request, Response } from "express";
import { parseDate } from "chrono-node";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { Prisma } from "../../prisma/generated/client/client.js";
import prisma from "../prismaClient.js";
import { scrapeJobViaContainer } from "../services/smartProxyScraperService.js";
import { findOrSpawnRunningContainer, SpawnContainerError } from "../services/managedContainerService.js";
import { resolveApplicationUrl, createContainerProgressReporter } from "../services/applicationUrlResolverService.js";
import type { ResolverOutcome, ResolutionTrace } from "../services/applicationUrlResolverService.js";
import type { StepLog } from "../services/jobApplicationService.js";
import type { ApplicationAttemptOutcome } from "../../prisma/generated/client/enums.js";
import { findJobListingOrSend404 } from "./_helpers.js";

const router = Router();

/**
 * POST /api/job-listings
 * Accepts a job listing URL and saves it to the database.
 * No scraping is triggered — use POST /api/job-listings/:id/fetch to enrich the record later.
 * @param {string} req.body.url - The URL of the job posting to save
 * @returns {object} 202 - The created job listing record
 * @returns {object} 400 - Missing or invalid url field error
 */
router.post("/", async (req: Request, res: Response) => {
  const { url } = req.body;

  const isMissingUrl = !url;
  if (isMissingUrl) {
    res.status(400).json({ error: "Missing required field: url" });
    return;
  }

  const isValidHttpUrl = typeof url === "string" && /^https?:\/\//i.test(url) && URL.canParse(url);
  if (!isValidHttpUrl) {
    res.status(400).json({ error: "Invalid url: must be a valid HTTP or HTTPS URL" });
    return;
  }

  const newJobListing = await prisma.jobListing.create({
    data: {
      url,
      title: "",
      description: "",
      post_date: new Date(),
      status: "init",
    },
  });

  res.status(202).json(newJobListing);
});

/**
 * Parses a post date string into a Date object using natural language parsing.
 * Handles relative dates like "2 hours ago", "yesterday", and absolute dates like "2026-03-01".
 * Falls back to the current date if the string cannot be parsed.
 * @param {string} postDateString - The date string to parse (e.g., "2 hours ago", "March 1, 2026")
 * @returns {Date} The parsed date, or the current date if parsing fails
 */
function parsePostDate(postDateString: string): Date {
  const parsedDate = parseDate(postDateString);
  const isUnparseable = parsedDate === null;
  if (isUnparseable) {
    return new Date();
  }
  return parsedDate;
}

/**
 * Scrapes a job listing via the managed-container smart proxy, persists the
 * scraped fields, and then attempts to resolve the off-platform application
 * URL. On resolver success the application_url column is populated; on
 * "not_found" the JobListing's status is flipped to "missing_form_url" so
 * the UI can surface the failure and offer a Retry button.
 *
 * Before kicking off the resolver, an `ApplicationUrlResolutionLog` row is
 * inserted with `outcome=null` and `managed_container_id` pointing at the
 * supplied container — this is what the live-trace UI reads to find the
 * in-progress attempt. The same row is UPDATEd with the terminal fields when
 * the resolver settles.
 *
 * Designed to be fire-and-forget from the POST /:id/fetch route — exceptions
 * are caught and logged so a stalled scrape never crashes the API.
 *
 * @param {number} jobListingId - The id of the job listing row to enrich
 * @param {string} url - The job listing URL to scrape
 * @param {{ id: number; hostPort: number }} container - The chosen managed container; its id is stored on the log row and its hostPort hosts the live progress map the resolver pushes to
 */
async function scrapeAndUpdateJobListing(
  jobListingId: number,
  url: string,
  container: { id: number; hostPort: number }
): Promise<void> {
  try {
    const scrapedData = await scrapeJobViaContainer(container.hostPort, url);

    const formattedTitle = scrapedData.company
      ? `${scrapedData.company} - ${scrapedData.title}`
      : scrapedData.title;

    await prisma.jobListing.update({
      where: { id: jobListingId },
      data: {
        title: formattedTitle,
        // Also write the normalized company directly so the inbox-discovery dedup
        // key (company + title) is available without re-parsing the formatted title.
        // Empty string when the scraper didn't return a company so the row is excluded
        // from dedup matching (see jobListingMatchService.findExistingJobListingByCompanyTitle).
        company: scrapedData.company,
        description: scrapedData.description,
        salary: scrapedData.salary,
        post_date: scrapedData.post_date !== null ? parsePostDate(scrapedData.post_date) : new Date(),
      },
    });

    const logId = await beginResolutionLog(jobListingId, container);
    const resolverResult = await resolveApplicationUrl({
      originalUrl: url,
      originalTitle: scrapedData.title,
      originalDescription: scrapedData.description,
      originalCompany: scrapedData.company,
      originalApplyButtonUrl: scrapedData.apply_button_url,
      progressReporter: createContainerProgressReporter(container.hostPort, logId),
    });

    await finalizeResolutionLog(logId, resolverResult.outcome, resolverResult.trace);
    await applyResolverOutcomeToListing(jobListingId, resolverResult.outcome);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[scraper] Failed to scrape/resolve job listing ${String(jobListingId)} at ${url}: ${errorMessage}`);
  }
}

/**
 * Inserts the `application_url_resolution_logs` row up-front (with
 * outcome=null) so the live-trace UI can find this attempt while it's still
 * running. Also POSTs `/resolution-progress/:logId/begin` to the chosen
 * container so its in-memory progress map starts tracking under the same
 * logId.
 *
 * The container `/begin` call is best-effort — a failure is logged but does
 * not block the resolver. A row with `outcome=null` and an unreachable
 * container is what the route's /url-resolution/live endpoint detects and
 * surfaces as a crashed attempt.
 *
 * @param {number} jobListingId - The id of the JobListing this attempt belongs to
 * @param {{ id: number; hostPort: number }} container - The chosen managed container to host the live progress map
 * @returns {Promise<number>} The id of the newly-inserted log row
 */
async function beginResolutionLog(
  jobListingId: number,
  container: { id: number; hostPort: number }
): Promise<number> {
  const created = await prisma.applicationUrlResolutionLog.create({
    data: {
      job_listing_id: jobListingId,
      managed_container_id: container.id,
      outcome: null,
      brave_results: "[]",
      inspected_candidates: "[]",
    },
  });

  try {
    await fetch(`http://127.0.0.1:${String(container.hostPort)}/resolution-progress/${String(created.id)}/begin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobListingId }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[resolver-log] /begin POST to container failed for log=${String(created.id)}: ${errorMessage}`);
  }

  return created.id;
}

/**
 * UPDATEs an existing `application_url_resolution_logs` row with the terminal
 * fields the resolver produced. The row already exists (it was inserted by
 * `beginResolutionLog`); this call settles its outcome, search query,
 * inspected candidates, final URL, and reason. Best-effort — a failure here
 * leaves the row in `outcome=null` state, which the live endpoint surfaces
 * as a crashed attempt.
 *
 * @param {number} logId - The id of the log row to finalize (returned by beginResolutionLog)
 * @param {ResolverOutcome} outcome - The classified resolver outcome
 * @param {ResolutionTrace} trace - The trace produced during this invocation
 * @returns {Promise<void>}
 */
async function finalizeResolutionLog(
  logId: number,
  outcome: ResolverOutcome,
  trace: ResolutionTrace
): Promise<void> {
  try {
    const finalApplicationUrl = outcome.outcome === "not_found" ? null : outcome.applicationUrl;
    const reasonText = outcome.outcome === "not_found" ? outcome.reason : null;
    await prisma.applicationUrlResolutionLog.update({
      where: { id: logId },
      data: {
        outcome: outcome.outcome,
        search_query: trace.searchQuery,
        brave_results: JSON.stringify(trace.braveResults),
        inspected_candidates: JSON.stringify(trace.inspectedCandidates),
        final_application_url: finalApplicationUrl,
        reason: reasonText,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[resolver-log] Failed to finalize resolution log ${String(logId)}: ${errorMessage}`);
  }
}

/**
 * Persists a resolver outcome onto the job listing row.
 *
 * On a success outcome (anything other than not_found): writes
 * application_url. If the row is currently stuck in "missing_form_url" from
 * a prior failed attempt, also flips status back to "init" so the UI clears
 * the failure banner and the apply gate re-opens. Other statuses
 * (applying / applied / error_applying / closed) are left untouched.
 *
 * On not_found: clears application_url and flips status to
 * "missing_form_url" so the UI can render the failure state and the apply
 * gate refuses to start an application until the user retries.
 *
 * @param {number} jobListingId - The id of the listing to update
 * @param {ResolverOutcome} outcome - The classified resolver result
 */
async function applyResolverOutcomeToListing(jobListingId: number, outcome: ResolverOutcome): Promise<void> {
  const isFound = outcome.outcome !== "not_found";
  if (isFound) {
    const currentRow = await prisma.jobListing.findUnique({
      where: { id: jobListingId },
      select: { status: true },
    });
    const isRecoveringFromMissingFormUrl = currentRow?.status === "missing_form_url";
    await prisma.jobListing.update({
      where: { id: jobListingId },
      data: isRecoveringFromMissingFormUrl
        ? { application_url: outcome.applicationUrl, status: "init" }
        : { application_url: outcome.applicationUrl },
    });
    console.log(`[resolver] Job ${String(jobListingId)} application_url resolved via ${outcome.outcome}: ${outcome.applicationUrl}${isRecoveringFromMissingFormUrl ? " (status flipped missing_form_url -> init)" : ""}`);
    return;
  }
  await prisma.jobListing.update({
    where: { id: jobListingId },
    data: { application_url: null, status: "missing_form_url" },
  });
  console.warn(`[resolver] Job ${String(jobListingId)} application_url not found: ${outcome.reason}`);
}

/**
 * POST /api/job-listings/bulk
 * Accepts an array of job listing URLs and inserts them all with status "init".
 * No background scraping is triggered — the records are created with just the URL.
 * @param {string[]} req.body.urls - Array of job posting URLs to import
 * @returns {object} 201 - The count of created records and the records themselves
 * @returns {object} 400 - Missing or invalid urls field error
 */
router.post("/bulk", async (req: Request, res: Response) => {
  const { urls } = req.body;

  const isMissingUrls = !urls || !Array.isArray(urls);
  if (isMissingUrls) {
    res.status(400).json({ error: "Missing required field: urls (must be an array)" });
    return;
  }

  const hasNoUrls = urls.length === 0;
  if (hasNoUrls) {
    res.status(400).json({ error: "urls array must not be empty" });
    return;
  }

  const invalidUrls = urls.filter((url: unknown) => {
    const isValidHttpUrl = typeof url === "string" && /^https?:\/\//i.test(url) && URL.canParse(url);
    return !isValidHttpUrl;
  });

  const hasInvalidUrls = invalidUrls.length > 0;
  if (hasInvalidUrls) {
    res.status(400).json({ error: "Invalid URLs found", invalidUrls });
    return;
  }

  const createdListings = await Promise.all(
    urls.map((url: string) =>
      prisma.jobListing.create({
        data: {
          url,
          title: "",
          description: "",
          status: "init",
        },
      })
    )
  );

  res.status(201).json({ count: createdListings.length, listings: createdListings });
});

/**
 * POST /api/job-listings/:id/fetch
 * Triggers background scraping (via the managed-container smart proxy) to enrich
 * a job listing with title, description, salary, and post date, then resolves
 * the off-platform application URL.
 *
 * Auto-spawns a managed container when none is running so the user never has
 * to spawn one manually before clicking Fetch Data. The spawn is synchronous —
 * the route blocks until the container is up (typically ~10s warm, ~30s+ cold)
 * before returning 202 — so callers know whether to expect data or an error.
 *
 * @param {number} req.params.id - The ID of the job listing to fetch data for
 * @returns {object} 202 - The current job listing record (data will update once scraping completes)
 * @returns {object} 400 - Invalid id parameter error
 * @returns {object} 404 - Job listing not found error
 * @returns {object} 503 - Auto-spawn failed and no running container could be obtained
 */
router.post("/:id/fetch", async (req: Request, res: Response) => {
  const jobListing = await findJobListingOrSend404(req, res);
  if (jobListing === null) {
    return;
  }

  let container: { id: number; hostPort: number };
  try {
    container = await findOrSpawnRunningContainer();
  } catch (err) {
    const errorMessage = err instanceof SpawnContainerError ? err.message : err instanceof Error ? err.message : String(err);
    console.error(`[fetch] auto-spawn failed for job ${String(jobListing.id)}: ${errorMessage}`);
    res.status(503).json({ error: `Could not obtain a managed container: ${errorMessage}` });
    return;
  }

  res.status(202).json(jobListing);

  scrapeAndUpdateJobListing(jobListing.id, jobListing.url, container).catch(() => {
    /* error already handled inside scrapeAndUpdateJobListing */
  });
});

/**
 * POST /api/job-listings/:id/resolve-application-url
 * Re-runs the application-URL resolver against the persisted DB fields for a
 * job listing whose initial resolution failed. Reads the stored title +
 * description + url and runs the resolver without an apply_button_url hint
 * (so the resolver re-scrapes the original URL to inspect its apply button).
 *
 * Returns 202 immediately and runs the resolver async; the row updates when
 * the resolver completes. The UI polls and reflects the new state.
 *
 * @param {number} req.params.id - The ID of the job listing to retry resolution for
 * @returns {object} 202 - The current job listing record (will update once resolution completes)
 * @returns {object} 400 - Invalid id parameter error or missing scraped title/description (run /fetch first)
 * @returns {object} 404 - Job listing not found error
 * @returns {object} 503 - No running managed container available to perform the resolution
 */
router.post("/:id/resolve-application-url", async (req: Request, res: Response) => {
  const jobListing = await findJobListingOrSend404(req, res);
  if (jobListing === null) {
    return;
  }

  const hasNoScrapedFields =
    !jobListing.title || jobListing.title.length === 0 ||
    !jobListing.description || jobListing.description.length === 0;
  if (hasNoScrapedFields) {
    res.status(400).json({ error: "Job listing has not been scraped yet. Run POST /:id/fetch first." });
    return;
  }

  let container: { id: number; hostPort: number };
  try {
    container = await findOrSpawnRunningContainer();
  } catch (err) {
    const errorMessage = err instanceof SpawnContainerError ? err.message : err instanceof Error ? err.message : String(err);
    console.error(`[resolver:retry] auto-spawn failed for job ${String(jobListing.id)}: ${errorMessage}`);
    res.status(503).json({ error: `Could not obtain a managed container: ${errorMessage}` });
    return;
  }

  // Synchronously insert the in-progress log row BEFORE returning 202 so the
  // frontend (which navigates to /jobs/:id/url-resolution as soon as this
  // returns) can find the attempt on its very first poll. Without this, the
  // trace page would 404 in the brief window before the async resolver
  // started writing.
  const logId = await beginResolutionLog(jobListing.id, container);

  res.status(202).json({ ...jobListing, latest_resolution_log_id: logId });

  // Narrowing — hasNoScrapedFields guard above guarantees these are non-null/non-empty.
  runResolverForExistingListing(jobListing.id, jobListing.url, jobListing.title!, jobListing.description!, container, logId).catch(() => {
    /* error already handled inside runResolverForExistingListing */
  });
});

/**
 * Runs the application-URL resolver for a listing that's already been scraped.
 * Used by POST /:id/resolve-application-url so the retry path doesn't re-scrape
 * fields the user has already seen. Wraps the resolver in a try/catch so any
 * unexpected failure is logged rather than thrown into an async void.
 *
 * The retry route inserts the `ApplicationUrlResolutionLog` row synchronously
 * before returning 202 (so the frontend's trace page never 404s on the first
 * poll); this function receives that row's id, runs the resolver with a
 * progressReporter wired to the same container/logId, and UPDATEs the row
 * with the terminal fields when the resolver settles.
 *
 * @param {number} jobListingId - The id of the listing to update
 * @param {string} url - The original (Indeed/LinkedIn) URL
 * @param {string} formattedTitle - The persisted formatted title ("Company - Role"); the company prefix is stripped before passing to the resolver so title-match comparisons stay accurate
 * @param {string} description - The persisted description text
 * @param {{ id: number; hostPort: number }} container - The chosen managed container hosting the live progress map
 * @param {number} logId - The pre-inserted ApplicationUrlResolutionLog row id this attempt belongs to
 */
async function runResolverForExistingListing(
  jobListingId: number,
  url: string,
  formattedTitle: string,
  description: string,
  container: { id: number; hostPort: number },
  logId: number
): Promise<void> {
  try {
    const { company, title } = splitFormattedTitle(formattedTitle);
    const resolverResult = await resolveApplicationUrl({
      originalUrl: url,
      originalTitle: title,
      originalDescription: description,
      originalCompany: company,
      // No apply-button hint — let the resolver re-scrape the original URL.
      progressReporter: createContainerProgressReporter(container.hostPort, logId),
    });
    await finalizeResolutionLog(logId, resolverResult.outcome, resolverResult.trace);
    await applyResolverOutcomeToListing(jobListingId, resolverResult.outcome);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[resolver:retry] Failed for job listing ${String(jobListingId)}: ${errorMessage}`);
  }
}

/**
 * GET /api/job-listings/:id/resolution-logs
 * Returns every resolver attempt for this job listing, latest first. The two
 * JSON columns (brave_results, inspected_candidates) are parsed on the server
 * so the client never has to double-parse.
 *
 * @param {number} req.params.id - The ID of the job listing
 * @returns {object[]} 200 - Array of parsed resolution-log rows, newest first
 * @returns {object} 400 - Invalid id parameter
 * @returns {object} 404 - Job listing not found
 */
router.get("/:id/resolution-logs", async (req: Request, res: Response) => {
  const jobListing = await findJobListingOrSend404(req, res);
  if (jobListing === null) {
    return;
  }
  const rows = await prisma.applicationUrlResolutionLog.findMany({
    where: { job_listing_id: jobListing.id },
    orderBy: { created_date: "desc" },
  });
  const parsed = rows.map(parseResolutionLogRow);
  res.json(parsed);
});

/**
 * Shape of a resolution-log row after the two JSON columns have been parsed.
 * Returned by GET /:id/resolution-logs. `outcome` is null while the resolver
 * attempt is still running (the row was inserted up-front so the live-trace
 * UI can find it); it is populated to a terminal value on finalize.
 */
export interface ParsedResolutionLog {
  id: number;
  job_listing_id: number;
  managed_container_id: number | null;
  outcome: string | null;
  search_query: string | null;
  brave_results: unknown[];
  inspected_candidates: unknown[];
  final_application_url: string | null;
  reason: string | null;
  created_date: Date;
}

/**
 * Type alias for a raw `ApplicationUrlResolutionLog` row as returned by
 * `prisma.applicationUrlResolutionLog.findMany`. Derived rather than hand-rolled
 * so it stays in sync with the generated client.
 */
type ResolutionLogRow = Awaited<ReturnType<typeof prisma.applicationUrlResolutionLog.findMany>>[number];

/**
 * Parses the two text-as-JSON columns from a single resolution-log row.
 * Tolerates malformed JSON by falling back to an empty array, so a single
 * corrupted historical row never breaks the entire list response.
 *
 * @param {ResolutionLogRow} row - The raw row from Prisma
 * @returns {ParsedResolutionLog} The row with the JSON columns parsed
 */
export function parseResolutionLogRow(row: ResolutionLogRow): ParsedResolutionLog {
  const safeParse = (raw: string): unknown[] => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  return {
    id: row.id,
    job_listing_id: row.job_listing_id,
    managed_container_id: row.managed_container_id,
    outcome: row.outcome,
    search_query: row.search_query,
    brave_results: safeParse(row.brave_results),
    inspected_candidates: safeParse(row.inspected_candidates),
    final_application_url: row.final_application_url,
    reason: row.reason,
    created_date: row.created_date,
  };
}

/**
 * Shape of an ApplicationAttemptLogs row after the `logs` JSON column has
 * been parsed and a `has_submission_screenshot` boolean has been derived
 * from `submission_screenshot_path`. The raw filesystem path is never sent
 * over the wire — clients use the dedicated streaming endpoint to fetch
 * the image.
 */
export interface ParsedApplicationAttempt {
  id: number;
  job_listing_id: number;
  end_response: ApplicationAttemptOutcome;
  has_submission_screenshot: boolean;
  step_logs: StepLog[];
  created_date: Date;
}

/**
 * Type alias for a raw `ApplicationAttemptLogs` row as returned by
 * `prisma.applicationAttemptLogs.findMany`. Derived rather than hand-rolled
 * so it stays in sync with the generated client.
 */
type AttemptLogRow = Awaited<ReturnType<typeof prisma.applicationAttemptLogs.findMany>>[number];

/**
 * Parses the `logs` text-as-JSON column and derives the
 * `has_submission_screenshot` boolean from a single attempt-log row.
 * Tolerates malformed JSON by falling back to an empty array, so a single
 * corrupted historical row never breaks the entire list response.
 *
 * @param {AttemptLogRow} row - The raw row from Prisma
 * @returns {ParsedApplicationAttempt} The row with `step_logs` parsed and the path-derived boolean
 */
export function parseAttemptLogRow(row: AttemptLogRow): ParsedApplicationAttempt {
  const safeParseStepLogs = (raw: string): StepLog[] => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as StepLog[]) : [];
    } catch {
      return [];
    }
  };
  return {
    id: row.id,
    job_listing_id: row.job_listing_id,
    end_response: row.end_response,
    has_submission_screenshot: row.submission_screenshot_path !== null,
    step_logs: safeParseStepLogs(row.logs),
    created_date: row.created_date,
  };
}

/**
 * Validates a path-param that should be a positive integer, sending a 400
 * response when malformed. Express types path params as `string | string[]`,
 * so we narrow to string before parsing. Returns the parsed integer or null
 * when an error response has already been written.
 *
 * @param {unknown} raw - The raw param value from req.params
 * @param {Response} res - The response (used to write 400 on error)
 * @param {string} fieldName - The name to surface in the error message
 * @returns {number | null} The parsed integer or null when invalid
 */
function parsePositiveIntegerParamOrSend400(raw: unknown, res: Response, fieldName: string): number | null {
  const isString = typeof raw === "string";
  const parsed = isString ? Number(raw) : NaN;
  const isValid = Number.isInteger(parsed) && parsed > 0;
  if (!isValid) {
    res.status(400).json({ error: `Invalid ${fieldName} parameter — must be a positive integer` });
    return null;
  }
  return parsed;
}

/**
 * Streams a PNG file to the response with image/png + no-store headers and
 * client-hangup cleanup. 404s when the file is missing on disk. Used by both
 * the canonical submission-screenshot endpoint and the per-step screenshot
 * endpoint so the streaming behavior stays in one place.
 *
 * @param {Request} req - The request (used to listen for client hangup)
 * @param {Response} res - The response to stream into
 * @param {string} filePath - Absolute path to the PNG file to stream
 */
async function streamScreenshotOrSend404(req: Request, res: Response, filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    res.status(404).json({ error: "Screenshot file is missing on disk" });
    return;
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, no-store");
  const stream = createReadStream(filePath);
  req.on("close", () => stream.destroy());
  stream.on("error", (err) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[jobListings] Stream error for ${filePath}: ${errorMessage}`);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream screenshot" });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

/**
 * GET /api/job-listings/:id/attempts
 * Returns the JobListing row PLUS the array of all ApplicationAttemptLogs for
 * the job (newest first). Each attempt has `step_logs` pre-parsed and a
 * boolean `has_submission_screenshot` derived from the path column — the raw
 * filesystem path is never exposed on the wire.
 *
 * @param {number} req.params.id - The ID of the job listing
 * @returns {object} 200 - { ...jobListing, attempts: ParsedApplicationAttempt[] }
 * @returns {object} 400 - Invalid id parameter
 * @returns {object} 404 - Job listing not found
 */
router.get("/:id/attempts", async (req: Request, res: Response) => {
  const jobListing = await findJobListingOrSend404(req, res);
  if (jobListing === null) {
    return;
  }
  const rows = await prisma.applicationAttemptLogs.findMany({
    where: { job_listing_id: jobListing.id },
    orderBy: { created_date: "desc" },
  });
  const attempts = rows.map(parseAttemptLogRow);
  res.json({ ...jobListing, attempts });
});

/**
 * GET /api/job-listings/:jobId/attempts/:attemptId
 * Returns a single ApplicationAttemptLogs row with `step_logs` parsed and the
 * derived `has_submission_screenshot` boolean, augmented with a small
 * `job_listing` block (id, title, url) so the detail page can render a back
 * link without a second round-trip. 404 when the attempt doesn't exist or
 * doesn't belong to the supplied job.
 *
 * @param {number} req.params.jobId - The parent job listing ID
 * @param {number} req.params.attemptId - The application attempt ID
 * @returns {object} 200 - { ...ParsedApplicationAttempt, job_listing: { id, title, url } }
 * @returns {object} 400 - Invalid id parameter
 * @returns {object} 404 - Job listing not found, or attempt not found / not owned by the job
 */
router.get("/:jobId/attempts/:attemptId", async (req: Request, res: Response) => {
  const jobId = parsePositiveIntegerParamOrSend400(req.params["jobId"], res, "jobId");
  if (jobId === null) return;
  const attemptId = parsePositiveIntegerParamOrSend400(req.params["attemptId"], res, "attemptId");
  if (attemptId === null) return;

  const attempt = await prisma.applicationAttemptLogs.findUnique({
    where: { id: attemptId },
    include: { job_listing: { select: { id: true, title: true, url: true } } },
  });
  if (attempt === null || attempt.job_listing_id !== jobId) {
    res.status(404).json({ error: "Application attempt not found for this job" });
    return;
  }
  const parsed = parseAttemptLogRow(attempt);
  res.json({ ...parsed, job_listing: attempt.job_listing });
});

/**
 * GET /api/job-listings/:jobId/attempts/:attemptId/submission-screenshot
 * Streams the canonical Phase-4 ("Reviewing application") screenshot for an
 * attempt with image/png + no-store cache headers. 404s when the attempt has
 * no recorded path or when the file is missing on disk.
 *
 * @param {number} req.params.jobId - The parent job listing ID
 * @param {number} req.params.attemptId - The application attempt ID
 * @returns {Buffer} 200 - The PNG bytes
 * @returns {object} 400 - Invalid id parameter
 * @returns {object} 404 - Attempt not found, no submission screenshot recorded, or file missing
 */
router.get("/:jobId/attempts/:attemptId/submission-screenshot", async (req: Request, res: Response) => {
  const jobId = parsePositiveIntegerParamOrSend400(req.params["jobId"], res, "jobId");
  if (jobId === null) return;
  const attemptId = parsePositiveIntegerParamOrSend400(req.params["attemptId"], res, "attemptId");
  if (attemptId === null) return;

  const attempt = await prisma.applicationAttemptLogs.findUnique({
    where: { id: attemptId },
    select: { id: true, job_listing_id: true, submission_screenshot_path: true },
  });
  if (attempt === null || attempt.job_listing_id !== jobId) {
    res.status(404).json({ error: "Application attempt not found for this job" });
    return;
  }
  if (attempt.submission_screenshot_path === null) {
    res.status(404).json({ error: "Attempt has no submission screenshot recorded" });
    return;
  }
  await streamScreenshotOrSend404(req, res, attempt.submission_screenshot_path);
});

/**
 * GET /api/job-listings/:jobId/attempts/:attemptId/steps/:stepNumber/screenshot
 * Streams the per-step screenshot for an attempt. Reads from
 * `{log_directory}/step-{stepNumber}.png` — the log_directory column tells
 * the route where the per-attempt PNG files live.
 *
 * @param {number} req.params.jobId - The parent job listing ID
 * @param {number} req.params.attemptId - The application attempt ID
 * @param {number} req.params.stepNumber - The Browser-Use step number (positive integer)
 * @returns {Buffer} 200 - The PNG bytes
 * @returns {object} 400 - Invalid id or stepNumber parameter
 * @returns {object} 404 - Attempt not found, no log_directory recorded, or step PNG missing
 */
router.get("/:jobId/attempts/:attemptId/steps/:stepNumber/screenshot", async (req: Request, res: Response) => {
  const jobId = parsePositiveIntegerParamOrSend400(req.params["jobId"], res, "jobId");
  if (jobId === null) return;
  const attemptId = parsePositiveIntegerParamOrSend400(req.params["attemptId"], res, "attemptId");
  if (attemptId === null) return;
  const stepNumber = parsePositiveIntegerParamOrSend400(req.params["stepNumber"], res, "stepNumber");
  if (stepNumber === null) return;

  const attempt = await prisma.applicationAttemptLogs.findUnique({
    where: { id: attemptId },
    select: { id: true, job_listing_id: true, log_directory: true },
  });
  if (attempt === null || attempt.job_listing_id !== jobId) {
    res.status(404).json({ error: "Application attempt not found for this job" });
    return;
  }
  if (attempt.log_directory === null) {
    res.status(404).json({ error: "Attempt has no log_directory recorded" });
    return;
  }
  const filePath = resolvePath(attempt.log_directory, `step-${String(stepNumber)}.png`);
  await streamScreenshotOrSend404(req, res, filePath);
});

/**
 * Splits a stored "Company - Title" formatted title back into its parts so
 * the resolver gets a clean job title (which the match step normalizes and
 * compares against candidate-page titles). Falls back to treating the whole
 * string as the title when no separator is present.
 *
 * @param {string} formattedTitle - Either "Company - Title" or just "Title"
 * @returns {{ company: string; title: string }} Best-effort split; company is empty when no separator exists
 */
export function splitFormattedTitle(formattedTitle: string): { company: string; title: string } {
  const separatorIndex = formattedTitle.indexOf(" - ");
  const hasNoSeparator = separatorIndex === -1;
  if (hasNoSeparator) {
    return { company: "", title: formattedTitle };
  }
  return {
    company: formattedTitle.slice(0, separatorIndex).trim(),
    title: formattedTitle.slice(separatorIndex + 3).trim(),
  };
}

/**
 * Builds the Prisma `where` clause for the GET /api/job-listings search filter.
 *
 * When the trimmed query string is empty (or input is null/undefined), returns
 * `undefined` so callers can omit the `where` key entirely and `findMany`
 * returns every row. When non-empty, returns an OR-clause matching `contains`
 * across the four user-visible text columns: title, description, url, and
 * application_url.
 *
 * SQLite case-insensitivity caveat: this project's Prisma datasource is
 * SQLite, and Prisma's `contains` operator on SQLite does NOT accept the
 * `mode: 'insensitive'` flag — passing it throws at runtime. SQLite's default
 * `LIKE` collation is ASCII case-insensitive (pragma `case_sensitive_like` is
 * OFF by default), so a bare `{ contains: q }` already matches mixed-case
 * input for ASCII characters, which is acceptable for this English-only
 * project. That is why no `mode` flag is supplied below.
 *
 * `title` and `description` are nullable on the JobListing model; Prisma's
 * `contains` correctly evaluates to false for NULL rows, so no extra
 * null-handling is required here.
 *
 * @param {string | undefined} searchQuery - Raw query string from the request (may be undefined, empty, or whitespace).
 * @returns {Prisma.JobListingWhereInput | undefined} The OR-filter when the trimmed query is non-empty; `undefined` to signal "no filter, return all rows" so the caller omits the `where` key on `findMany`.
 */
export function buildJobListingsWhereClause(
  searchQuery: string | undefined
): Prisma.JobListingWhereInput | undefined {
  const isMissing = searchQuery === undefined || searchQuery === null;
  if (isMissing) {
    return undefined;
  }
  const trimmedQuery = searchQuery.trim();
  const isEmptyAfterTrim = trimmedQuery.length === 0;
  if (isEmptyAfterTrim) {
    return undefined;
  }
  return {
    OR: [
      { title: { contains: trimmedQuery } },
      { description: { contains: trimmedQuery } },
      { url: { contains: trimmedQuery } },
      { application_url: { contains: trimmedQuery } },
    ],
  };
}

/**
 * GET /api/job-listings
 * Retrieves job listings from the database, ordered by created_date descending.
 *
 * Supports an optional `q` query-string parameter for substring filtering.
 * When `q` is omitted or trims to empty, every listing is returned (current
 * behavior). When `q` is non-empty, the result is restricted to rows where
 * the (trimmed) value appears as a substring in any of: `title`,
 * `description`, `url`, or `application_url`.
 *
 * Matching is ASCII case-insensitive because this project uses SQLite and
 * SQLite's default `LIKE` collation is case-insensitive for ASCII. The
 * `mode: 'insensitive'` flag is intentionally NOT passed to Prisma — see
 * {@link buildJobListingsWhereClause} for the full rationale (Prisma's
 * SQLite driver throws when that flag is set).
 *
 * Array-valued `req.query.q` (e.g. `?q=a&q=b`) is coerced to undefined; only
 * a single string value is honored.
 *
 * @param {string} [req.query.q] - Optional substring to filter by; matched against title, description, url, and application_url.
 * @returns {object[]} 200 - Array of matching job listings, ordered by created_date desc.
 */
router.get("/", async (req: Request, res: Response) => {
  const rawSearchQuery = req.query.q;
  const isSingleStringQuery = typeof rawSearchQuery === "string";
  const searchQuery = isSingleStringQuery ? rawSearchQuery : undefined;
  const whereClause = buildJobListingsWhereClause(searchQuery);
  const hasWhereClause = whereClause !== undefined;
  const jobListings = await prisma.jobListing.findMany({
    orderBy: { created_date: "desc" },
    ...(hasWhereClause ? { where: whereClause } : {}),
  });

  res.json(jobListings);
});

/**
 * GET /api/job-listings/:id
 * Retrieves a single job listing by its ID, augmented with a
 * `resolution_in_progress` boolean computed from the latest
 * ApplicationUrlResolutionLog row (true when its `outcome` is null). The
 * JobViewPage uses this flag to swap its Retry button for a "View Resolution
 * Progress" link without needing a second request.
 *
 * @param {number} req.params.id - The ID of the job listing
 * @returns {object} 200 - The job listing fields + `resolution_in_progress: boolean`
 * @returns {object} 404 - Job listing not found error
 */
router.get("/:id", async (req: Request, res: Response) => {
  const jobListing = await findJobListingOrSend404(req, res);
  if (jobListing === null) {
    return;
  }
  const latestLog = await prisma.applicationUrlResolutionLog.findFirst({
    where: { job_listing_id: jobListing.id },
    orderBy: { created_date: "desc" },
    select: { id: true, outcome: true },
  });
  const isResolutionInProgress = latestLog !== null && latestLog.outcome === null;
  res.json({
    ...jobListing,
    resolution_in_progress: isResolutionInProgress,
    latest_resolution_log_id: latestLog?.id ?? null,
  });
});

/**
 * GET /api/job-listings/:id/url-resolution/live
 * Returns the live trace for the latest application-URL resolution attempt
 * on this job. Used by the admin UrlResolutionTracePage which polls this
 * endpoint every ~1s while the attempt is running and falls through to the
 * final synthesized payload once it terminates.
 *
 * Three response shapes:
 *  - 404 when no resolution attempt has been recorded yet.
 *  - In-progress (outcome=null in the log row): proxies the container's
 *    /resolution-progress/:logId GET. If the container can't be reached or
 *    has no entry, returns a synthesized "crashed" terminal payload so the
 *    page exits its polling loop.
 *  - Terminal (outcome non-null): returns a synthesized LiveProgress built
 *    from the durable log fields, so the trace page still renders after the
 *    container's in-memory entry expires.
 *
 * @param {number} req.params.id - The ID of the job listing
 * @returns {object} 200 - The live progress JSON (in-progress or synthesized terminal)
 * @returns {object} 404 - No resolution attempts found for this job
 */
router.get("/:id/url-resolution/live", async (req: Request, res: Response) => {
  const jobListing = await findJobListingOrSend404(req, res);
  if (jobListing === null) {
    return;
  }
  const latestLog = await prisma.applicationUrlResolutionLog.findFirst({
    where: { job_listing_id: jobListing.id },
    orderBy: { created_date: "desc" },
  });
  if (latestLog === null) {
    res.status(404).json({ error: "No resolution attempts found for this job" });
    return;
  }

  const isStillRunning = latestLog.outcome === null;
  if (isStillRunning) {
    const container = latestLog.managed_container_id === null
      ? null
      : await prisma.managedContainer.findUnique({ where: { id: latestLog.managed_container_id }, select: { hostPort: true } });
    if (container === null) {
      res.json(buildCrashedLiveProgressPayload(latestLog.id, jobListing.id, latestLog.created_date.toISOString(), "Resolution attempt is missing its managed container; cannot fetch live progress."));
      return;
    }
    try {
      const upstream = await fetch(`http://127.0.0.1:${String(container.hostPort)}/resolution-progress/${String(latestLog.id)}`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (upstream.ok) {
        const live = await upstream.json() as unknown;
        res.json(live);
        return;
      }
      if (upstream.status === 404) {
        res.json(buildCrashedLiveProgressPayload(latestLog.id, jobListing.id, latestLog.created_date.toISOString(), "Container did not return live progress; the process may have crashed."));
        return;
      }
      res.json(buildCrashedLiveProgressPayload(latestLog.id, jobListing.id, latestLog.created_date.toISOString(), `Container returned status ${String(upstream.status)}; cannot fetch live progress.`));
      return;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      res.json(buildCrashedLiveProgressPayload(latestLog.id, jobListing.id, latestLog.created_date.toISOString(), `Container unreachable: ${errorMessage}`));
      return;
    }
  }

  // Terminal — synthesize a LiveProgress from the persisted log row.
  res.json(buildTerminalLiveProgressFromLog(latestLog, jobListing.id));
});

/**
 * Builds a "crashed terminal" LiveProgress payload used when the resolver's
 * log row still has outcome=null but its container can't be reached or no
 * longer has the progress entry in memory. Lets the trace page exit its
 * polling loop with a clear reason rather than spinning indefinitely.
 *
 * @param {number} logId - The id of the log row this payload describes
 * @param {number} jobListingId - The job listing id the attempt was for
 * @param {string} startedAt - ISO timestamp of when the attempt was recorded
 * @param {string} reason - Free-text reason to surface in the UI
 * @returns {object} A LiveProgress-shaped object with isFinished=true and finalOutcome=null
 */
function buildCrashedLiveProgressPayload(
  logId: number,
  jobListingId: number,
  startedAt: string,
  reason: string
): {
  logId: number;
  jobListingId: number;
  isFinished: boolean;
  startedAt: string;
  finishedAt: string;
  steps: unknown[];
  finalOutcome: null;
  finalApplicationUrl: null;
  reason: string;
} {
  return {
    logId,
    jobListingId,
    isFinished: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    steps: [],
    finalOutcome: null,
    finalApplicationUrl: null,
    reason,
  };
}

/**
 * Synthesizes a LiveProgress payload from a finalized log row so the trace
 * page can still render the final state long after the container has evicted
 * the in-memory entry. Step entries are derived from the persisted Brave
 * results and inspected-candidate verdicts so admins still see a meaningful
 * timeline post-eviction.
 *
 * @param {ResolutionLogRow} row - The terminal log row
 * @param {number} jobListingId - The job listing id this attempt was for
 * @returns {object} A LiveProgress-shaped object derived from the persisted fields
 */
function buildTerminalLiveProgressFromLog(
  row: ResolutionLogRow,
  jobListingId: number
): {
  logId: number;
  jobListingId: number;
  isFinished: boolean;
  startedAt: string;
  finishedAt: string;
  steps: Array<{
    stepIndex: number;
    phase: string;
    status: string;
    message: string;
    payload: Record<string, unknown>;
    startedAt: string;
    endedAt: string;
    durationMs: number | null;
  }>;
  finalOutcome: string | null;
  finalApplicationUrl: string | null;
  reason: string | null;
} {
  const startedAt = row.created_date.toISOString();
  const parsedBraveResults: unknown[] = (() => {
    try {
      const parsed: unknown = JSON.parse(row.brave_results);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const parsedInspectedCandidates: unknown[] = (() => {
    try {
      const parsed: unknown = JSON.parse(row.inspected_candidates);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const syntheticSteps: Array<{
    stepIndex: number;
    phase: string;
    status: string;
    message: string;
    payload: Record<string, unknown>;
    startedAt: string;
    endedAt: string;
    durationMs: number | null;
  }> = [];
  let stepIndex = 0;

  if (row.search_query !== null) {
    syntheticSteps.push({
      stepIndex: stepIndex++,
      phase: "brave_search",
      status: "succeeded",
      message: `Brave query: "${row.search_query}" returned ${String(parsedBraveResults.length)} result(s)`,
      payload: { query: row.search_query, results: parsedBraveResults, resultCount: parsedBraveResults.length },
      startedAt,
      endedAt: startedAt,
      durationMs: null,
    });
  }

  for (const candidate of parsedInspectedCandidates) {
    const candidateRecord = candidate as { url?: unknown; scrapedTitle?: unknown; matched?: unknown; rejectionReason?: unknown };
    const url = typeof candidateRecord.url === "string" ? candidateRecord.url : "(unknown)";
    const scrapedTitle = typeof candidateRecord.scrapedTitle === "string" ? candidateRecord.scrapedTitle : "";
    const matched = candidateRecord.matched === true;
    const rejectionReason = typeof candidateRecord.rejectionReason === "string" ? candidateRecord.rejectionReason : "";
    syntheticSteps.push({
      stepIndex: stepIndex++,
      phase: "candidate_evaluate",
      status: matched ? "succeeded" : "skipped",
      message: matched ? `Match accepted: ${rejectionReason}` : `Match rejected: ${rejectionReason}`,
      payload: { url, scrapedTitle, matched, reason: rejectionReason },
      startedAt,
      endedAt: startedAt,
      durationMs: null,
    });
  }

  // row.outcome is non-null in this branch — the caller only invokes
  // buildTerminalLiveProgressFromLog when the log row has terminated.
  syntheticSteps.push({
    stepIndex,
    phase: "finalize",
    status: "succeeded",
    message: row.reason ?? `Outcome: ${String(row.outcome)}`,
    payload: { outcome: row.outcome, applicationUrl: row.final_application_url, reason: row.reason },
    startedAt,
    endedAt: startedAt,
    durationMs: null,
  });

  return {
    logId: row.id,
    jobListingId,
    isFinished: true,
    startedAt,
    finishedAt: startedAt,
    steps: syntheticSteps,
    finalOutcome: row.outcome,
    finalApplicationUrl: row.final_application_url,
    reason: row.reason,
  };
}

/**
 * DELETE /api/job-listings/:id
 * Deletes a job listing by its ID.
 * @param {number} req.params.id - The ID of the job listing to delete
 * @returns {object} 200 - The deleted job listing
 * @returns {object} 404 - Job listing not found error
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const existingJobListing = await findJobListingOrSend404(req, res);
  if (existingJobListing === null) {
    return;
  }

  const deletedJobListing = await prisma.jobListing.delete({
    where: { id: existingJobListing.id },
  });

  res.json(deletedJobListing);
});

export { router as jobListingsRouter, scrapeAndUpdateJobListing, parsePostDate, applyResolverOutcomeToListing };
