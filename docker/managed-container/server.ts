import express, { Request, Response } from "express";
import { chromium, Browser, BrowserContext, BrowserContextOptions } from "patchright";
import { promises as fs } from "node:fs";
import { join as joinPath } from "node:path";
import { createHash } from "node:crypto";
import { runAnalyzeAgent } from "./agent.js";
import { captureCleanedScreenshot } from "./popup.js";
import { getSmartproxyConfig } from "./smartproxy.js";
import {
  begin as beginProgress,
  recordStep as recordProgressStep,
  finalize as finalizeProgress,
  get as getProgress,
  type LiveStep,
} from "./resolutionProgressStore.js";
import {
  isResolutionPhase,
  isStepStatus,
  isApplicationUrlResolutionOutcome,
} from "./resolutionTypes.js";

/**
 * Where every captured screenshot is persisted inside the container, before
 * the bytes are sent back over HTTP. /var/lib follows the FHS convention for
 * "variable state data that the system can write" and survives across requests
 * (within the lifetime of the container — these are ephemeral by design,
 * deleted when the container is removed by the host's shutdown cleanup).
 *
 * Filenames are `<ISO-timestamp>-<8-char-url-hash>.png`, e.g.
 *   /var/lib/afm/screenshots/2026-05-08T19-30-45-123Z-a1b2c3d4.png
 * Sortable by capture time, deduplicated by target URL, easy to scan.
 */
const SCREENSHOTS_DIR = "/var/lib/afm/screenshots";

/**
 * We import chromium from `patchright` rather than `playwright`. Patchright is
 * a maintained Playwright fork that scrubs the deeper CDP automation traces
 * (Runtime.Enable timing, executionContextId exposure, Page.frameAttached
 * patterns, the `--enable-automation` flag side-effects) that puppeteer-extra-
 * plugin-stealth cannot reach because they live below the JS layer.
 *
 * Stealth is intentionally NOT applied on top — patchright's docs explicitly
 * warn that puppeteer-extra-plugin-stealth on top of patchright weakens the
 * binary-level patches by re-introducing JS-level overrides that fingerprinters
 * can specifically detect.
 */

const PORT = 3000;
const containerName = process.env.CONTAINER_NAME ?? "unknown";

/**
 * Maximum time (ms) Playwright will wait for the page to reach the chosen
 * load state before failing the screenshot. Kept generous because traffic
 * goes through the WireGuard tunnel, which can add latency.
 */
const PAGE_NAV_TIMEOUT_MS = 30000;

/**
 * Cached Playwright browser instance. Chromium is launched lazily on the first
 * /screenshot call and reused across requests to avoid the multi-second
 * cold-start penalty per capture. The promise lets concurrent first-callers
 * share a single launch.
 */
let browserPromise: Promise<Browser> | null = null;

/**
 * Returns the shared Chromium browser, launching it on first call.
 * Runs in *headed* mode against the Xvfb virtual display the entrypoint set up
 * (DISPLAY=:99). Headed mode reduces residual fingerprints that headless
 * Chromium leaks even with stealth applied. --no-sandbox is required because
 * the Playwright noble image runs as root; --disable-dev-shm-usage avoids
 * crashes when /dev/shm is small (Docker default 64MB).
 * If the browser ever disconnects (crashes, OOM-killed, etc.) the cached promise is
 * cleared so the next caller relaunches a fresh instance instead of getting a dead one.
 * @returns {Promise<Browser>} The shared Chromium browser
 */
async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  }).then((browser) => {
    browser.on("disconnected", () => {
      browserPromise = null;
    });
    return browser;
  });
  return browserPromise;
}

/**
 * Writes a captured PNG to the on-disk screenshots directory (creating it on
 * first call), returning the filesystem path so the caller can log it.
 *
 * The filename is `<safe-iso-timestamp>-<8-char-url-sha256>.png`. Failures
 * here are intentionally non-fatal: a write error is logged but the request
 * still returns the screenshot bytes to the caller. We don't want a disk-full
 * condition to break captures that were otherwise successful.
 *
 * @param {string} targetUrl - The URL that was captured (used to derive the hash suffix)
 * @param {Buffer} pngBuffer - The PNG bytes to write
 * @returns {Promise<string | null>} Absolute path of the written file, or null on failure
 */
