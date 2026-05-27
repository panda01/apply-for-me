import { test, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { resolve as resolvePath } from "node:path";

/**
 * End-to-end coverage for the Jobs list page's company-name rendering.
 *
 * Bug being guarded against: the sub-line under each job title used to show
 * the URL hostname unconditionally, so every imported LinkedIn job alert
 * looked like its company was "linkedin.com". The fix renders `listing.company`
 * in the sub-line when it is set, falling back to the URL hostname only when
 * `company` is null/empty. This spec seeds two rows — one with `company` set
 * and one with `company` null — and asserts both branches render the right
 * text.
 *
 * Like jobsListSearch.spec.ts this seeds rows directly via better-sqlite3
 * because the public POST /api/job-listings endpoint only accepts a URL.
 */

interface SeededRow {
  id: number;
  title: string;
  url: string;
  company: string | null;
}

/**
 * Resolves the absolute path to the dev SQLite file from DATABASE_URL.
 *
 * @returns {string} The absolute path to the SQLite file.
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
 * Inserts a jobs_listing row directly so we can pin the `company` column to
 * an exact value (with-company case) or NULL (without-company case).
 *
 * @param {Database.Database} db - The open better-sqlite3 database.
 * @param {object} fields - Row fields. `company` is nullable on purpose.
 * @returns {SeededRow} The created row with its assigned id.
 */
function seedJobRow(
  db: Database.Database,
  fields: { url: string; title: string; company: string | null }
): SeededRow {
  const insertStatement = db.prepare(
    `INSERT INTO jobs_listing (title, url, description, status, post_date, company)
     VALUES (@title, @url, '', 'init', CURRENT_TIMESTAMP, @company)`
  );
  const result = insertStatement.run({
    title: fields.title,
    url: fields.url,
    company: fields.company,
  });
  return {
    id: Number(result.lastInsertRowid),
    title: fields.title,
    url: fields.url,
    company: fields.company,
  };
}

test.describe("Jobs list company-name rendering", () => {
  const runId = String(Date.now());

  const withCompanyTitle = `CompanyDisplaySpec With-Company ${runId}`;
  const withCompanyName = `Acme Corp ${runId}`;
  const withCompanyUrl = `https://www.linkedin.com/jobs/view/with-company-${runId}`;

  const withoutCompanyTitle = `CompanyDisplaySpec No-Company ${runId}`;
  const withoutCompanyUrl = `https://greenhouse.io/jobs/no-company-${runId}`;
  const expectedHostnameFallback = "greenhouse.io";

  let db: Database.Database;
  let withCompanyRow: SeededRow | undefined;
  let withoutCompanyRow: SeededRow | undefined;

  test.beforeAll(() => {
    db = new Database(resolveDatabaseFilePath());
    withCompanyRow = seedJobRow(db, {
      url: withCompanyUrl,
      title: withCompanyTitle,
      company: withCompanyName,
    });
    withoutCompanyRow = seedJobRow(db, {
      url: withoutCompanyUrl,
      title: withoutCompanyTitle,
      company: null,
    });
  });

  test.afterAll(() => {
    const idsToDelete = [withCompanyRow?.id, withoutCompanyRow?.id].filter(
      (id): id is number => typeof id === "number"
    );
    if (idsToDelete.length > 0) {
      const placeholders = idsToDelete.map(() => "?").join(",");
      db.prepare(`DELETE FROM jobs_listing WHERE id IN (${placeholders})`).run(...idsToDelete);
    }
    db.close();
  });

  test("shows the company name under the title when company is set", async ({ page }) => {
    await page.goto("/jobs");

    // Scope to the seeded row's table row so we don't pick up the same string
    // elsewhere on the page (sidebar, search box, etc).
    const seededRow = page
      .getByRole("row")
      .filter({ has: page.locator(".col-title", { hasText: withCompanyTitle }) });
    await expect(seededRow).toBeVisible();

    // The company name renders in the .col-co sub-line under the title — NOT
    // the URL hostname (which would have been "www.linkedin.com" before the fix).
    const subLine = seededRow.locator(".col-co").first();
    await expect(subLine).toHaveText(withCompanyName);
    await expect(subLine).not.toHaveText("www.linkedin.com");
    await expect(subLine).not.toHaveText("linkedin.com");
  });

  test("falls back to the URL hostname when company is null", async ({ page }) => {
    await page.goto("/jobs");

    const seededRow = page
      .getByRole("row")
      .filter({ has: page.locator(".col-title", { hasText: withoutCompanyTitle }) });
    await expect(seededRow).toBeVisible();

    // No company on this row, so the sub-line falls back to the URL hostname.
    const subLine = seededRow.locator(".col-co").first();
    await expect(subLine).toHaveText(expectedHostnameFallback);
  });
});
