import { test, expect } from "@playwright/test";

/**
 * End-to-end test for the per-container screenshot feature:
 *  - Spawn a managed container
 *  - Open its detail page
 *  - Capture a screenshot of google.com (mocked at the network layer with a fixture
 *    PNG so the test does not depend on real WireGuard egress or chromium-in-container)
 *  - Verify the rendered <img> uses a blob: URL
 *  - Verify a server failure produces a visible error alert
 *
 * The container provisioning uses real Docker (matching managedContainers.spec.ts);
 * only the /screenshot proxy is intercepted so the test stays deterministic.
 */

const PNG_FIXTURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic bytes
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

test.describe("Screenshot panel on the container detail page", () => {
  test("captures a screenshot, displays the image, and surfaces server errors", async ({ page }) => {
    test.setTimeout(180000);

    // Spawn a container via the existing list-page flow
    await page.goto("/containers");
    await page.getByRole("button", { name: /New Container/ }).click();
    const nameLink = page.getByRole("link").filter({ hasText: /^[0-9a-f]{12}$/ }).first();
    await expect(nameLink).toBeVisible({ timeout: 120000 });
    const uiContainerName = (await nameLink.textContent())?.trim() ?? "";
    await nameLink.click();
    await expect(page.getByTestId("container-name")).toHaveText(uiContainerName);

    // Intercept the screenshot proxy so the test does not depend on chromium+WG inside the container.
    await page.route("**/api/managed-containers/*/screenshot", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PNG_FIXTURE,
      });
    });

    // The URL field defaults to https://google.com — just hit Capture
    await page.getByTestId("screenshot-capture-button").click();
    const img = page.getByTestId("screenshot-image");
    await expect(img).toBeVisible();
    const renderedSrc = await img.getAttribute("src");
    expect(renderedSrc?.startsWith("blob:")).toBeTruthy();

    // Now make the upstream fail and confirm the user sees a clear error alert.
    await page.unroute("**/api/managed-containers/*/screenshot");
    await page.route("**/api/managed-containers/*/screenshot", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Container screenshot failed: page.goto: net::ERR_NAME_NOT_RESOLVED" }),
      });
    });

    await page.getByTestId("screenshot-url-input").fill("https://nonexistent.invalid");
    await page.getByTestId("screenshot-capture-button").click();
    await expect(page.getByTestId("screenshot-error")).toContainText(/ERR_NAME_NOT_RESOLVED/);

    // Cleanup: delete the container so other tests don't accumulate state.
    await page.getByRole("button", { name: /^Delete$/ }).click();
    await expect(page).toHaveURL(/\/containers$/, { timeout: 30000 });
  });
});
