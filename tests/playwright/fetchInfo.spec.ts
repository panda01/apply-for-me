import { test, expect } from "@playwright/test";
import type { JobListingResponse } from "../../client/src/services/jobListingsApi";

/**
 * End-to-end coverage for the "Fetch Info" gating flow.
 *
 * A real POST /api/job-listings/:id/fetch spawns a Docker container + an LLM
 * call to resolve the application form URL, which is slow and unavailable in CI.
 * Every scenario here is therefore made deterministic by intercepting the
 * relevant network calls with page.route(...) — the real backend is never asked
 * to resolve an application_url.
 *
 * Behaviors mirrored (manually verified in the app):
 *   - Jobs list (/jobs): an `init` row WITHOUT an application_url shows a
 *     "Fetch Info" button (data-testid="fetch-info-button-<id>") next to a
 *     DISABLED Apply button (data-testid="apply-button-<id>") wrapped in an MUI
 *     Tooltip whose title is the FETCH_INFO_HINT. An `init` row WITH an
 *     application_url shows a single ENABLED Apply button and no Fetch Info.
 *   - Clicking Fetch Info kicks off a background fetch; the page polls
 *     GET /api/job-listings every 5s while the fetch is in flight, so once a
 *     subsequent poll reports the row now HAS an application_url, the Apply
 *     button becomes enabled and the Fetch Info button disappears.
 *   - Job view (/jobs/:id): the fetch button (data-testid="fetch-data-button")
 *     reads "Fetch Info"; the Apply button (data-testid="apply-button",
 *     "Auto-apply") is disabled with the same hint tooltip when there's no
 *     application_url, and enabled with no Fetch Info button when there is one.
 */

/** Must stay byte-identical to FETCH_INFO_HINT in JobsListPage.tsx / JobViewPage.tsx. */
const FETCH_INFO_HINT = "Fetch the job's info first to find the application form.";

/**
 * Builds a complete, valid {@link JobListingResponse} for mocking. Every field
 * the client's interface declares is populated so the rendered rows/pages don't
 * hit `undefined` access. Override only what a given scenario cares about.
 *
 * @param {Partial<JobListingResponse>} overrides - Field overrides (commonly
 *   `id`, `title`, and `application_url`).
 * @returns {JobListingResponse} A fully-populated job listing object.
 */
function makeJobListing(overrides: Partial<JobListingResponse>): JobListingResponse {
  const base: JobListingResponse = {
    id: 9000,
    title: "Senior Software Engineer",
    url: "https://jobs.example.com/posting/9000",
    application_url: null,
    description: "Build delightful things with a small, focused team.",
    company: "Example Corp",
    location: "Remote",
    work_arrangement: "remote",
    salary: "$180k–$220k",
    status: "init",
    live_url: null,
    post_date: "2026-05-20T00:00:00.000Z",
    created_date: "2026-05-21T00:00:00.000Z",
    resolution_in_progress: false,
    latest_resolution_log_id: null,
  };
  return { ...base, ...overrides };
}

