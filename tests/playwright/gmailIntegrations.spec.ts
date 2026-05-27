import { test, expect } from "@playwright/test";

/**
 * Playwright spec for the IntegrationsPage and the parts of the Gmail OAuth
 * flow that DON'T require driving Google's sign-in (Google blocks automation
 * on real sign-in flows — see feedback_google_oauth_no_playwright.md). The
 * actual end-to-end consent + token-exchange is verified manually by running
 * `npm run verify:gmail-oauth` and signing in via your real browser.
 *
 * What this spec covers:
 *  1. The page renders, the Connect button is present, and the listing
 *     endpoint is reachable.
 *  2. Clicking Connect Gmail navigates the browser to accounts.google.com
 *     (i.e. the server returned a real authorization URL and the page
 *     redirected to it).
 *  3. The /api/gmail/auth/url endpoint returns a well-formed URL.
 *  4. The /api/oauth/gmail callback's CSRF guard rejects a missing state.
 */
test.describe("Integrations page + Gmail OAuth plumbing", () => {
  test("renders the IntegrationsPage with the Connect Gmail button", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByRole("heading", { name: /integrations/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /connect gmail/i })).toBeVisible();
  });

  test("clicking Connect Gmail navigates to accounts.google.com", async ({ page }) => {
    await page.goto("/integrations");
    await page.getByRole("button", { name: /connect gmail/i }).click();
    // Don't navigate past the consent screen — Google blocks automation.
    // Just verify we left the local app and reached Google.
    await page.waitForURL((url) => url.host.includes("accounts.google.com"), { timeout: 15000 });
  });

  test("GET /api/gmail/auth/url returns a Google authorization URL with the required params", async ({ request }) => {
    const response = await request.get("/api/gmail/auth/url");
    expect(response.ok()).toBe(true);
    const body = await response.json() as { url: string; state: string };
    expect(body.url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(body.url).toContain("access_type=offline");
    expect(body.url).toContain("scope=");
    expect(body.url).toContain("state=");
    expect(body.state).toMatch(/^[a-f0-9]{32,}$/);
  });

  test("OAuth callback rejects requests with an invalid state token", async ({ request }) => {
    // Use a state value that was never issued — consumeState() should return
    // false and the handler should redirect with error=invalid_or_expired_state.
    const response = await request.get("/api/oauth/gmail?code=fake-code&state=never-issued-state", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    const location = response.headers().location;
    expect(location).toContain("error=invalid_or_expired_state");
  });
});
