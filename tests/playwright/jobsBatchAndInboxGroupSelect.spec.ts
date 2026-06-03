import { test, expect } from "@playwright/test";
import type { JobListingResponse } from "../../client/src/services/jobListingsApi";
import type { DiscoveredJobResponse } from "../../client/src/services/inboxApi";

/**
 * End-to-end coverage for three changes, all made deterministic with
 * page.route(...) interception so the real backend / Gmail / containers are
 * never exercised:
 *
 *   1. Jobs list (/jobs): a row WITHOUT an application_url shows a "Fetch Info"
 *      button regardless of status — including non-init `missing_form_url`
 *      rows, which previously only offered a "View" button.
 *   2. Jobs list (/jobs): the bulk-bar "Delete" button opens a confirmation
 *      dialog and deletes every selected row.
 *   3. Inbox (/inbox): each email group has a header checkbox that selects /
 *      deselects only that group's eligible (pending, non-duplicate) jobs.
 */

/**
 * Builds a complete, valid {@link JobListingResponse} for mocking. Override
 * only what a given scenario cares about.
 *
 * @param {Partial<JobListingResponse>} overrides - Field overrides
 * @returns {JobListingResponse} A fully-populated job listing object
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

/**
 * Builds a complete {@link DiscoveredJobResponse} for mocking the inbox.
 * `emailMessageId` / `fromName` control which email group the row lands in.
 *
 * @param {Partial<DiscoveredJobResponse> & { emailMessageId?: string; fromName?: string }} overrides - Field overrides
 * @returns {DiscoveredJobResponse} A fully-populated discovery row
 */
function makeDiscovery(
  overrides: Partial<DiscoveredJobResponse> & { emailMessageId?: string; fromName?: string } = {}
): DiscoveredJobResponse {
  const { emailMessageId = "msg-1", fromName = "GroupA Sender", email, ...rest } = overrides;
  return {
    id: 1,
    status: "pending",
    title: "Senior Software Engineer",
    company: "Acme Co",
    jobUrl: "https://example.com/jobs/1",
    location: "Remote",
    workArrangement: "remote",
    salary: "$160k–$200k",
    description: null,
    confidence: 0.92,
    email: email ?? {
      messageId: emailMessageId,
      threadId: `thr-${emailMessageId}`,
      fromName,
      fromAddress: "jobs-noreply@example.com",
      subject: "New jobs that match your search",
      snippet: "We found a few jobs you might like",
      receivedAt: "2026-05-22T12:00:00.000Z",
      labelColor: "#4f46e5",
      gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${emailMessageId}`,
    },
    duplicateOf: null,
    importedAs: null,
    createdDate: "2026-05-22T12:05:00.000Z",
    ...rest,
  };
}

test.describe("Jobs list: Fetch Info on rows without an application_url", () => {
  test("shows Fetch Info on a missing_form_url row that lacks an application_url", async ({ page }) => {
    const missingFormRow = makeJobListing({
      id: 9101,
      title: "BatchSpec No Form Found",
      status: "missing_form_url",
      application_url: null,
    });

    await page.route("**/api/job-listings", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([missingFormRow]),
      });
    });

    await page.goto("/jobs");

    // The non-init row offers BOTH a Fetch Info retry and the usual View button.
    await expect(page.getByTestId("fetch-info-button-9101")).toBeVisible();
    await expect(page.getByRole("button", { name: "View" })).toBeVisible();
    // No Apply affordance on a non-init row.
    await expect(page.getByTestId("apply-button-9101")).toHaveCount(0);
  });
});

test.describe("Jobs list: bulk delete", () => {
  test("opens a confirmation dialog and deletes every selected row", async ({ page }) => {
    const allRows = [
      makeJobListing({ id: 9201, title: "BatchSpec Delete A", status: "init" }),
      makeJobListing({ id: 9202, title: "BatchSpec Delete B", status: "init" }),
      makeJobListing({ id: 9203, title: "BatchSpec Keep C", status: "init" }),
    ];
    const deletedIds = new Set<number>();

    await page.route("**/api/job-listings", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const rows = allRows.filter((row) => !deletedIds.has(row.id));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows),
      });
    });

    // DELETE /api/job-listings/:id — record the id so the next list poll omits it.
    await page.route(/\/api\/job-listings\/\d+$/, async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.fallback();
        return;
      }
      const matchedId = Number(/(\d+)$/.exec(route.request().url())?.[1]);
      deletedIds.add(matchedId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: matchedId }),
      });
    });

    await page.goto("/jobs");
    await expect(page.getByText("BatchSpec Delete A")).toBeVisible();

    // Select the two "Delete" rows (leave "Keep C" untouched).
    await page.getByRole("checkbox", { name: "Select BatchSpec Delete A" }).check();
    await page.getByRole("checkbox", { name: "Select BatchSpec Delete B" }).check();
    await expect(page.getByText(/2 selected/)).toBeVisible();

    // Delete opens a confirm dialog rather than deleting immediately.
    await page.getByTestId("bulk-delete-button").click();
    await expect(page.getByText("Delete selected jobs?")).toBeVisible();
    await page.getByTestId("confirm-bulk-delete-button").click();

    // Both selected rows disappear; the untouched row remains.
    await expect(page.getByText("BatchSpec Delete A")).toHaveCount(0);
    await expect(page.getByText("BatchSpec Delete B")).toHaveCount(0);
    await expect(page.getByText("BatchSpec Keep C")).toBeVisible();
  });
});

test.describe("Inbox: per-email group selection", () => {
  test("group header checkbox selects only that email's jobs", async ({ page }) => {
    const groupARowOne = makeDiscovery({ id: 1, title: "GroupSpec A1", emailMessageId: "msg-A", fromName: "GroupA Sender" });
    const groupARowTwo = makeDiscovery({ id: 2, title: "GroupSpec A2", emailMessageId: "msg-A", fromName: "GroupA Sender" });
    const groupBRow = makeDiscovery({ id: 3, title: "GroupSpec B1", emailMessageId: "msg-B", fromName: "GroupB Sender" });

    await page.route("**/api/gmail/connections", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            google_email: "user@example.com",
            scopes: "https://www.googleapis.com/auth/gmail.readonly",
            access_token_expires_at: "2099-01-01T00:00:00.000Z",
            created_date: "2026-05-23T17:00:00.000Z",
            updated_date: "2026-05-23T17:00:00.000Z",
          },
        ]),
      });
    });
    await page.route("**/api/inbox/scan/active", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: null }) });
    });
    await page.route("**/api/inbox/discoveries*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([groupARowOne, groupARowTwo, groupBRow]),
      });
    });

    await page.goto("/inbox");
    await expect(page.getByText("GroupSpec A1")).toBeVisible();

    // All rows auto-select on load — clear to a known-empty baseline.
    await page.getByRole("button", { name: "Clear" }).click();

    const groupAHeader = page.getByRole("checkbox", { name: "Select all jobs from GroupA Sender" });
    await groupAHeader.check();

    // Group A's rows become selected; Group B's row stays unselected.
    await expect(page.getByRole("checkbox", { name: "Select GroupSpec A1" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select GroupSpec A2" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select GroupSpec B1" })).not.toBeChecked();

    // Toggling the same header off deselects only that group's rows.
    await groupAHeader.uncheck();
    await expect(page.getByRole("checkbox", { name: "Select GroupSpec A1" })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Select GroupSpec A2" })).not.toBeChecked();
  });
});