async function persistScreenshot(targetUrl: string, pngBuffer: Buffer): Promise<string | null> {
  try {
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
    const urlHash = createHash("sha256").update(targetUrl).digest("hex").slice(0, 8);
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${safeTimestamp}-${urlHash}.png`;
    const filepath = joinPath(SCREENSHOTS_DIR, filename);
    await fs.writeFile(filepath, pngBuffer);
    return filepath;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[persist] Failed to write screenshot for ${targetUrl}: ${errorMessage}`);
    return null;
  }
}

/**
 * Builds the BrowserContextOptions used by /screenshot and /analyze. When
 * `useProxy` is true, attaches the Smartproxy residential-proxy config; when
 * false (or omitted), returns empty options so the context uses the
 * container's default egress (currently WireGuard).
 *
 * Throws when `useProxy` is true but no Smartproxy creds are configured —
 * the caller turns that into a 500 with the message, so the user gets a
 * clear error instead of silently falling back to the unintended path.
 *
 * @param {boolean} useProxy - Whether to route this context through Smartproxy
 * @returns {BrowserContextOptions} Options for browser.newContext()
 */
function buildContextOptions(useProxy: boolean): BrowserContextOptions {
  // TEMPORARY: pin viewport to 1281x999 @ DPR 2 to match the user's reference
  // screenshot (2562x1998). Remove before committing if not wanted permanently.
  const sharedOptions: BrowserContextOptions = {
    viewport: { width: 1281, height: 999 },
    deviceScaleFactor: 2,
  };
  if (!useProxy) {
    return sharedOptions;
  }
  const proxyConfig = getSmartproxyConfig();
  if (proxyConfig === null) {
    throw new Error(
      "useProxy=true but SMARTPROXY_USERNAME / SMARTPROXY_PASSWORD are not set on the container"
    );
  }
  return { ...sharedOptions, proxy: proxyConfig };
}

const app = express();
app.use(express.json());

/**
 * GET /health
 * Health check endpoint for the managed container.
 * @returns {object} 200 - { status: "ok", name: <CONTAINER_NAME> }
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", name: containerName });
});

/**
 * GET /name
 * Returns the configured container name.
 * @returns {object} 200 - { name: <CONTAINER_NAME> }
 */
app.get("/name", (_req: Request, res: Response) => {
  res.json({ name: containerName });
});

/**
 * POST /screenshot
 * Captures a PNG screenshot of the given URL using Playwright. By default the
 * page is loaded through the container's WireGuard egress; if `useProxy` is
 * true, the per-request browser context is configured to use Smartproxy
 * residential exits instead, which bypasses Cloudflare's datacenter-IP
 * blocks (e.g. Indeed) at the cost of per-GB proxy fees.
 * The page goes through the shared popup-dismissal pass, then is scrolled
 * incrementally to trigger lazy-loaded content, then captured at full-page
 * height — capped at 5000 px so infinite-scroll pages don't blow up the
 * response or hang. See popup.ts:captureCleanedScreenshot for details.
 * @param {string} req.body.url - The URL to render and screenshot
 * @param {boolean} [req.body.useProxy] - When true, route through Smartproxy
 * @returns {Buffer} 200 - image/png bytes (cleaned, capped at 5000 px tall)
 * @returns {object} 400 - { error } when the URL is missing or not a string
 * @returns {object} 500 - { error } when navigation or capture fails (incl. missing proxy creds when useProxy=true)
 */