test.describe("Fetch Info gating", () => {
  test("list: gates Apply on application_url and shows Fetch Info only when missing", async ({ page }) => {
    // 9001 has no application_url (must Fetch Info first); 9002 already has one
    // (ready to apply). Both are `init` so they render the action cell variants.
    const jobWithoutUrl = makeJobListing({
      id: 9001,
      title: "FetchInfoSpec Needs Resolve",
      url: "https://jobs.example.com/posting/9001",
      application_url: null,
    });
    const jobWithUrl = makeJobListing({
      id: 9002,
      title: "FetchInfoSpec Ready To Apply",
      url: "https://jobs.example.com/posting/9002",
      application_url: "https://apply.example.com/x",
    });

    await page.route("**/api/job-listings", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([jobWithoutUrl, jobWithUrl]),
      });
    });

    await page.goto("/jobs");

    // Row 9001 (no application_url): Fetch Info present, Apply disabled w/ hint.
    const fetchInfo9001 = page.getByTestId("fetch-info-button-9001");
    const apply9001 = page.getByTestId("apply-button-9001");
    await expect(fetchInfo9001).toBeVisible();
    await expect(apply9001).toBeDisabled();

    // The disabled Apply is wrapped in an MUI Tooltip; hovering its wrapper
    // surfaces the hint text. (The button itself is disabled, so we hover the
    // sibling wrapper span around it.)
    await apply9001.hover({ force: true });
    await expect(page.getByRole("tooltip", { name: FETCH_INFO_HINT })).toBeVisible();

    // Row 9002 (has application_url): single ENABLED Apply, no Fetch Info.
    const apply9002 = page.getByTestId("apply-button-9002");
    await expect(apply9002).toBeEnabled();
    await expect(page.getByTestId("fetch-info-button-9002")).toHaveCount(0);
  });

  test("list: clicking Fetch Info enables Apply after the next poll resolves the url", async ({ page }) => {
    // The list response is read from a mutable closure variable so we can flip
    // the row from "no application_url" to "has application_url" mid-test. The
    // page polls GET /api/job-listings every 5s while a fetch is in flight, so a
    // later poll will pick up the resolved row.
    let listResponse: JobListingResponse[] = [
      makeJobListing({
        id: 9001,
        title: "FetchInfoSpec Transition",
        url: "https://jobs.example.com/posting/9001",
        application_url: null,
      }),
    ];

    await page.route("**/api/job-listings", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(listResponse),
      });
    });

    // POST /api/job-listings/9001/fetch returns 202 with the current (still
    // unresolved) row — mirroring the real endpoint, which returns immediately
    // and resolves the application_url in the background.
    await page.route("**/api/job-listings/9001/fetch", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify(listResponse[0]),
      });
    });

    await page.goto("/jobs");

    const fetchInfo9001 = page.getByTestId("fetch-info-button-9001");
    await expect(fetchInfo9001).toBeVisible();
    await expect(page.getByTestId("apply-button-9001")).toBeDisabled();

    // Flip the mock so the next poll reports the row WITH a resolved
    // application_url. Done before the click so any poll after the click sees it.
    listResponse = [
      makeJobListing({
        id: 9001,
        title: "FetchInfoSpec Transition",
        url: "https://jobs.example.com/posting/9001",
        application_url: "https://apply.example.com/resolved-9001",
      }),
    ];

    await fetchInfo9001.click();

    // Once a poll (every 5s while fetching) returns the resolved row, the action
    // cell swaps to the single enabled Apply button and Fetch Info disappears.
    // Give the 5s poll generous headroom to fire.
    await expect(page.getByTestId("apply-button-9001")).toBeEnabled({ timeout: 10000 });
    await expect(page.getByTestId("fetch-info-button-9001")).toHaveCount(0);
  });

  test("detail: Fetch Info button + disabled Apply when application_url is missing", async ({ page }) => {
    const jobWithoutUrl = makeJobListing({
      id: 9001,
      title: "FetchInfoSpec Detail Needs Resolve",
      url: "https://jobs.example.com/posting/9001",
      application_url: null,
    });

    // GET /api/job-listings/9001 drives the page. Match the id-specific path
    // (and exclude the /fetch, /attempts, etc. sub-routes via the `?` matcher).
    await page.route("**/api/job-listings/9001", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(jobWithoutUrl),
      });
    });

    // The view page also loads its attempts list; mock it as empty so the page
    // renders deterministically without touching the real backend.
    await page.route("**/api/job-listings/9001/attempts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...jobWithoutUrl, attempts: [] }),
      });
    });

    await page.goto("/jobs/9001");

    // Fetch button is present and reads "Fetch Info".
    const fetchDataButton = page.getByTestId("fetch-data-button");
    await expect(fetchDataButton).toBeVisible();
    await expect(fetchDataButton).toHaveText("Fetch Info");

    // Apply ("Auto-apply") is disabled and wrapped in the hint tooltip.
    const applyButton = page.getByTestId("apply-button");
    await expect(applyButton).toBeDisabled();
    await applyButton.hover({ force: true });
    await expect(page.getByRole("tooltip", { name: FETCH_INFO_HINT })).toBeVisible();
  });

  test("detail: enabled Apply + no Fetch Info when application_url is present", async ({ page }) => {
    const jobWithUrl = makeJobListing({
      id: 9001,
      title: "FetchInfoSpec Detail Ready",
      url: "https://jobs.example.com/posting/9001",
      application_url: "https://apply.example.com/resolved-9001",
    });

    await page.route("**/api/job-listings/9001", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(jobWithUrl),
      });
    });

    await page.route("**/api/job-listings/9001/attempts", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...jobWithUrl, attempts: [] }),
      });
    });

    await page.goto("/jobs/9001");

    // With a resolved application_url, Apply ("Auto-apply") is enabled and the
    // Fetch Info button is not rendered.
    const applyButton = page.getByTestId("apply-button");
    await expect(applyButton).toBeEnabled();
    await expect(applyButton).toHaveText("Auto-apply");
    await expect(page.getByTestId("fetch-data-button")).toHaveCount(0);
  });
});
