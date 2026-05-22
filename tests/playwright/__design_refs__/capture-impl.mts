/**
 * Captures the live implementation in the same four states the design references show,
 * so they can be diffed section-by-section against tests/playwright/__design_refs__/*.png.
 *
 * Assumes the dev server is already running on $CLIENT_PORT (the script does not start one).
 * Writes PNGs to claude_tmp/impl_screenshots/.
 *
 * Run with: npx tsx tests/playwright/__design_refs__/capture-impl.mts
 */
import { chromium } from "@playwright/test";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
config({ path: resolve(PROJECT_ROOT, ".env") });

const clientPort = process.env["CLIENT_PORT"];
if (!clientPort) throw new Error("CLIENT_PORT not set");
const BASE_URL = `http://localhost:${clientPort}`;
const OUT_DIR = resolve(PROJECT_ROOT, "claude_tmp/impl_screenshots");

/**
 * Capture a screenshot of the running app after navigating to the given route and running
 * an optional setup hook (e.g. to seed a job or toggle the sidebar).
 *
 * @param {string} name - Filename stem (e.g. "shell" → shell.png in OUT_DIR).
 * @param {string} route - Route to navigate to (e.g. "/jobs").
 * @param {(page: import("@playwright/test").Page) => Promise<void>} [setup] - Optional post-load setup.
 */
async function captureImpl(
  name: string,
  route: string,
  setup?: (page: import("@playwright/test").Page) => Promise<void>,
): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log(`[browser:pageerror ${name}]`, err.message));
    await page.goto(`${BASE_URL}${route}`);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    // Give animations / fonts a moment to settle.
    await page.waitForTimeout(800);
    if (setup) await setup(page);
    await page.waitForTimeout(400);
    const outPath = resolve(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`captured ${name}.png`);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  await captureImpl("shell", "/jobs");

  await captureImpl("sidebar-collapsed", "/jobs", async (page) => {
    // First icon-btn in the topbar toggles the sidebar.
    await page.locator(".topbar button").first().click();
  });

  await captureImpl("jobs", "/jobs");

  // job-detail: navigate to /jobs, then click the first row if present. If table is empty,
  // we still produce a screenshot so the diff step can flag the structural shape.
  await captureImpl("job-detail", "/jobs", async (page) => {
    const firstRow = page.locator("table tbody tr").first();
    if (await firstRow.count()) {
      await firstRow.click();
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(600);
    }
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
