import { test, expect } from "@playwright/test";

/**
 * Tests the add job + view job flow:
 * - Adding a job saves instantly with just the URL (no scraping)
 * - The view page shows the URL with Fetch Data and Apply buttons
 */
test.describe("Add and View Job Flow", () => {
  test("should add a job instantly and navigate to view page with action buttons", async ({ page }) => {
    // Navigate to the add job page
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Add Job" })).toBeVisible();

    // Fill in a URL and submit
    const urlInput = page.getByLabel("Job Listing URL");
    await urlInput.fill("https://example.com/jobs/test-position");
    await page.getByRole("button", { name: "Add Job" }).click();

    // Should show success message (not scraping message)
    await expect(page.getByText("Job saved successfully!")).toBeVisible({ timeout: 5000 });

    // Should navigate to the job view page
    await expect(page).toHaveURL(/\/jobs\/\d+/);

    // View page should show the URL
    await expect(page.getByText("https://example.com/jobs/test-position")).toBeVisible();

    // Should show "Untitled" since no data has been fetched
    await expect(page.getByText("Untitled")).toBeVisible();

    // Should show both action buttons
    await expect(page.getByRole("button", { name: /Fetch Data/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Apply/ })).toBeVisible();

    // Should show the "no details yet" message
    await expect(page.getByText(/No job details yet/)).toBeVisible();

    // Should have a back link to jobs list
    await expect(page.getByRole("link", { name: /Back to Jobs List/ })).toBeVisible();
  });

  test("should show job in the jobs list after adding", async ({ page }) => {
    // Add a job first
    await page.goto("/");
    const urlInput = page.getByLabel("Job Listing URL");
    await urlInput.fill("https://example.com/jobs/list-test");
    await page.getByRole("button", { name: "Add Job" }).click();
    await expect(page.getByText("Job saved successfully!")).toBeVisible({ timeout: 5000 });

    // Navigate to jobs list
    await page.getByRole("link", { name: /Jobs/ }).first().click();
    await expect(page).toHaveURL("/jobs");

    // Should see the job URL in the list
    await expect(page.getByText("https://example.com/jobs/list-test")).toBeVisible();
  });
});
