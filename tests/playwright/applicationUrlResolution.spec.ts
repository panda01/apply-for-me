import { test, expect } from "@playwright/test";

/**
 * Tests the application_url resolution UI surfaces on the JobViewPage:
 * - The Apply button is hidden until application_url is set (the gate).
 * - The source URL link is always visible so the user can cross-reference
 *   the original Indeed/LinkedIn job posting.
 *
 * The deeper end-to-end (Brave Search → smart-proxy /analyze → resolver
 * → application_url populated) needs a running Docker daemon, a managed
 * container, and a BRAVE_SEARCH_API_KEY; the manual-verifier agent runs
 * that flow against a live environment. These tests only exercise the UI
 * surfaces that are reachable from a freshly-added job (no container
 * required), which is what regressions would most likely break.
 */
test.describe("Application URL resolution UI", () => {
  test("Apply button is hidden on a freshly-added job (apply gate)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Add Job" })).toBeVisible();

    const urlInput = page.getByLabel("Job Listing URL");
    await urlInput.fill("https://example.com/jobs/resolver-spec-1");
    await page.getByRole("button", { name: "Add Job" }).click();

    await expect(page).toHaveURL(/\/jobs\/\d+/);

    // Source URL is always visible; Apply button is gated on application_url.
    await expect(page.getByTestId("source-url-link")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Apply$/ })).toHaveCount(0);
  });

  test("Source URL link points at the original posting", async ({ page }) => {
    await page.goto("/");
    const urlInput = page.getByLabel("Job Listing URL");
    await urlInput.fill("https://example.com/jobs/resolver-spec-2");
    await page.getByRole("button", { name: "Add Job" }).click();

    await expect(page).toHaveURL(/\/jobs\/\d+/);

    const sourceLink = page.getByTestId("source-url-link");
    await expect(sourceLink).toHaveAttribute("href", "https://example.com/jobs/resolver-spec-2");
    await expect(sourceLink).toHaveAttribute("target", "_blank");
  });

  test("URL resolution trace page renders the empty state on a fresh job", async ({ page }) => {
    // A freshly-added job has no resolution attempts, so the trace page should
    // surface its empty-state copy rather than render a header/timeline.
    await page.goto("/");
    const urlInput = page.getByLabel("Job Listing URL");
    await urlInput.fill("https://example.com/jobs/resolver-spec-3");
    await page.getByRole("button", { name: "Add Job" }).click();

    await expect(page).toHaveURL(/\/jobs\/\d+/);
    const jobUrlMatch = /\/jobs\/(\d+)/.exec(page.url());
    if (jobUrlMatch === null) {
      throw new Error(`Expected /jobs/<id> URL after add, got: ${page.url()}`);
    }
    const jobId = jobUrlMatch[1];

    await page.goto(`/jobs/${jobId}/url-resolution`);
    await expect(page.getByTestId("trace-empty-state")).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to Job View/ })).toBeVisible();
  });
});
