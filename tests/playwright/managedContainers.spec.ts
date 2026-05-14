import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * End-to-end tests for the managed Docker containers feature:
 *  - Navigate to the containers page
 *  - Create a new Docker container
 *  - Ping the container's health endpoint via the UI
 *  - Verify via the docker CLI that the container exists and the name matches what the UI shows
 *  - Delete the container and verify it is gone
 *
 * These tests require Docker to be installed and running locally.
 */

/**
 * Lists all docker containers (running + stopped) whose names match the given filter.
 * @param {string} nameFilter - Substring to filter docker container names by
 * @returns {Promise<string[]>} Array of matching container names
 */
async function listDockerContainers(nameFilter: string): Promise<string[]> {
  const { stdout } = await execFileAsync("docker", [
    "ps",
    "-a",
    "--filter",
    `name=${nameFilter}`,
    "--format",
    "{{.Names}}",
  ]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

test.describe("Managed Containers Flow", () => {
  test("creates a container in-place, pings it, verifies docker matches the UI, then deletes", async ({ page }) => {
    test.setTimeout(180000);

    // 1) Navigate to the containers list page
    await page.goto("/containers");
    await expect(page.getByRole("heading", { name: "Managed Containers" })).toBeVisible();

    // 2) Click "New Container" — should spawn inline (no navigation)
    await page.getByRole("button", { name: /New Container/ }).click();

    // 3) Wait for the new row to appear in the table and capture its name from the link
    const nameLink = page.getByRole("link").filter({ hasText: /^[0-9a-f]{12}$/ }).first();
    await expect(nameLink).toBeVisible({ timeout: 120000 });
    const uiContainerName = (await nameLink.textContent())?.trim() ?? "";
    expect(uiContainerName).toMatch(/^[0-9a-f]{12}$/);

    // The URL should still be /containers (no navigation away)
    await expect(page).toHaveURL(/\/containers$/);

    // 4) Verify via the docker CLI that the container exists with the expected name
    await test.step("docker ps shows the container with a matching name", async () => {
      const expectedDockerName = `afm-${uiContainerName}`;
      const matchingNames = await listDockerContainers(expectedDockerName);
      expect(matchingNames).toContain(expectedDockerName);
    });

    // 5) Click the name link to navigate to the view page
    await nameLink.click();
    await expect(page).toHaveURL(/\/containers\/\d+/);
    await expect(page.getByTestId("container-name")).toHaveText(uiContainerName);

    // 5a) Auto-ping on page load — the status Chip should reflect the live
    // health probe (green "ok") without the user clicking anything.
    await expect(page.getByTestId("container-status-chip")).toHaveText("ok", { timeout: 30000 });

    // 6) Click Ping Health and assert the displayed status and name
    await page.getByRole("button", { name: /Ping health/i }).click();
    await expect(page.getByTestId("ping-status")).toHaveText("ok", { timeout: 30000 });
    await expect(page.getByTestId("ping-name")).toHaveText(uiContainerName);

    // 6a) Navigate back to /containers and assert the row's persisted Status reflects the health probe
    await test.step("status column reflects the persisted health verdict", async () => {
      await page.getByRole("link", { name: /Back to Containers/i }).click();
      await expect(page).toHaveURL(/\/containers$/);
      const containerRow = page.getByRole("row").filter({ hasText: uiContainerName });
      await expect(containerRow).toContainText("running", { timeout: 10000 });
    });

    // 7) Re-open the container view and delete, expect to be redirected back to /containers
    await page.getByRole("link", { name: uiContainerName }).click();
    await expect(page).toHaveURL(/\/containers\/\d+/);
    await page.getByRole("button", { name: /^Delete$/ }).click();
    await expect(page).toHaveURL(/\/containers$/, { timeout: 30000 });

    // 8) Verify via the docker CLI that the container is gone
    await test.step("docker ps no longer shows the container", async () => {
      const expectedDockerName = `afm-${uiContainerName}`;
      const matchingNames = await listDockerContainers(expectedDockerName);
      expect(matchingNames).not.toContain(expectedDockerName);
    });
  });
});
