import { test, expect } from "@playwright/test";

/**
 * Tests the inline FetchProgressPanel on the JobViewPage. Uses page.route() to
 * mock the live-progress endpoint so the scenarios are deterministic and don't
 * depend on a real Browser-Use resolver run.
 */
test.describe("Fetch progress panel", () => {
  test("shows phase chip + step counter while live progress streams", async ({ page }) => {
    // Create a job to land on a stable /jobs/:id route.
    await page.goto("/");
    await page.getByLabel("Job Listing URL").fill("https://example.com/jobs/fetch-progress-positive");
    await page.getByRole("button", { name: "Add Job" }).click();
    await expect(page.getByText("Job saved successfully!")).toBeVisible({ timeout: 5000 });

    const jobUrl = page.url();
    const jobIdMatch = /\/jobs\/(\d+)/.exec(jobUrl);
    expect(jobIdMatch).not.toBeNull();
    if (jobIdMatch === null) throw new Error("unreachable: jobIdMatch checked above");
    const jobId = jobIdMatch[1];

    // Mock the live endpoint to return a live (in-progress) payload while
    // Fetch Data is running. The phase label and step counter come straight
    // from this payload.
    await page.route(`**/api/job-listings/${jobId}/url-resolution/live`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          logId: 100,
          jobListingId: Number(jobId),
          isFinished: false,
          startedAt: "2026-05-22T00:00:00.000Z",
          finishedAt: null,
          steps: [
            {
              stepIndex: 0,
              phase: "brave_search",
              status: "running",
              message: "Querying Brave for application URLs",
              payload: {},
              startedAt: "2026-05-22T00:00:00.000Z",
              endedAt: null,
              durationMs: null,
            },
          ],
          finalOutcome: null,
          finalApplicationUrl: null,
          reason: null,
        }),
      });
    });

    await page.getByRole("button", { name: /Fetch Data/ }).click();

    await expect(page.getByTestId("fetch-progress-panel")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("fetch-progress-phase-chip")).toContainText("Searching the web");
    await expect(page.getByTestId("fetch-progress-step-counter")).toContainText("Step 1 of 1");
    await expect(page.getByTestId("fetch-progress-bar")).toBeVisible();
  });

  test("shows crashed Alert with Retry button when the server reports a terminal crash", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Job Listing URL").fill("https://example.com/jobs/fetch-progress-crashed");
    await page.getByRole("button", { name: "Add Job" }).click();
    await expect(page.getByText("Job saved successfully!")).toBeVisible({ timeout: 5000 });

    const jobUrl = page.url();
    const jobIdMatch = /\/jobs\/(\d+)/.exec(jobUrl);
    expect(jobIdMatch).not.toBeNull();
    if (jobIdMatch === null) throw new Error("unreachable: jobIdMatch checked above");
    const jobId = jobIdMatch[1];

    await page.route(`**/api/job-listings/${jobId}/url-resolution/live`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          logId: 100,
          jobListingId: Number(jobId),
          isFinished: true,
          startedAt: "2026-05-22T00:00:00.000Z",
          finishedAt: "2026-05-22T00:00:05.000Z",
          steps: [],
          finalOutcome: null,
          finalApplicationUrl: null,
          reason: "Container unreachable: docker daemon stopped",
        }),
      });
    });

    await page.getByRole("button", { name: /Fetch Data/ }).click();

    await expect(page.getByTestId("fetch-progress-crashed")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Container unreachable: docker daemon stopped")).toBeVisible();
    await expect(page.getByTestId("fetch-progress-bar")).toHaveCount(0);
    await expect(page.getByTestId("fetch-progress-retry-button")).toBeVisible();
  });
});