app.post("/screenshot", async (req: Request, res: Response) => {
  const body = req.body as { url?: unknown; useProxy?: unknown } | undefined;
  const rawUrl = body?.url;
  const isInvalidUrl = typeof rawUrl !== "string" || rawUrl.length === 0;
  if (isInvalidUrl) {
    res.status(400).json({ error: "Request body must include a non-empty 'url' string" });
    return;
  }
  const targetUrl = rawUrl;
  const useProxy = body?.useProxy === true;

  let context: BrowserContext | undefined;
  let page;
  try {
    const browser = await getBrowser();
    context = await browser.newContext(buildContextOptions(useProxy));
    page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "load", timeout: PAGE_NAV_TIMEOUT_MS });
    const pngBuffer = await captureCleanedScreenshot(page);
    const savedPath = await persistScreenshot(targetUrl, pngBuffer);
    if (savedPath !== null) {
      console.log(`[screenshot] saved ${String(pngBuffer.byteLength)} bytes to ${savedPath}`);
    }
    res.setHeader("Content-Type", "image/png");
    res.send(pngBuffer);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[screenshot] Capture failed for ${targetUrl} (useProxy=${String(useProxy)}): ${errorMessage}`);
    res.status(500).json({ error: `Screenshot failed: ${errorMessage}` });
  } finally {
    if (page !== undefined) {
      await page.close().catch(() => { /* ignore close error */ });
    }
    if (context !== undefined) {
      await context.close().catch(() => { /* ignore close error */ });
    }
  }
});

/**
 * POST /analyze
 * Runs the Claude tool-calling agent against the supplied URL to determine
 * whether it is a job description page. The agent dismisses popups, summarizes
 * the page, optionally clicks elements, takes a screenshot, then reports.
 * By default the agent's page is loaded through WireGuard; when `useProxy` is
 * true, the per-request browser context is routed through Smartproxy
 * residential exits — necessary for Cloudflare-protected sites like Indeed.
 * @param {string} req.body.url - The URL to analyze
 * @param {boolean} [req.body.useProxy] - When true, route the agent's page through Smartproxy
 * @returns {object} 200 - { is_job_description, apply_button_present, description_signals, reasoning, screenshot_b64, title, company, description, salary, post_date, apply_button_url }
 * @returns {object} 400 - Missing or invalid URL
 * @returns {object} 500 - Agent loop or upstream Claude error (incl. missing proxy creds when useProxy=true)
 */
app.post("/analyze", async (req: Request, res: Response) => {
  const body = req.body as { url?: unknown; useProxy?: unknown } | undefined;
  const rawUrl = body?.url;
  const isInvalidUrl = typeof rawUrl !== "string" || rawUrl.length === 0;
  if (isInvalidUrl) {
    res.status(400).json({ error: "Request body must include a non-empty 'url' string" });
    return;
  }
  const targetUrl = rawUrl;
  const useProxy = body?.useProxy === true;

  let context: BrowserContext | undefined;
  let page;
  try {
    const browser = await getBrowser();
    context = await browser.newContext(buildContextOptions(useProxy));
    page = await context.newPage();
    const result = await runAnalyzeAgent(page, targetUrl);
    const analyzePngBuffer = Buffer.from(result.screenshot_b64, "base64");
    const savedAnalyzePath = await persistScreenshot(targetUrl, analyzePngBuffer);
    if (savedAnalyzePath !== null) {
      console.log(`[analyze] saved ${String(analyzePngBuffer.byteLength)} bytes to ${savedAnalyzePath}`);
    }
    res.json(result);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[analyze] Agent failed for ${targetUrl} (useProxy=${String(useProxy)}): ${errorMessage}`);
    res.status(500).json({ error: `Analyze failed: ${errorMessage}` });
  } finally {
    if (page !== undefined) {
      await page.close().catch(() => { /* ignore close error */ });
    }
    if (context !== undefined) {
      await context.close().catch(() => { /* ignore close error */ });
    }
  }
});

/**
 * Hard cap on the number of links returned by /extract-links. Careers pages
 * with hundreds of anchors (filter rails, footer nav, location selectors)
 * should not blow up the resolver's host-side fuzzy-match step or the JSON
 * response size. 500 is generous enough to cover realistic careers index
 * pages while bounding worst-case payloads.
 */
const EXTRACT_LINKS_HARD_CAP = 500;

/**
 * Default per-request timeout (ms) for /extract-links navigation. Matches
 * the other Playwright endpoints; can be lowered per-request via the
 * `timeoutMs` body field for callers that want to fail fast on JS-heavy
 * SPAs.
 */
const EXTRACT_LINKS_DEFAULT_TIMEOUT_MS = PAGE_NAV_TIMEOUT_MS;

