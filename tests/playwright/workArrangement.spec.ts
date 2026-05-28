import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { resolve as resolvePath } from "node:path";

/**
 * End-to-end coverage for the structured `work_arrangement` feature.
 *
 * The feature classifies a job's work arrangement (remote / on_site / hybrid;
 * null = unknown) and renders it as an MUI Chip:
 *   - on the /inbox page, inside each discovery's `.disc-meta` line, and
 *   - on the /jobs page, inside the location cell of each listing row.
 * On import, a DiscoveredJob's `work_arrangement` is promoted onto the created
 * JobListing, so a "Remote" discovery becomes a "Remote" listing.
 *
 * This spec seeds its own gmail_messages + discovered_jobs rows directly via
 * better-sqlite3 (Gmail + Claude are NOT exercised in CI), mirroring the
 * seeding approach used by inboxDiscovery.spec.ts and
 * jobsListCompanyDisplay.spec.ts. Seeding our own deterministic remote
 * discovery keeps the import-carry-over assertion robust against the shared,
 * mutable dev DB. afterAll deletes only the rows this spec created.
 */

/**
 * A seeded discovered_jobs row. Captured at insert time so afterAll can
 * delete only what this spec created.
 */
interface SeededDiscovery {
  id: number;
  title: string;
}

/**
 * Resolves the absolute path to the dev SQLite file from DATABASE_URL.
 *
 * @returns {string} Absolute path to the SQLite file.
 */
function resolveDatabaseFilePath(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("Expected DATABASE_URL to start with file: for the dev SQLite DB");
  }
  const relativeOrAbsolutePath = databaseUrl.slice("file:".length);
  const projectRoot = resolvePath(__dirname, "..", "..");
  return resolvePath(projectRoot, relativeOrAbsolutePath);
}

/**
 * Picks the first existing gmail_connections row so seeded discoveries have a
 * valid FK. The dev DB already has connection id 1 (khasan222@gmail.com); if
 * for some reason none exists, inserts a spec-scoped dummy that afterAll cleans
 * up.
 *
 * @param {Database.Database} db - Open better-sqlite3 handle.
 * @returns {{ id: number; created: boolean }} The connection id + whether the spec must clean it up.
 */
