/**
 * Renders the design prototype's HTML (claude_tmp/design_package/apply-for-me/project/Apply for Me.html)
 * in a headless browser and captures reference screenshots used by the pixel-diff verification
 * step. Each named PNG corresponds to one of the four implementation surfaces we're rebuilding.
 *
 * Run with: npx tsx tests/playwright/__design_refs__/capture-refs.mts
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DESIGN_URL = "http://localhost:8765/Apply%20for%20Me.html";
const OUTPUT_DIR = __dirname;

/**
 * Capture a named screenshot of the design after navigating to the requested page via
 * the prototype's own client-side state.
 *
 * @param {string} name - Output filename stem (e.g. "shell" → shell.png).
 * @param {(page: import("@playwright/test").Page) => Promise<void>} setup - Drives the prototype into the desired state before snapshotting.
 */
async function captureRef(
  name: string,
  setup: (page: import("@playwright/test").Page) => Promise<void>,
): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("console", (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
    page.on("pageerror", (err) => console.log("[browser:pageerror]", err.message));
    await page.goto(DESIGN_URL);
    // The prototype boots React via babel-standalone; wait for the root to fill in.
    await page.waitForSelector(".app", { timeout: 20_000 });
    await page.waitForTimeout(500);
    await setup(page);
    await page.waitForTimeout(400);
    const outPath = resolve(OUTPUT_DIR, `${name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`captured ${name}.png`);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  // Shell + jobs landing (the prototype's default page is the dashboard, but jobs is one click away)
  await captureRef("shell", async (page) => {
    // Default landing — dashboard. Captures sidebar + topbar.
    void page;
  });

  await captureRef("sidebar-collapsed", async (page) => {
    // Topbar's first icon-btn toggles the sidebar
    await page.locator("button.icon-btn").first().click();
  });

  await captureRef("jobs", async (page) => {
    await page.getByRole("button", { name: "Jobs" }).first().click();
  });

  await captureRef("job-detail", async (page) => {
    await page.getByRole("button", { name: "Jobs" }).first().click();
    // Click the first row's title cell — the row itself is clickable per page-jobs.jsx
    await page.locator("table.tbl tbody tr").first().click();
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
