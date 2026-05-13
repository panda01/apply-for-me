import express, { Request, Response } from "express";
import { chromium, Browser, BrowserContext, BrowserContextOptions } from "patchright";
import { promises as fs } from "node:fs";
import { join as joinPath } from "node:path";
import { createHash } from "node:crypto";
import { runAnalyzeAgent } from "./agent.js";
import { captureCleanedScreenshot } from "./popup.js";
import { getSmartproxyConfig } from "./smartproxy.js";

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
 * @returns {object} 200 - { is_job_description, apply_button_present, description_signals, reasoning, screenshot_b64 }
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

app.listen(PORT, () => {
  console.log(`Managed container "${containerName}" listening on port ${String(PORT)}`);
});
