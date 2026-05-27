import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { resolve as resolvePath } from "node:path";

/**
 * End-to-end coverage for the Jobs list search/filter feature.
 *
 * The search input lives in the page-head toolbar. Typing into it debounces
 * for 300ms, then fires `GET /api/job-listings?q=<value>` and syncs the
 * value to the URL as `?q=<value>`. The server matches the query
 * (case-insensitive via SQLite LIKE) against title, description, url, OR
 * application_url.
 *
 * The only public way to set a row's title/description/application_url
 * server-side is to run the real scraper, which we can't do here. Instead
 * the suite opens a direct better-sqlite3 connection to the dev SQLite
 * file and seeds three deterministic rows. Each row's URL embeds a per-run
 * id so repeated runs against the same dev DB never collide on the URL
 * unique constraint.
 */

/**
 * One seeded job row. The fields we care about for filter coverage are the
 * four searchable columns plus the id (used for cleanup in afterAll).
 */
interface SeededRow {
  id: number;
  title: string;
  description: string;
  url: string;
  applicationUrl: string | null;
}

/**
 * Resolves the absolute path to the dev SQLite file from DATABASE_URL.
 * DATABASE_URL is of the form `file:./server/prisma/dev.db` — the prefix
 * gets stripped and the remaining path is resolved against the project root.
 *
 * @returns {string} The absolute path to the SQLite file.
 */
