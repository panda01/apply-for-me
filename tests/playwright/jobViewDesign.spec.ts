import { test, expect } from "@playwright/test";

/**
 * Happy-path Playwright spec for the new design of the Job view (detail) page.
 *
 * Verifies that after a brand-new job is added (via the Add Job form on `/`)
 * and the user navigates into it via the Jobs list, the new design renders
 * the expected pieces:
 *   - the "Back to jobs" affordance is present
 *   - the page title falls back to the URL hostname while `title` is empty
 *     (since Fetch Data hasn't run yet)
 *   - the design's StatusPill is visible (status="init" → "Ready" colorway)
 *   - the Manage list shows the placeholder rows for the unwired actions
 *
 * NOTE: this spec is intentionally NOT run as part of the agent's task; the
 * orchestrator wires it into CI separately.
 */
test.describe("Job View — design rewrite", () => {
  test("renders the new two-column layout for a freshly-added job", async ({ page }) => {
    // Add a job via the Add Job page so we have a stable id to drill into.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Add Job" })).toBeVisible();

    const urlInput = page.getByLabel("Job Listing URL");
    await urlInput.fill("https://example.com/jobs/design-rewrite-smoke");
    await page.getByRole("button", { name: "Add Job" }).click();
    await expect(page.getByText("Job saved successfully!")).toBeVisible({ timeout: 5000 });

    // Land on /jobs and click into the row we just added. The Jobs list page
    // is owned by a sibling agent; this test only assumes a clickable element
    // surfaces the source URL string.
    await page.goto("/jobs");
    await page.getByText("https://example.com/jobs/design-rewrite-smoke").first().click();
    await expect(page).toHaveURL(/\/jobs\/\d+/);

    // Header — Back link + title fallback to the URL hostname while the
    // backend `title` field is empty.
    const backButton = page.getByTestId("back-to-jobs-button");
    await expect(backButton).toBeVisible();
    await expect(backButton).toContainText("Back to jobs");

    const jobTitle = page.getByTestId("job-title");
    await expect(jobTitle).toBeVisible();
    await expect(jobTitle).toContainText("example.com");

    // Company-logo placeholder shows the first letter of the URL hostname.
    const companyLogo = page.getByTestId("company-logo");
    await expect(companyLogo).toBeVisible();
    await expect(companyLogo).toHaveText("E");

    // StatusPill (init → "Ready") sits inside the Details meta-list.
    const statusPill = page.locator(".pill[data-status='saved']");
    await expect(statusPill.first()).toBeVisible();
    await expect(statusPill.first()).toContainText("Ready");

    // Source URL link in the Details meta-list points at the saved URL.
    const sourceUrlLink = page.getByTestId("source-url-link");
    await expect(sourceUrlLink).toBeVisible();
    await expect(sourceUrlLink).toContainText("https://example.com/jobs/design-rewrite-smoke");

    // Manage list — all four placeholder rows render.
    await expect(page.getByTestId("manage-move-saved")).toBeVisible();
    await expect(page.getByTestId("manage-mark-interview")).toBeVisible();
    await expect(page.getByTestId("manage-mark-rejected")).toBeVisible();
    await expect(page.getByTestId("manage-delete-job")).toBeVisible();

    // Clicking an unwired Manage row surfaces the Snackbar.
    await page.getByTestId("manage-move-saved").click();
    await expect(page.getByText(/status changes are not yet wired up/i)).toBeVisible();

    // Fetch Data button is present because the row has no scraped title yet.
    await expect(page.getByTestId("fetch-data-button")).toBeVisible();

    // Attempts card is in its empty state.
    await expect(page.getByTestId("attempts-empty-state")).toBeVisible();
  });
});
