import { test, expect } from "@playwright/test";

/**
 * Tests the new clickable-row → per-job attempts list → per-attempt detail page
 * navigation flow. The deep happy-path with a real submission screenshot is
 * exercised end-to-end by the manual-verifier (a real Browser-Use apply
 * actually fires and persists a row). This spec covers the UI-routing and
 * error-handling pieces that don't require a real apply.
 */
test.describe("Attempts navigation flow", () => {
  test("dashboard row click navigates to /jobs/:id/attempts", async ({ page }) => {
    // Create a fresh job so the dashboard has a clickable row regardless of
    // what other test runs left behind. The new job lands in the Ready section.
    await page.goto("/");
    await page.getByLabel("Job Listing URL").fill("https://example.com/jobs/playwright-attempts-row-click");
    await page.getByRole("button", { name: "Add Job" }).click();
    await expect(page.getByText("Job saved successfully!")).toBeVisible({ timeout: 5000 });

    // Capture the new job's id from the resulting URL (/jobs/:id).
    const jobUrl = page.url();
    const jobIdMatch = /\/jobs\/(\d+)/.exec(jobUrl);
    expect(jobIdMatch).not.toBeNull();
    if (jobIdMatch === null) throw new Error("unreachable: jobIdMatch checked above");
    const jobId = jobIdMatch[1];

    // Now visit the Apply dashboard and click the row body to navigate.
    await page.goto("/apply");
    const row = page.locator(`text=https://example.com/jobs/playwright-attempts-row-click`).first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.click({ position: { x: 5, y: 5 } });

    await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}/attempts$`));
    await expect(page.getByText("No attempts yet for this job.")).toBeVisible();
  });

  test("empty attempts list shows the empty state", async ({ page }) => {
    // Create a job + go directly to its attempts page; no attempts exist yet.
    await page.goto("/");
    await page.getByLabel("Job Listing URL").fill("https://example.com/jobs/playwright-empty-attempts");
    await page.getByRole("button", { name: "Add Job" }).click();
    await expect(page.getByText("Job saved successfully!")).toBeVisible({ timeout: 5000 });

    const jobUrl = page.url();
    const jobIdMatch = /\/jobs\/(\d+)/.exec(jobUrl);
    expect(jobIdMatch).not.toBeNull();
    if (jobIdMatch === null) throw new Error("unreachable: jobIdMatch checked above");
    const jobId = jobIdMatch[1];

    await page.goto(`/jobs/${jobId}/attempts`);
    await expect(page.getByText("No attempts yet for this job.")).toBeVisible();
  });

  test("/applications/:id without ?jobId renders the missing-jobId error", async ({ page }) => {
    await page.goto("/applications/1");
    await expect(page.getByText(/Missing jobId/)).toBeVisible({ timeout: 5000 });
  });

  test("/applications/abc?jobId=1 renders the invalid-attempt-id error", async ({ page }) => {
    await page.goto("/applications/abc?jobId=1");
    await expect(page.getByText("Invalid attempt ID in the URL")).toBeVisible({ timeout: 5000 });
  });
});