/**
 * Browser-side function passed to `page.evaluate` by /extract-links. Iterates
 * over every `<a>` tag in the rendered DOM, resolves relative href values to
 * absolute URLs against the page's base, and returns the trimmed link text +
 * accessible-name. Declared at module scope so its source is portable across
 * Playwright contexts (no closure captures from the enclosing route).
 *
 * @returns {Array<{ href: string; text: string; accessibleName: string }>} One entry per anchor with an absolute http(s) href
 */
function collectAnchorsForExtractLinks(): { href: string; text: string; accessibleName: string }[] {
  const results: { href: string; text: string; accessibleName: string }[] = [];
  for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a"))) {
    const href = anchor.href;
    const isAbsoluteHttpHref =
      typeof href === "string" &&
      (href.startsWith("http://") || href.startsWith("https://"));
    if (!isAbsoluteHttpHref) continue;
    const text = (anchor.textContent ?? "").trim().replace(/\s+/g, " ");
    const ariaLabel = (anchor.getAttribute("aria-label") ?? "").trim();
    const title = (anchor.getAttribute("title") ?? "").trim();
    const accessibleName = ariaLabel.length > 0 ? ariaLabel : title;
    results.push({ href, text, accessibleName });
  }
  return results;
}

/**
 * POST /extract-links
 * Navigates to the supplied URL and returns every absolute http(s) anchor
 * on the rendered page. The host's careersPageHarvesterService consumes the
 * response: it fuzzy-matches link text + accessibleName against a target job
 * title to choose which hrefs to scrape via /analyze.
 *
 * The response is capped at EXTRACT_LINKS_HARD_CAP entries; pathological
 * pages do not blow up the JSON payload.
 *
 * @param {string} req.body.url - The page URL to navigate and inspect
 * @param {string} [req.body.waitForSelector] - When supplied, page.waitForSelector is called before extraction to give JS-heavy pages a chance to render
 * @param {number} [req.body.timeoutMs] - Override navigation/wait timeout (ms); defaults to EXTRACT_LINKS_DEFAULT_TIMEOUT_MS
 * @param {boolean} [req.body.useProxy] - When true, route the page fetch through Smartproxy
 * @returns {object} 200 - { url, links: Array<{ href, text, accessibleName }> }
 * @returns {object} 400 - Missing or invalid URL/options
 * @returns {object} 500 - Navigation or extraction failure (incl. missing proxy creds when useProxy=true)
 */
