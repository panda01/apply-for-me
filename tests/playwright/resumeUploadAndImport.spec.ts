import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

/**
 * End-to-end coverage for the resume / cover-letter upload + "Import from
 * resume" feature on the create-profile page (/profiles/new).
 *
 * IMPORTANT — this spec hits the REAL backend (it does NOT mock the network):
 *   - The dev servers must be running (`npm run dev`) so both the Vite client
 *     and the Express server are reachable.
 *   - The server's `.env` must contain a valid CLAUDE_API_KEY and Google Cloud
 *     Storage credentials, because "Import from resume" sends the PDF to Claude
 *     for field extraction, and saving the profile uploads the staged files to
 *     GCS. Without these the Import / Save steps will fail.
 *
 * The Claude extraction round-trip can take ~10s, so the Import assertions use
 * an extended visibility timeout and the whole test bumps its own timeout.
 *
 * Fixture: fixtures/test_resume.pdf is a known resume whose contents resolve
 * to the IMPORTED_* values below. It is referenced by an absolute path built
 * from this spec's location so the test is CWD-independent.
 */

/** Absolute path to the known test resume PDF fixture. */
const RESUME_PDF_PATH = resolve(__dirname, "fixtures/test_resume.pdf");

/** Expected field values extracted from fixtures/test_resume.pdf. */
const IMPORTED = {
  firstName: "Jordan",
  middleName: "Alex",
  lastName: "Carter",
  email: "jordan.carter@example.com",
  phoneFragment: "555-0198",
  linkedin: "https://www.linkedin.com/in/jordancarter",
  github: "https://github.com/jordancarter",
  website: "https://jordancarter.dev",
} as const;

test.describe("Create profile: resume upload + Import from resume", () => {
  test("imports empty fields from a staged resume PDF without overwriting typed values, then saves", async ({ page }) => {
    // Generous budget: the Import step calls Claude (~10s) and saving uploads
    // the staged files to Google Cloud Storage.
    test.setTimeout(90000);

    await page.goto("/profiles/new");

    // 1. The Resume section is visible and Import is disabled with nothing staged.
    await expect(page.getByText("Resume", { exact: true })).toBeVisible();
    const importButton = page.getByRole("button", { name: "Import from resume" });
    await expect(importButton).toBeVisible();
    await expect(importButton).toBeDisabled();

    // 2. Stage the resume by setting the hidden PDF file input directly. The
    // resume input is the first file input on the page (cover letter is second).
    await page.locator('input[type="file"]').first().setInputFiles(RESUME_PDF_PATH);

    // Staged filename appears and Import becomes enabled.
    await expect(page.getByText("test_resume.pdf")).toBeVisible();
    await expect(importButton).toBeEnabled();

    // 3. Pre-fill First name with a sentinel so we can prove import does NOT
    // overwrite a field the user has already typed into.
    const firstNameField = page.getByLabel("First name", { exact: true });
    await firstNameField.fill("KeepMe");

    // 4. Run the import and wait for the success notice (Claude call is slow).
    await importButton.click();
    await expect(page.getByText(/Imported from resume/i)).toBeVisible({ timeout: 45000 });

    // 5a. First name is preserved (not overwritten by the imported "Jordan").
    await expect(firstNameField).toHaveValue("KeepMe");

    // 5b. Previously-empty fields are filled from the resume.
    await expect(page.getByLabel("Middle name", { exact: true })).toHaveValue(IMPORTED.middleName);
    await expect(page.getByLabel("Last name", { exact: true })).toHaveValue(IMPORTED.lastName);
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(IMPORTED.email);
    await expect(page.getByLabel("Phone", { exact: true })).toHaveValue(new RegExp(IMPORTED.phoneFragment));
    await expect(page.getByLabel("LinkedIn", { exact: true })).toHaveValue(new RegExp("linkedin\\.com/in/jordancarter"));
    await expect(page.getByLabel("GitHub", { exact: true })).toHaveValue(new RegExp("github\\.com/jordancarter"));
    await expect(page.getByLabel("Website / Portfolio", { exact: true })).toHaveValue(new RegExp("jordancarter\\.dev"));

    // 6. Fill the required profile label "Name" and create the profile. The
    // staged resume is uploaded to GCS as part of the save.
    await page.getByLabel("Name", { exact: true }).fill(`Resume Import Spec ${String(Date.now())}`);
    await page.getByRole("button", { name: "Create profile" }).click();

    // Tolerant success assertion: the page shows a "Saved" indicator and no
    // error Alert surfaces. Save + upload can take a few seconds.
    await expect(page.getByText(/Saved/i)).toBeVisible({ timeout: 45000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