function resolveDatabaseFilePath(): string {
  const databaseUrl = process.env.DATABASE_URL;
  const isMissingDatabaseUrl = !databaseUrl;
  if (isMissingDatabaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const isFileUrl = databaseUrl.startsWith("file:");
  if (!isFileUrl) {
    throw new Error("Expected DATABASE_URL to start with file: for the dev SQLite DB");
  }
  const relativeOrAbsolutePath = databaseUrl.slice("file:".length);
  const projectRoot = resolvePath(__dirname, "..", "..");
  return resolvePath(projectRoot, relativeOrAbsolutePath);
}

/**
 * Inserts a fully-formed jobs_listing row directly via better-sqlite3 so
 * the searchable fields can be set without going through the scraper.
 *
 * @param {Database.Database} db - The open better-sqlite3 database.
 * @param {object} fields - All searchable fields for the row.
 * @returns {SeededRow} The created row with its assigned id.
 */
function seedJobRow(
  db: Database.Database,
  fields: { url: string; title: string; description: string; applicationUrl: string | null }
): SeededRow {
  const insertStatement = db.prepare(
    `INSERT INTO jobs_listing (title, url, description, status, post_date, application_url)
     VALUES (@title, @url, @description, 'init', CURRENT_TIMESTAMP, @applicationUrl)`
  );
  const result = insertStatement.run({
    title: fields.title,
    url: fields.url,
    description: fields.description,
    applicationUrl: fields.applicationUrl,
  });
  return {
    id: Number(result.lastInsertRowid),
    title: fields.title,
    description: fields.description,
    url: fields.url,
    applicationUrl: fields.applicationUrl,
  };
}

/**
 * Waits for the row whose title cell contains `title` to appear in the
 * jobs table. Uses `.col-title` (the JobsListPage's title-cell class) so
 * we don't accidentally match the same string in a tab badge or empty state.
 *
 * @param {Page} page - The Playwright page.
 * @param {string} title - The exact title text to wait for.
 */
async function expectRowVisibleByTitle(page: Page, title: string): Promise<void> {
  await expect(page.locator(".col-title", { hasText: title })).toBeVisible();
}

/**
 * Asserts that no row with the given title is present in the table.
 *
 * @param {Page} page - The Playwright page.
 * @param {string} title - The exact title text that must not be visible.
 */
async function expectRowNotVisibleByTitle(page: Page, title: string): Promise<void> {
  await expect(page.locator(".col-title", { hasText: title })).toHaveCount(0);
}

test.describe("Jobs list search filter", () => {
  const runId = String(Date.now());
  const engineerUrl = `https://linkedin.com/jobs/search-engineer-${runId}`;
  const designerUrl = `https://greenhouse.io/jobs/search-designer-${runId}`;
  const managerUrl = `https://example.com/jobs/search-manager-${runId}`;
  const managerApplicationUrl = `https://lever.co/apply/search-manager-${runId}`;

  const engineerTitle = `SearchSpec Senior Engineer ${runId}`;
  const designerTitle = `SearchSpec UX Designer ${runId}`;
  const managerTitle = `SearchSpec Product Manager ${runId}`;

  const engineerDescription = "We build with react and typescript on the frontend";
  const designerDescription = "Figma proficiency and design-system experience";
  const managerDescription = "Own the roadmap and partner with engineering";

  let db: Database.Database;
  // Declared as possibly-undefined so afterAll's cleanup stays safe even if
  // beforeAll throws partway and not every row gets seeded.
  let engineerRow: SeededRow | undefined;
  let designerRow: SeededRow | undefined;
  let managerRow: SeededRow | undefined;

  test.beforeAll(() => {
    db = new Database(resolveDatabaseFilePath());
    engineerRow = seedJobRow(db, {
      url: engineerUrl,
      title: engineerTitle,
      description: engineerDescription,
      applicationUrl: null,
    });
    designerRow = seedJobRow(db, {
      url: designerUrl,
      title: designerTitle,
      description: designerDescription,
      applicationUrl: null,
    });
    managerRow = seedJobRow(db, {
      url: managerUrl,
      title: managerTitle,
      description: managerDescription,
      applicationUrl: managerApplicationUrl,
    });
  });

  test.afterAll(() => {
    const idsToDelete = [engineerRow?.id, designerRow?.id, managerRow?.id].filter(
      (id): id is number => typeof id === "number"
    );
    if (idsToDelete.length > 0) {
      const placeholders = idsToDelete.map(() => "?").join(",");
      db.prepare(`DELETE FROM jobs_listing WHERE id IN (${placeholders})`).run(...idsToDelete);
    }
    db.close();
  });

  test("filters by a substring of the title", async ({ page }) => {
    await page.goto("/jobs");
    await expectRowVisibleByTitle(page, engineerTitle);

    const searchInput = page.getByRole("textbox", { name: "Search jobs", exact: true });
    await searchInput.fill(`Senior Engineer ${runId}`);

    await expectRowVisibleByTitle(page, engineerTitle);
    await expectRowNotVisibleByTitle(page, designerTitle);
    await expectRowNotVisibleByTitle(page, managerTitle);
  });

  test("filters by a substring of the description", async ({ page }) => {
    await page.goto("/jobs");

    const searchInput = page.getByRole("textbox", { name: "Search jobs", exact: true });
    // "Figma proficiency" appears only in the Designer row's description —
    // not in any title or URL — so this exercises the description branch.
    await searchInput.fill("Figma proficiency");

    await expectRowVisibleByTitle(page, designerTitle);
    await expectRowNotVisibleByTitle(page, engineerTitle);
    await expectRowNotVisibleByTitle(page, managerTitle);
  });

  test("filters by a substring of the url", async ({ page }) => {
    await page.goto("/jobs");

    const searchInput = page.getByRole("textbox", { name: "Search jobs", exact: true });
    // The unique runId in the URL guarantees only the Designer row matches.
    await searchInput.fill(`search-designer-${runId}`);

    await expectRowVisibleByTitle(page, designerTitle);
    await expectRowNotVisibleByTitle(page, engineerTitle);
    await expectRowNotVisibleByTitle(page, managerTitle);
  });

  test("filters by a substring of the application_url", async ({ page }) => {
    await page.goto("/jobs");

    const searchInput = page.getByRole("textbox", { name: "Search jobs", exact: true });
    // Only the Manager row has this in its application_url, NOT its url.
    await searchInput.fill(`apply/search-manager-${runId}`);

    await expectRowVisibleByTitle(page, managerTitle);
    await expectRowNotVisibleByTitle(page, engineerTitle);
    await expectRowNotVisibleByTitle(page, designerTitle);
  });

  test("matches are case-insensitive", async ({ page }) => {
    await page.goto("/jobs");

    const searchInput = page.getByRole("textbox", { name: "Search jobs", exact: true });
    await searchInput.fill(`SEARCHSPEC SENIOR ENGINEER ${runId}`);

    await expectRowVisibleByTitle(page, engineerTitle);
    await expectRowNotVisibleByTitle(page, designerTitle);
  });

  test("shows the empty-state message and Clear search button when nothing matches", async ({ page }) => {
    await page.goto("/jobs");

    const searchInput = page.getByRole("textbox", { name: "Search jobs", exact: true });
    await searchInput.fill("zzznomatchzzz");

    await expect(page.getByText('No jobs match "zzznomatchzzz" in this tab.')).toBeVisible();

    const clearButton = page.getByRole("button", { name: "Clear search" });
    await expect(clearButton).toBeVisible();
    await clearButton.click();

    await expect(searchInput).toHaveValue("");
    await expectRowVisibleByTitle(page, engineerTitle);
  });

  test("syncs the query to the URL and re-applies it on direct navigation", async ({ page }) => {
    const directUrl = `/jobs?q=${encodeURIComponent(`Senior Engineer ${runId}`)}`;
    await page.goto(directUrl);

    const searchInput = page.getByRole("textbox", { name: "Search jobs", exact: true });
    await expect(searchInput).toHaveValue(`Senior Engineer ${runId}`);

    await expectRowVisibleByTitle(page, engineerTitle);
    await expectRowNotVisibleByTitle(page, designerTitle);
  });
});
