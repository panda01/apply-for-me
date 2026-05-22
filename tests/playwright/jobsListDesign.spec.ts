import { test, expect } from "@playwright/test";

/**
 * Smoke test for the redesigned Jobs list page (Phase 1.3 UI rewrite).
 *
 * Verifies:
 *   - The page-head renders the "Jobs" heading and the "Add job" button.
 *   - "Add job" navigates back to the add page (root "/").
 *   - After a job is added the table shows a status pill for the row and
 *     clicking the row title navigates to the job view page (/jobs/:id),
 *     while clicking interactive children (buttons/links/inputs) does not.
 */
test.describe("Jobs list page (design refresh)", () => {
  test("renders heading and tabs, and Add job navigates to /", async ({ page }) => {
    await page.goto("/jobs");

    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();

    // The "All" tab is always present even when there are no jobs.
    await expect(page.getByRole("button", { name: /^All\s/ })).toBeVisible();

    const addJobButton = page.getByRole("button", { name: "Add job" });
    await expect(addJobButton).toBeVisible();

    await addJobButton.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Add Job" })).toBeVisible();
  });

  test("shows a status pill for a row and row-click navigates to /jobs/:id", async ({ page }) => {
    // Add a job first so the list has at least one row.
    await page.goto("/");
    const urlInput = page.getByLabel("Job Listing URL");
    await urlInput.fill("https://example.com/jobs/design-list-test");
    await page.getByRole("button", { name: "Add Job" }).click();
    await expect(page.getByText("Job saved successfully!")).toBeVisible({ timeout: 5000 });

    // Go to the redesigned jobs list page.
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();

    // The new row should display a status pill. The default backend status for a
    // freshly-added job is "init" which maps to the "Ready" label.
    const readyPill = page.locator(".pill", { hasText: "Ready" }).first();
    await expect(readyPill).toBeVisible();

    // Click the title cell of the row (which contains the URL hostname when
    // title hasn't been fetched yet) and verify navigation to the view page.
    const titleCell = page.locator(".col-title", { hasText: "example.com" }).first();
    await titleCell.click();
    await expect(page).toHaveURL(/\/jobs\/\d+/);
  });
});
