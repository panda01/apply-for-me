import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { resolve as resolvePath } from "node:path";

/**
 * End-to-end coverage for the /inbox page. Seeds `discovered_jobs` rows
 * directly via better-sqlite3 — Gmail + Claude are NOT exercised in CI.
 * Verifies the page renders, grouping by source email works, and that the
 * Import / Dismiss / Restore flows hit the real server endpoints and
 * persist the right state transitions.
 */

/**
 * One seeded discovered_jobs row. Captured at insert time so afterAll can
 * delete only the rows this spec created.
 */
interface SeededDiscovery {
  id: number;
  title: string;
  company: string;
}

/**
 * Resolves the absolute path to the dev SQLite file from DATABASE_URL.
 * @returns {string} Absolute path to the SQLite file
 */
function resolveDatabaseFilePath(): string {
  const databaseUrl = process.env.DATABASE_URL;
  const isMissingDatabaseUrl = !databaseUrl;
  if (isMissingDatabaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const isFileUrl = databaseUrl.startsWith("file:");
  if (!isFileUrl) {
    throw new Error("Expected DATABASE_URL to start with file:");
  }
  const relativeOrAbsolutePath = databaseUrl.slice("file:".length);
  const projectRoot = resolvePath(__dirname, "..", "..");
  return resolvePath(projectRoot, relativeOrAbsolutePath);
}

/**
 * Inserts a DiscoveredJob row with the given fields. All email metadata
 * fields are required by the schema and seeded to deterministic values
 * derived from the runId so test runs don't collide.
 *
 * @param {Database.Database} db - Open better-sqlite3 handle
 * @param {object} fields - Per-row fields the test cases care about
 * @returns {SeededDiscovery} The created row's id + display fields
 */
function seedDiscoveredJob(
  db: Database.Database,
  fields: {
    gmailConnectionId: number;
    emailMessageId: string;
    emailFromName: string;
    emailFromAddress: string;
    emailSubject: string;
    emailSnippet: string;
    emailReceivedAt: string;
    title: string;
    company: string;
    jobUrl: string;
    status: "pending" | "imported" | "dismissed";
  }
): SeededDiscovery {
  const insertStatement = db.prepare(
    `INSERT INTO discovered_jobs (
       gmail_connection_id, email_message_id, email_thread_id,
       email_from_name, email_from_address, email_subject, email_snippet, email_received_at,
       email_label_color, title, company, job_url, location, salary, description,
       status, confidence, created_date, updated_date
     ) VALUES (
       @gmailConnectionId, @emailMessageId, @emailMessageId,
       @emailFromName, @emailFromAddress, @emailSubject, @emailSnippet, @emailReceivedAt,
       '#4f46e5', @title, @company, @jobUrl, NULL, NULL, NULL,
       @status, 0.9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`
  );
  const result = insertStatement.run(fields);
  return { id: Number(result.lastInsertRowid), title: fields.title, company: fields.company };
}

/**
 * Picks the first existing gmail_connections row so the inbox page's subhead
 * has something to render. If none exists in the dev DB, inserts a dummy row
 * scoped to this spec and returns its id; afterAll cleans up.
 *
 * @param {Database.Database} db - Open better-sqlite3 handle
 * @returns {{ id: number; created: boolean }} The connection id + whether the spec must clean it up
 */
function getOrSeedGmailConnection(db: Database.Database): { id: number; created: boolean } {
  const existing = db.prepare("SELECT id FROM gmail_connections ORDER BY created_date ASC LIMIT 1").get() as { id: number } | undefined;
  if (existing !== undefined) {
    return { id: existing.id, created: false };
  }
  const insertStatement = db.prepare(
    `INSERT INTO gmail_connections (google_email, refresh_token, access_token, access_token_expires_at, scopes, created_date, updated_date)
     VALUES (@email, 'fake-rt', 'fake-at', '2099-01-01T00:00:00.000Z', 'scopes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  );
  const result = insertStatement.run({ email: `inbox-spec-${String(Date.now())}@example.com` });
  return { id: Number(result.lastInsertRowid), created: true };
}

/**
 * Waits for the row whose title text appears in the inbox list. Scoped to
 * the `.disc-title` class so we don't accidentally match the title in the
 * subhead, a snackbar, or anywhere else.
 *
 * @param {Page} page - The Playwright page
 * @param {string} title - Title text to wait for
 */
async function expectDiscoveryVisibleByTitle(page: Page, title: string): Promise<void> {
  await expect(page.locator(".disc-title", { hasText: title })).toBeVisible();
}

test.describe("Inbox discoveries", () => {
  const runId = String(Date.now());

  // Each test seeds with the SAME message id when grouping is being tested
  // (two rows under one email) and a different message id otherwise.
  const emailIdLinkedIn = `msg-linkedin-${runId}`;
  const emailIdIndeed = `msg-indeed-${runId}`;

  const fordTitle = `InboxSpec Software Engineer ${runId}`;
  const acmeTitle = `InboxSpec Senior Designer ${runId}`;
  const widgetsTitle = `InboxSpec Product Manager ${runId}`;

  let db: Database.Database;
  let connection: { id: number; created: boolean };
  let fordRow: SeededDiscovery | undefined;
  let acmeRow: SeededDiscovery | undefined;
  let widgetsRow: SeededDiscovery | undefined;

  test.beforeAll(() => {
    db = new Database(resolveDatabaseFilePath());
    connection = getOrSeedGmailConnection(db);

    // Two discoveries from the same LinkedIn digest email (multi-job grouping)
    fordRow = seedDiscoveredJob(db, {
      gmailConnectionId: connection.id,
      emailMessageId: emailIdLinkedIn,
      emailFromName: "LinkedIn Jobs",
      emailFromAddress: "jobs-noreply@linkedin.com",
      emailSubject: `Daily digest ${runId}`,
      emailSnippet: "We found jobs you might like",
      emailReceivedAt: new Date().toISOString(),
      title: fordTitle,
      company: "Ford Motor Company",
      jobUrl: `https://example.com/ford/${runId}`,
      status: "pending",
    });
    acmeRow = seedDiscoveredJob(db, {
      gmailConnectionId: connection.id,
      emailMessageId: emailIdLinkedIn,
      emailFromName: "LinkedIn Jobs",
      emailFromAddress: "jobs-noreply@linkedin.com",
      emailSubject: `Daily digest ${runId}`,
      emailSnippet: "We found jobs you might like",
      emailReceivedAt: new Date().toISOString(),
      title: acmeTitle,
      company: "Acme Co",
      jobUrl: `https://example.com/acme/${runId}`,
      status: "pending",
    });

    // One discovery from a different Indeed email (separate group)
    widgetsRow = seedDiscoveredJob(db, {
      gmailConnectionId: connection.id,
      emailMessageId: emailIdIndeed,
      emailFromName: "Indeed Alerts",
      emailFromAddress: "noreply@indeed.com",
      emailSubject: `Indeed digest ${runId}`,
      emailSnippet: "New jobs matching your search",
      emailReceivedAt: new Date().toISOString(),
      title: widgetsTitle,
      company: "Widgets Inc",
      jobUrl: `https://example.com/widgets/${runId}`,
      status: "pending",
    });
  });

  test.afterAll(() => {
    const idsToDelete = [fordRow?.id, acmeRow?.id, widgetsRow?.id].filter(
      (id): id is number => typeof id === "number"
    );
    if (idsToDelete.length > 0) {
      const placeholders = idsToDelete.map(() => "?").join(",");
      // Delete any JobListings produced by the Import test BEFORE we delete
      // the discoveries — the FK constraint set imported_job_listing_id
      // SetNull on JobListing delete, so the order doesn't strictly matter,
      // but cleaning JobListings first keeps the dev DB tidy.
      db.prepare(`DELETE FROM jobs_listing WHERE title IN (?, ?, ?)`).run(fordTitle, acmeTitle, widgetsTitle);
      db.prepare(`DELETE FROM discovered_jobs WHERE id IN (${placeholders})`).run(...idsToDelete);
    }
    if (connection.created) {
      db.prepare("DELETE FROM gmail_connections WHERE id = ?").run(connection.id);
    }
    db.close();
  });

  test("renders seeded discoveries grouped by source email", async ({ page }) => {
    await page.goto("/inbox");

    await expectDiscoveryVisibleByTitle(page, fordTitle);
    await expectDiscoveryVisibleByTitle(page, acmeTitle);
    await expectDiscoveryVisibleByTitle(page, widgetsTitle);

    // The two seeded rows from the same email should sit under a single
    // .disc-group. Locate that group via the unique subject (which embeds runId)
    // and assert both row titles are inside it.
    const linkedInGroup = page.locator(".disc-group", {
      has: page.locator(".email-tag-subject", { hasText: `Daily digest ${runId}` }),
    });
    await expect(linkedInGroup).toHaveCount(1);
    await expect(linkedInGroup.locator(".disc-title", { hasText: fordTitle })).toBeVisible();
    await expect(linkedInGroup.locator(".disc-title", { hasText: acmeTitle })).toBeVisible();

    // Widgets row sits under a different group (Indeed)
    const indeedGroup = page.locator(".disc-group", {
      has: page.locator(".email-tag-subject", { hasText: `Indeed digest ${runId}` }),
    });
    await expect(indeedGroup).toHaveCount(1);
    await expect(indeedGroup.locator(".disc-title", { hasText: widgetsTitle })).toBeVisible();
  });

  test("imports a single discovery and creates a JobListing", async ({ page }) => {
    await page.goto("/inbox");
    await expectDiscoveryVisibleByTitle(page, widgetsTitle);

    // Deselect everything first by clicking the "Clear" button (the page
    // auto-selects all eligible rows on load).
    await page.getByRole("button", { name: /^Clear$/i }).click();

    // Select just the Widgets row by clicking its specific checkbox.
    await page.getByRole("checkbox", { name: `Select ${widgetsTitle}` }).click();

    // Click Import 1 job
    await page.getByRole("button", { name: /Import 1 job/i }).click();

    // Wait for the success snackbar
    await expect(page.getByText(/Imported 1 job/i)).toBeVisible();

    // Confirm a JobListing row was created on the server side via the API
    const response = await page.request.get("/api/job-listings");
    const body = await response.json() as { title: string }[];
    const newRow = body.find((row) => row.title === widgetsTitle);
    expect(newRow).toBeDefined();
  });

  test("dismisses a discovery and restores it via the Dismissed filter", async ({ page }) => {
    await page.goto("/inbox");
    await expectDiscoveryVisibleByTitle(page, fordTitle);

    // Click the Dismiss button on the Ford row by its full aria-label.
    await page.getByRole("button", { name: `dismiss ${fordTitle}` }).click();

    // After dismiss, the Ford row's status pill flips to "Dismissed". The
    // "All" filter STILL shows dismissed rows (per InboxPage filter logic) —
    // switch to the "New" tab to confirm the dismissed row is excluded.
    await page.getByRole("button", { name: /^New/i }).click();
    await expect(page.locator(".disc-title", { hasText: fordTitle })).toHaveCount(0, { timeout: 8000 });

    // Switch to the Dismissed tab — Ford should be back
    await page.getByRole("button", { name: /^Dismissed/i }).click();
    await expectDiscoveryVisibleByTitle(page, fordTitle);

    // Restore the Ford row specifically — the Restore button has no aria-label
    // override, so scope by the .disc-row that contains the Ford title.
    const fordRowOnDismissedTab = page.locator(".disc-row", {
      has: page.locator(".disc-title", { hasText: fordTitle }),
    });
    await fordRowOnDismissedTab.getByRole("button", { name: "Restore" }).click();

    // Switch back to All — the Ford row is visible again
    await page.getByRole("button", { name: /^All/i }).click();
    await expectDiscoveryVisibleByTitle(page, fordTitle);
  });
});