function getOrSeedGmailConnection(db: Database.Database): { id: number; created: boolean } {
  const existing = db
    .prepare("SELECT id FROM gmail_connections ORDER BY created_date ASC LIMIT 1")
    .get() as { id: number } | undefined;
  if (existing !== undefined) {
    return { id: existing.id, created: false };
  }
  const insertStatement = db.prepare(
    `INSERT INTO gmail_connections (google_email, refresh_token, access_token, access_token_expires_at, scopes, created_date, updated_date)
     VALUES (@email, 'fake-rt', 'fake-at', '2099-01-01T00:00:00.000Z', 'scopes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  );
  const result = insertStatement.run({ email: `work-arrangement-spec-${String(Date.now())}@example.com` });
  return { id: Number(result.lastInsertRowid), created: true };
}

/**
 * Inserts a gmail_messages row (the email a discovery is denormalized from).
 * email_received_at is set to "now" so the discovery falls inside the inbox's
 * default 14-day window.
 *
 * @param {Database.Database} db - Open better-sqlite3 handle.
 * @param {object} fields - The owning connection id, a unique message id, and the email subject.
 * @returns {number} The created gmail_messages row id.
 */
function seedGmailMessage(
  db: Database.Database,
  fields: { gmailConnectionId: number; emailMessageId: string; emailSubject: string }
): number {
  const insertStatement = db.prepare(
    `INSERT INTO gmail_messages (
       gmail_connection_id, email_message_id, email_thread_id,
       email_from_name, email_from_address, email_subject, email_snippet,
       email_received_at, email_label_color, scanned_at, created_date, updated_date
     ) VALUES (
       @gmailConnectionId, @emailMessageId, @emailMessageId,
       'LinkedIn Jobs', 'jobs-noreply@linkedin.com', @emailSubject, 'We found jobs you might like',
       @receivedAt, '#4f46e5', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`
  );
  const result = insertStatement.run({
    gmailConnectionId: fields.gmailConnectionId,
    emailMessageId: fields.emailMessageId,
    emailSubject: fields.emailSubject,
    receivedAt: new Date().toISOString(),
  });
  return Number(result.lastInsertRowid);
}

/**
 * Inserts a pending discovered_jobs row with an explicit work_arrangement.
 *
 * @param {Database.Database} db - Open better-sqlite3 handle.
 * @param {object} fields - The owning connection/message ids, display fields, and structured work_arrangement.
 * @returns {SeededDiscovery} The created row's id + title.
 */
function seedDiscoveredJob(
  db: Database.Database,
  fields: {
    gmailConnectionId: number;
    gmailMessageId: number;
    title: string;
    company: string;
    jobUrl: string;
    location: string | null;
    workArrangement: "remote" | "on_site" | "hybrid" | null;
  }
): SeededDiscovery {
  const insertStatement = db.prepare(
    `INSERT INTO discovered_jobs (
       gmail_connection_id, gmail_message_id, title, company, job_url,
       location, salary, description, work_arrangement,
       status, confidence, created_date, updated_date
     ) VALUES (
       @gmailConnectionId, @gmailMessageId, @title, @company, @jobUrl,
       @location, NULL, NULL, @workArrangement,
       'pending', 0.9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`
  );
  const result = insertStatement.run({
    gmailConnectionId: fields.gmailConnectionId,
    gmailMessageId: fields.gmailMessageId,
    title: fields.title,
    company: fields.company,
    jobUrl: fields.jobUrl,
    location: fields.location,
    workArrangement: fields.workArrangement,
  });
  return { id: Number(result.lastInsertRowid), title: fields.title };
}

/**
 * Waits for a discovery row to be visible on /inbox, scoped to `.disc-title`
 * so we don't match the title elsewhere on the page.
 *
 * @param {Page} page - The Playwright page.
 * @param {string} title - The discovery title to wait for.
 */
async function expectDiscoveryVisibleByTitle(page: Page, title: string): Promise<void> {
  await expect(page.locator(".disc-title", { hasText: title })).toBeVisible();
}

test.describe("Work arrangement chip", () => {
  const runId = String(Date.now());

  // Two remote discoveries from one seeded email: one we only view on /inbox,
  // and one we import to verify the chip carries onto the /jobs listing.
  const inboxOnlyTitle = `WorkArrangementSpec Remote Inbox ${runId}`;
  const importTitle = `WorkArrangementSpec Remote Import ${runId}`;

  let db: Database.Database;
  let connection: { id: number; created: boolean };
  let gmailMessageId: number | undefined;
  let inboxOnlyRow: SeededDiscovery | undefined;
  let importRow: SeededDiscovery | undefined;

  test.beforeAll(() => {
    db = new Database(resolveDatabaseFilePath());
    connection = getOrSeedGmailConnection(db);
    gmailMessageId = seedGmailMessage(db, {
      gmailConnectionId: connection.id,
      emailMessageId: `work-arrangement-msg-${runId}`,
      emailSubject: `Work arrangement digest ${runId}`,
    });

    inboxOnlyRow = seedDiscoveredJob(db, {
      gmailConnectionId: connection.id,
      gmailMessageId,
      title: inboxOnlyTitle,
      company: "Vanta",
      jobUrl: `https://example.com/work-arrangement/inbox-${runId}`,
      location: "Remote",
      workArrangement: "remote",
    });
    importRow = seedDiscoveredJob(db, {
      gmailConnectionId: connection.id,
      gmailMessageId,
      title: importTitle,
      company: "Acme Co",
      jobUrl: `https://example.com/work-arrangement/import-${runId}`,
      location: "Remote",
      workArrangement: "remote",
    });
  });

  test.afterAll(() => {
    // Remove any JobListing created by the import test (keyed by the unique
    // imported title), then the seeded discoveries, then the seeded email, then
    // the connection if we created it.
    db.prepare(`DELETE FROM jobs_listing WHERE title = ?`).run(importTitle);
    const discoveryIds = [inboxOnlyRow?.id, importRow?.id].filter(
      (id): id is number => typeof id === "number"
    );
    if (discoveryIds.length > 0) {
      const placeholders = discoveryIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM discovered_jobs WHERE id IN (${placeholders})`).run(...discoveryIds);
    }
    if (typeof gmailMessageId === "number") {
      db.prepare(`DELETE FROM gmail_messages WHERE id = ?`).run(gmailMessageId);
    }
    if (connection.created) {
      db.prepare("DELETE FROM gmail_connections WHERE id = ?").run(connection.id);
    }
    db.close();
  });

  test("renders a 'Remote' MUI Chip on the inbox discovery row", async ({ page }) => {
    await page.goto("/inbox");

    // The seeded remote discovery should be visible.
    await expectDiscoveryVisibleByTitle(page, inboxOnlyTitle);

    // Scope to the seeded row and assert its meta line carries a "Remote" chip
    // (the WorkArrangementChip renders an MUI Chip whose label is "Remote").
    const seededRow = page.locator(".disc-row", {
      has: page.locator(".disc-title", { hasText: inboxOnlyTitle }),
    });
    const remoteChip = seededRow.locator(".disc-meta .MuiChip-root", { hasText: "Remote" });
    await expect(remoteChip).toBeVisible();

    // Sanity: at least one "Remote" chip exists somewhere on the page — robust
    // to the many existing remote discoveries already in the dev DB.
    await expect(page.locator(".MuiChip-root", { hasText: "Remote" }).first()).toBeVisible();
  });

  test("carries the 'Remote' chip onto the imported listing on the jobs page", async ({ page }) => {
    await page.goto("/inbox");
    await expectDiscoveryVisibleByTitle(page, importTitle);

    // The page auto-selects all eligible pending rows on load; clear first so we
    // import ONLY our seeded row (mirrors inboxDiscovery.spec.ts).
    await page.getByRole("button", { name: /^Clear$/i }).click();

    // Select just the import row by its specific checkbox, then import it.
    await page.getByRole("checkbox", { name: `Select ${importTitle}` }).click();
    await page.getByRole("button", { name: /Import 1 job/i }).click();

    // Wait for the success snackbar so the JobListing is persisted before we navigate.
    await expect(page.getByText(/Imported 1 job/i)).toBeVisible();

    // On the jobs page, find the imported listing's row by its title and assert
    // the work-arrangement chip carried over as "Remote".
    await page.goto("/jobs");
    const importedJobRow = page
      .getByRole("row")
      .filter({ has: page.locator(".col-title", { hasText: importTitle }) });
    await expect(importedJobRow).toBeVisible();

    const remoteChip = importedJobRow.locator(".MuiChip-root", { hasText: "Remote" });
    await expect(remoteChip).toBeVisible();
  });
});
