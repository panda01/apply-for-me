import { test, expect } from "@playwright/test";

/**
 * End-to-end tests for the application_profile CRUD flow and the profile
 * picker on the apply dashboard. Mirrors the manual checks used while
 * building the feature:
 *  1. Navigate to /profiles via the nav link.
 *  2. Create a new profile with required + optional fields.
 *  3. See the profile in the list.
 *  4. Edit the profile.
 *  5. Visit /apply, confirm the picker lists the new profile.
 *  6. Delete the profile from /profiles, confirm it disappears.
 *
 * The seed step in server/src/services/applicationProfileSeed.ts will have
 * already inserted a "Default" row on first server boot, so the picker is
 * expected to have at least one option even without us creating one.
 */
test.describe("Application Profiles CRUD", () => {
  test("can create, edit, and delete a profile, and pick it on the apply dashboard", async ({ page }) => {
    const profileName = `Test Profile ${String(Date.now())}`;
    const updatedProfileName = `${profileName} (edited)`;

    await page.goto("/profiles");
    await expect(page.getByRole("heading", { name: "Application Profiles" })).toBeVisible();

    // Open the create dialog and fill out the form. Queries are scoped to the
    // dialog so the table behind it (which also has a "Name" header) doesn't
    // produce strict-mode collisions.
    await page.getByRole("button", { name: /New Profile/ }).click();
    const dialog = page.getByRole("dialog", { name: /New application profile/ });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(profileName);
    await dialog.getByRole("textbox", { name: "First name" }).fill("Test");
    await dialog.getByRole("textbox", { name: "Last name" }).fill("User");
    await dialog.getByRole("textbox", { name: "Email" }).fill("test@example.com");
    await dialog.getByRole("textbox", { name: "Phone" }).fill("5551234567");
    await dialog.getByRole("textbox", { name: "LinkedIn" }).fill("https://www.linkedin.com/in/test/");
    await dialog.getByRole("spinbutton", { name: "Minimum desired salary" }).fill("120000");

    await dialog.getByRole("button", { name: "Create profile" }).click();

    // Dialog closes and the new row appears in the table. exact:true so the
    // adjacent actions cell (which also embeds the profile name) doesn't
    // trigger Playwright's strict-mode collision check.
    await expect(page.getByText("New application profile")).toBeHidden();
    await expect(page.getByRole("cell", { name: profileName, exact: true })).toBeVisible();

    // Edit the profile (rename it). Scope queries to the edit dialog so the
    // table's "Name" header doesn't collide with the form field's label.
    await page.getByRole("button", { name: `edit ${profileName}` }).click();
    const editDialog = page.getByRole("dialog", { name: new RegExp(`Edit profile: ${profileName}`) });
    await expect(editDialog).toBeVisible();
    await editDialog.getByRole("textbox", { name: "Name", exact: true }).fill(updatedProfileName);
    await editDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("cell", { name: updatedProfileName, exact: true })).toBeVisible();

    // Confirm the apply dashboard sees the renamed profile in its picker.
    await page.goto("/apply");
    const profilePicker = page.getByRole("combobox", { name: /Application profile/ });
    await expect(profilePicker).toBeVisible();
    await profilePicker.click();
    // Use a plain string match instead of `new RegExp(name)` so the literal
    // parens in updatedProfileName (e.g. "Test Profile 123 (edited)") aren't
    // interpreted as regex groups and inadvertently match the empty string.
    await expect(page.getByRole("option").filter({ hasText: updatedProfileName })).toBeVisible();
    // Close the dropdown without changing the selection.
    await page.keyboard.press("Escape");

    // Delete the profile (handle the confirm() prompt that the page raises).
    await page.goto("/profiles");
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole("button", { name: `delete ${updatedProfileName}` }).click();

    // Row disappears after delete.
    await expect(page.getByRole("cell", { name: updatedProfileName, exact: true })).toBeHidden();
  });

  test("the apply dashboard always renders either the picker or the empty-state CTA", async ({ page }) => {
    // Depending on the dev DB state the table may start with the seeded
    // "Default" row (picker shows) or be empty (empty-state CTA shows).
    // Either way the dashboard must render one of those two affordances.
    await page.goto("/apply");
    const pickerOrCta = page
      .getByRole("combobox", { name: /Application profile/ })
      .or(page.getByRole("link", { name: /Create application profile/ }));
    await expect(pickerOrCta).toBeVisible();
  });
});
