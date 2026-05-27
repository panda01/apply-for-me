/**
 * Manual verification script for the Gmail OAuth flow. NOT a *.spec.ts because
 * it requires a human to complete Google's sign-in / consent — there's no
 * meaningful pass/fail without that interaction, and Google blocks fully
 * automated sign-ins on real accounts anyway.
 *
 * How to use:
 *   1. Ensure GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, and
 *      GMAIL_OAUTH_REDIRECT_URI are set in .env, and that your Google account
 *      is added as a test user in the GCP OAuth consent screen.
 *   2. Start the dev server in another terminal: `npm run dev`.
 *   3. Run this script: `npm run verify:gmail-oauth`.
 *   4. A headed Chromium opens at /integrations. The script clicks "Connect
 *      Gmail," waits for the redirect to Google, then calls page.pause(),
 *      which opens Playwright Inspector.
 *   5. In the browser window, complete sign-in. If Google shows the
 *      "unverified app" warning, click Advanced → "Go to (unsafe)" to
 *      continue. Approve the gmail.readonly scope.
 *   6. After Google redirects you back to /integrations, press Resume in the
 *      Inspector.
 *   7. The script verifies the URL contains ?connected=<email>, polls the
 *      API for the persisted row, and prints the result.
 *   8. The browser stays open until you press Ctrl+C.
 */

import { chromium } from "playwright";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "..", "..", ".env") });

const CLIENT_PORT = process.env.CLIENT_PORT;
const SERVER_PORT = process.env.SERVER_PORT;
if (CLIENT_PORT === undefined || SERVER_PORT === undefined) {
  console.error("CLIENT_PORT and SERVER_PORT must be set in .env");
  process.exit(1);
}

const CLIENT_BASE_URL = `http://localhost:${CLIENT_PORT}`;
const SERVER_BASE_URL = `http://localhost:${SERVER_PORT}`;
const INTEGRATIONS_URL = `${CLIENT_BASE_URL}/integrations`;
const HEALTH_URL = `${SERVER_BASE_URL}/api/health`;
const CONNECTIONS_URL = `${SERVER_BASE_URL}/api/gmail/connections`;

/**
 * Pings the server's health endpoint with a short timeout. Exits with a
 * helpful message if the dev server isn't running so the user doesn't get a
 * cryptic Playwright timeout instead.
 *
 * @returns {Promise<void>}
 */
async function assertServerIsRunning(): Promise<void> {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    const isOk = response.ok;
    if (!isOk) {
      throw new Error(`Health endpoint returned status ${String(response.status)}`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Dev server not reachable at ${SERVER_BASE_URL}: ${errorMessage}`);
    console.error("  Start it with `npm run dev` in another terminal, then re-run this script.\n");
    process.exit(1);
  }
}

/**
 * Fetches the persisted Gmail connections via the public API. Used after the
 * user completes sign-in to confirm the row landed in the DB.
 *
 * @returns {Promise<Array<{ id: number; google_email: string; scopes: string; access_token_expires_at: string }>>}
 */
async function fetchPersistedConnections(): Promise<
  { id: number; google_email: string; scopes: string; access_token_expires_at: string }[]
> {
  const response = await fetch(CONNECTIONS_URL);
  const isNotOk = !response.ok;
  if (isNotOk) {
    throw new Error(`GET /api/gmail/connections returned ${String(response.status)}`);
  }
  return response.json() as Promise<
    { id: number; google_email: string; scopes: string; access_token_expires_at: string }[]
  >;
}

/**
 * Top-level script: spins up a headed browser, walks the user through the
 * OAuth flow with a page.pause() at the Google sign-in step, then asserts
 * the callback persisted a connection row.
 */
async function main(): Promise<void> {
  console.log("→ Pre-flight: checking dev server health…");
  await assertServerIsRunning();
  console.log("  ✓ Server up\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`→ Opening ${INTEGRATIONS_URL}`);
  await page.goto(INTEGRATIONS_URL);

  console.log("→ Clicking 'Connect Gmail'");
  await page.getByRole("button", { name: /connect gmail/i }).click();

  console.log("→ Waiting for redirect to accounts.google.com…");
  await page.waitForURL((url) => url.host.includes("accounts.google.com"), { timeout: 15000 });
  console.log("  ✓ Reached Google\n");

  console.log("┌────────────────────────────────────────────────────────────────────┐");
  console.log("│  PAUSED FOR YOU TO SIGN IN.                                       │");
  console.log("│                                                                    │");
  console.log("│  In the browser window:                                            │");
  console.log("│    1. Sign in to the Google account you want to connect.           │");
  console.log("│    2. If you see 'Google hasn't verified this app', click          │");
  console.log("│       'Advanced' → 'Go to apply-for-me (unsafe)'.                  │");
  console.log("│    3. Approve the gmail.readonly scope.                            │");
  console.log("│    4. Wait until the URL is back on /integrations?connected=…     │");
  console.log("│    5. Click ▶ Resume in the Playwright Inspector.                  │");
  console.log("└────────────────────────────────────────────────────────────────────┘\n");
  await page.pause();

  console.log("→ Waiting for callback redirect back to /integrations…");
  await page.waitForURL((url) => url.pathname === "/integrations" && url.searchParams.has("connected"), {
    timeout: 60000,
  });
  const finalUrl = new URL(page.url());
  const connectedEmail = finalUrl.searchParams.get("connected");
  console.log(`  ✓ Returned to /integrations?connected=${String(connectedEmail)}\n`);

  console.log("→ Fetching persisted rows via GET /api/gmail/connections");
  const connections = await fetchPersistedConnections();
  const matchedRow = connections.find((row) => row.google_email === connectedEmail);
  const isMissingRow = matchedRow === undefined;
  if (isMissingRow) {
    console.error(`  ✗ No row found for ${String(connectedEmail)} — DB write failed`);
    console.error("  Server logs should have the failure reason.");
    await browser.close();
    process.exit(1);
  }

  console.log("  ✓ Row present:");
  console.log(`      id:                       ${String(matchedRow.id)}`);
  console.log(`      google_email:             ${matchedRow.google_email}`);
  console.log(`      scopes:                   ${matchedRow.scopes}`);
  console.log(`      access_token_expires_at:  ${matchedRow.access_token_expires_at}\n`);

  console.log("✅ MANUAL VERIFICATION PASSED");
  console.log("Browser left open for you to poke around — Ctrl+C when done.");

  // Keep the script alive until the user kills it so they can inspect the
  // browser. Resolves only on SIGINT.
  await new Promise<void>((resolveProcess) => {
    process.on("SIGINT", () => {
      void browser.close().then(() => { resolveProcess(); });
    });
  });
}

main().catch((err: unknown) => {
  const errorMessage = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`\n✗ Manual verification crashed:\n${errorMessage}`);
  process.exit(1);
});