app.post("/extract-links", async (req: Request, res: Response) => {
  const body = req.body as { url?: unknown; waitForSelector?: unknown; timeoutMs?: unknown; useProxy?: unknown } | undefined;
  const rawUrl = body?.url;
  const isInvalidUrl = typeof rawUrl !== "string" || rawUrl.length === 0;
  if (isInvalidUrl) {
    res.status(400).json({ error: "Request body must include a non-empty 'url' string" });
    return;
  }
  const targetUrl = rawUrl;
  const useProxy = body?.useProxy === true;
  const rawWaitForSelector = body?.waitForSelector;
  const waitForSelector = typeof rawWaitForSelector === "string" && rawWaitForSelector.length > 0 ? rawWaitForSelector : null;
  const rawTimeoutMs = body?.timeoutMs;
  const isValidTimeout = typeof rawTimeoutMs === "number" && Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0;
  const timeoutMs = isValidTimeout ? rawTimeoutMs : EXTRACT_LINKS_DEFAULT_TIMEOUT_MS;

  let context: BrowserContext | undefined;
  let page;
  try {
    const browser = await getBrowser();
    context = await browser.newContext(buildContextOptions(useProxy));
    page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "load", timeout: timeoutMs });
    if (waitForSelector !== null) {
      await page.waitForSelector(waitForSelector, { timeout: timeoutMs });
    }
    const rawLinks = await page.evaluate(collectAnchorsForExtractLinks);
    const cappedLinks = rawLinks.slice(0, EXTRACT_LINKS_HARD_CAP);
    res.json({ url: targetUrl, links: cappedLinks });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[extract-links] Extraction failed for ${targetUrl} (useProxy=${String(useProxy)}): ${errorMessage}`);
    res.status(500).json({ error: `Extract-links failed: ${errorMessage}` });
  } finally {
    if (page !== undefined) {
      await page.close().catch(() => { /* ignore close error */ });
    }
    if (context !== undefined) {
      await context.close().catch(() => { /* ignore close error */ });
    }
  }
});

/**
 * Validates and extracts the :logId path parameter for the
 * /resolution-progress/* endpoints. Sends a 400 directly and returns null
 * when the value is not a positive integer.
 *
 * @param {Request} req - The express request
 * @param {Response} res - The express response (used to send 400 on bad input)
 * @returns {number | null} The parsed log id, or null when invalid
 */
function parseLogIdParam(req: Request, res: Response): number | null {
  const rawParam = req.params.logId;
  const raw = typeof rawParam === "string" ? rawParam : "";
  const parsed = Number.parseInt(raw, 10);
  const isInvalid = !Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== raw;
  if (isInvalid) {
    res.status(400).json({ error: `Invalid logId: "${raw}"` });
    return null;
  }
  return parsed;
}

/**
 * POST /resolution-progress/:logId/begin
 * Initializes the in-memory progress entry for a new resolver attempt.
 * Replaces any prior entry under the same logId.
 *
 * @param {number} req.params.logId - The ApplicationUrlResolutionLog row id
 * @param {number} req.body.jobListingId - The JobListing row this attempt is resolving
 * @returns {object} 204 - Created (empty body)
 * @returns {object} 400 - Invalid logId or missing/invalid jobListingId
 */
app.post("/resolution-progress/:logId/begin", (req: Request, res: Response) => {
  const logId = parseLogIdParam(req, res);
  if (logId === null) return;

  const body = req.body as { jobListingId?: unknown } | undefined;
  const rawJobListingId = body?.jobListingId;
  const isInvalidJobListingId =
    typeof rawJobListingId !== "number" || !Number.isFinite(rawJobListingId) || rawJobListingId <= 0;
  if (isInvalidJobListingId) {
    res.status(400).json({ error: "Request body must include a positive integer 'jobListingId'" });
    return;
  }

  beginProgress(logId, rawJobListingId);
  res.status(204).end();
});

/**
 * POST /resolution-progress/:logId/step
 * Inserts (or overwrites by stepIndex) one step of an in-progress resolver
 * attempt. The same stepIndex is sent twice per phase: once with status
 * "running" at the start and once with a terminal status at the end.
 *
 * @param {number} req.params.logId - The ApplicationUrlResolutionLog row id
 * @param {number} req.body.stepIndex - Monotonic index assigned by the server-side reporter
 * @param {string} req.body.phase - One of ResolutionPhase
 * @param {string} req.body.status - One of StepStatus
 * @param {string} req.body.message - Human-readable summary
 * @param {object} req.body.payload - Structured detail blob
 * @param {string} req.body.startedAt - ISO timestamp the step began
 * @param {string|null} req.body.endedAt - ISO timestamp the step ended (null while still running)
 * @param {number|null} req.body.durationMs - Elapsed ms (null while still running)
 * @returns {object} 204 - Recorded (empty body)
 * @returns {object} 400 - Invalid logId or step body
 */
app.post("/resolution-progress/:logId/step", (req: Request, res: Response) => {
  const logId = parseLogIdParam(req, res);
  if (logId === null) return;

  const body = req.body as Partial<LiveStep> | undefined;
  const rawStepIndex = body?.stepIndex;
  const rawPhase = body?.phase;
  const rawStatus = body?.status;
  const rawMessage = body?.message;
  const rawPayload = body?.payload;
  const rawStartedAt = body?.startedAt;
  const rawEndedAt = body?.endedAt;
  const rawDurationMs = body?.durationMs;

  const isInvalidStepIndex = typeof rawStepIndex !== "number" || !Number.isFinite(rawStepIndex) || rawStepIndex < 0;
  if (isInvalidStepIndex) {
    res.status(400).json({ error: "Body must include a non-negative integer 'stepIndex'" });
    return;
  }
  if (!isResolutionPhase(rawPhase)) {
    res.status(400).json({ error: `Body 'phase' must be one of the ResolutionPhase enum values; got: ${String(rawPhase)}` });
    return;
  }
  if (!isStepStatus(rawStatus)) {
    res.status(400).json({ error: `Body 'status' must be one of the StepStatus enum values; got: ${String(rawStatus)}` });
    return;
  }
  if (typeof rawMessage !== "string") {
    res.status(400).json({ error: "Body 'message' must be a string" });
    return;
  }
  if (typeof rawStartedAt !== "string") {
    res.status(400).json({ error: "Body 'startedAt' must be an ISO timestamp string" });
    return;
  }
  const payload: Record<string, unknown> =
    rawPayload !== undefined && !Array.isArray(rawPayload)
      ? rawPayload
      : {};
  const endedAt = typeof rawEndedAt === "string" ? rawEndedAt : null;
  const durationMs = typeof rawDurationMs === "number" && Number.isFinite(rawDurationMs) ? rawDurationMs : null;

  recordProgressStep(logId, {
    stepIndex: rawStepIndex,
    phase: rawPhase,
    status: rawStatus,
    message: rawMessage,
    payload,
    startedAt: rawStartedAt,
    endedAt,
    durationMs,
  });
  res.status(204).end();
});

/**
 * POST /resolution-progress/:logId/finalize
 * Marks the attempt as finished and stores the final outcome. The entry
 * stays queryable for ~10 minutes before being evicted from memory.
 *
 * @param {number} req.params.logId - The ApplicationUrlResolutionLog row id
 * @param {string|null} req.body.finalOutcome - One of ApplicationUrlResolutionOutcome, or null when the resolver crashed before classifying
 * @param {string|null} req.body.finalApplicationUrl - The resolved URL, or null on not_found / crash
 * @param {string|null} req.body.reason - Free-text reason; usually populated on not_found
 * @returns {object} 204 - Finalized (empty body)
 * @returns {object} 400 - Invalid logId or finalOutcome value
 */
app.post("/resolution-progress/:logId/finalize", (req: Request, res: Response) => {
  const logId = parseLogIdParam(req, res);
  if (logId === null) return;

  const body = req.body as { finalOutcome?: unknown; finalApplicationUrl?: unknown; reason?: unknown } | undefined;
  const rawFinalOutcome = body?.finalOutcome;
  const isFinalOutcomeAcceptable = rawFinalOutcome === null || isApplicationUrlResolutionOutcome(rawFinalOutcome);
  if (!isFinalOutcomeAcceptable) {
    // Coerce non-string finalOutcome to JSON for a useful 400 body; lets us
    // satisfy ESLint's no-base-to-string without leaking an "[object Object]".
    const displayValue = typeof rawFinalOutcome === "string" ? rawFinalOutcome : JSON.stringify(rawFinalOutcome);
    res.status(400).json({ error: `Body 'finalOutcome' must be one of ApplicationUrlResolutionOutcome or null; got: ${displayValue}` });
    return;
  }
  const rawFinalApplicationUrl = body?.finalApplicationUrl;
  const finalApplicationUrl = typeof rawFinalApplicationUrl === "string" ? rawFinalApplicationUrl : null;
  const rawReason = body?.reason;
  const reason = typeof rawReason === "string" ? rawReason : null;

  finalizeProgress(logId, rawFinalOutcome ?? null, finalApplicationUrl, reason);
  res.status(204).end();
});

/**
 * GET /resolution-progress/:logId
 * Returns the current live progress snapshot for a resolver attempt, or 404
 * when no entry exists (never begun, or already evicted from memory).
 *
 * @param {number} req.params.logId - The ApplicationUrlResolutionLog row id
 * @returns {object} 200 - The LiveProgress JSON
 * @returns {object} 400 - Invalid logId
 * @returns {object} 404 - No live progress entry for this logId
 */
app.get("/resolution-progress/:logId", (req: Request, res: Response) => {
  const logId = parseLogIdParam(req, res);
  if (logId === null) return;
  const progress = getProgress(logId);
  if (progress === null) {
    res.status(404).json({ error: `No live progress entry for logId=${String(logId)}` });
    return;
  }
  res.json(progress);
});

app.listen(PORT, () => {
  console.log(`Managed container "${containerName}" listening on port ${String(PORT)}`);
});
