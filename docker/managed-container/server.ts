import express, { Request, Response } from "express";
import { chromium, Browser } from "playwright";

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
 * If the browser ever disconnects (crashes, OOM-killed, etc.) the cached promise is
 * cleared so the next caller relaunches a fresh instance instead of getting a dead one.
 * @returns {Promise<Browser>} The shared Chromium browser
 */
async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ headless: true }).then((browser) => {
    browser.on("disconnected", () => {
      browserPromise = null;
    });
    return browser;
  });
  return browserPromise;
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
 * Captures a full-page PNG screenshot of the given URL using Playwright.
 * The page is loaded inside this container, so its egress passes through wg0,
 * meaning the screenshot is taken from the WireGuard exit IP — not the host.
 * @param {string} req.body.url - The URL to render and screenshot
 * @returns {Buffer} 200 - image/png bytes of the full page
 * @returns {object} 400 - { error } when the URL is missing or not a string
 * @returns {object} 500 - { error } when navigation or capture fails
 */
app.post("/screenshot", async (req: Request, res: Response) => {
  const rawUrl = (req.body as { url?: unknown } | undefined)?.url;
  const isInvalidUrl = typeof rawUrl !== "string" || rawUrl.length === 0;
  if (isInvalidUrl) {
    res.status(400).json({ error: "Request body must include a non-empty 'url' string" });
    return;
  }
  const targetUrl = rawUrl;

  let context;
  let page;
  try {
    const browser = await getBrowser();
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "load", timeout: PAGE_NAV_TIMEOUT_MS });
    const pngBuffer = await page.screenshot({ type: "png", fullPage: true });
    res.setHeader("Content-Type", "image/png");
    res.send(pngBuffer);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[screenshot] Capture failed for ${targetUrl}: ${errorMessage}`);
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

app.listen(PORT, () => {
  console.log(`Managed container "${containerName}" listening on port ${String(PORT)}`);
});
