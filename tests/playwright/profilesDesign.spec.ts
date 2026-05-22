import { test, expect } from "@playwright/test";

/**
 * Smoke test for the redesigned Application Profiles surface (Phase 1.5
 * UI rewrite). Verifies:
 *   - The list page renders the new `.profile-row` cards under the
 *     "Application profiles" heading.
 *   - "New profile" navigates to the standalone `/profiles/new` page
 *     (no more inline Dialog).
 *   - The new page renders the create-mode heading and the reusable
 *     <ApplicationProfileForm /> fields.
 *   - Creating a profile lands back on `/profiles` with the new row
 *     visible.
 *   - Clicking Edit on a row navigates to `/profiles/:id/edit` and the
 *     fields are hydrated with the saved values.
 *
 * Auto-clean teardown deletes the test profile so repeated runs stay
 * idempotent.
 */
test.describe("Application profiles (design refresh)", () => {
  test("list page renders heading, sub-line, and primary action", async ({ page }) => {
    await page.goto("/profiles");

    await expect(page.getByRole("heading", { name: "Application profiles" })).toBeVisible();
    await expect(page.locator(".page-sub", { hasText: "profile" })).toBeVisible();

    const newProfileButton = page.getByRole("button", { name: "New profile" });
    await expect(newProfileButton).toBeVisible();

    await newProfileButton.click();
    await expect(page).toHaveURL(/\/profiles\/new$/);
    await expect(page.getByRole("heading", { name: "New application profile" })).toBeVisible();
  });

  test("create flow: navigates to /profiles/new, saves, returns to list", async ({ page }) => {
    const profileName = `Design Test ${String(Date.now())}`;

    await page.goto("/profiles/new");
    await expect(page.getByRole("heading", { name: "New application profile" })).toBeVisible();

    await page.getByRole("textbox", { name: "Name", exact: true }).fill(profileName);
    await page.getByRole("textbox", { name: "First name" }).fill("Design");
    await page.getByRole("textbox", { name: "Last name" }).fill("Tester");
    await page.getByRole("textbox", { name: "Email" }).fill("design@example.com");
    await page.getByRole("textbox", { name: "Phone" }).fill("5550000000");

    await page.getByRole("button", { name: "Create profile" }).click();

    await expect(page).toHaveURL(/\/profiles$/);
    await expect(page.locator(".profile-row-label", { hasText: profileName })).toBeVisible();

    // Cleanup: delete via the row's delete button.
    page.once("dialog", (dialog) => dialog.accept());
    const row = page.locator(".profile-row", { hasText: profileName });
    await row.getByRole("button", { name: `delete ${profileName}` }).click();
    await expect(page.locator(".profile-row-label", { hasText: profileName })).toHaveCount(0);
  });

  test("edit flow: clicking Edit navigates to /profiles/:id/edit with hydrated fields", async ({ page }) => {
    const profileName = `Edit Test ${String(Date.now())}`;

    // Create a profile first so we have something to edit.
    await page.goto("/profiles/new");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(profileName);
    await page.getByRole("textbox", { name: "First name" }).fill("Edit");
    await page.getByRole("textbox", { name: "Last name" }).fill("Tester");
    await page.getByRole("textbox", { name: "Email" }).fill("edit@example.com");
    await page.getByRole("textbox", { name: "Phone" }).fill("5551111111");
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page).toHaveURL(/\/profiles$/);

    const row = page.locator(".profile-row", { hasText: profileName });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: `edit ${profileName}` }).click();

    await expect(page).toHaveURL(/\/profiles\/\d+\/edit$/);
    await expect(page.getByRole("heading", { name: new RegExp(`Edit · ${profileName}`) })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(profileName);
    await expect(page.getByRole("textbox", { name: "First name" })).toHaveValue("Edit");

    // Danger-zone visible in edit mode.
    await expect(page.getByRole("button", { name: "Delete profile" })).toBeVisible();

    // Cleanup.
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete profile" }).click();
    await expect(page).toHaveURL(/\/profiles$/);
    await expect(page.locator(".profile-row-label", { hasText: profileName })).toHaveCount(0);
  });
});
