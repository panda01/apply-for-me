import { test, expect } from "@playwright/test";
import {
  LINKEDIN_JOB_URL,
  INDEED_SEARCH_URL,
  CLOUDFLARE_BLOCK_MARKERS,
} from "./_jobBoardFixtures";

/**
 * End-to-end smoke tests against real job boards. These are the manual probes
 * we've been running in the terminal during the bot-bypass investigation,
 * captured here so they can be re-run after each plumbing change.
 *
 * Each test:
 *   1. spawns a managed container via the host API
 *   2. runs /screenshot or /analyze against a known URL
 *   3. asserts the response is the real page, not Cloudflare's block / challenge
 *   4. tears the container down again so we don't leak
 *
 * Notes:
 *   - These hit the real internet, cost real Smartproxy bandwidth + Anthropic
 *     tokens, and depend on the URLs in _jobBoardFixtures.ts still being live.
 *   - Run via `npx playwright test jobBoardBypass.spec.ts`.
 *   - The dev server (host) and Docker daemon must be running locally;
 *     playwright.config.ts's webServer block boots `npm run dev` for us.
 */

const SPAWN_TIMEOUT_MS = 360_000;
const ACTION_TIMEOUT_MS = 180_000;

/**
 * Block-page screenshots from Cloudflare are tiny (~30-50 KB). A real
 * Indeed search render with listings is meaningfully larger. This threshold
 * separates them with margin in both directions.
 */
const REAL_PAGE_MIN_BYTES = 80_000;

interface SpawnResponse {
  id: number;
  name: string;
  hostPort: number;
}

interface AnalyzeResponse {
  is_job_description: boolean;
  apply_button_present: boolean;
  description_signals: string[];
  reasoning: string;
  screenshot_b64: string;
}

test.describe("Job-board bot-bypass smoke", () => {
  test.describe.configure({ timeout: 600_000 });

  test("LinkedIn /analyze (no proxy) → real listing, apply button detected", async ({ request }) => {
    const spawn = await request.post("/api/managed-containers", {
      data: {},
      timeout: SPAWN_TIMEOUT_MS,
    });
    expect(spawn.status()).toBe(201);
    const { id } = (await spawn.json()) as SpawnResponse;

    try {
      const analyze = await request.post(`/api/managed-containers/${String(id)}/analyze`, {
        data: { url: LINKEDIN_JOB_URL, useProxy: false },
        timeout: ACTION_TIMEOUT_MS,
      });
      expect(analyze.status()).toBe(200);
      const result = (await analyze.json()) as AnalyzeResponse;

      expect(result.is_job_description).toBe(true);
      expect(result.apply_button_present).toBe(true);
      expect(result.description_signals.length).toBeGreaterThan(0);
      expect(result.screenshot_b64.length).toBeGreaterThan(1000);
      for (const marker of CLOUDFLARE_BLOCK_MARKERS) {
        expect(result.reasoning).not.toContain(marker);
      }
    } finally {
      await request.delete(`/api/managed-containers/${String(id)}`).catch(() => undefined);
    }
  });

  test("Indeed /screenshot (via proxy) → real listings page, not the Cloudflare block", async ({ request }) => {
    const spawn = await request.post("/api/managed-containers", {
      data: {},
      timeout: SPAWN_TIMEOUT_MS,
    });
    expect(spawn.status()).toBe(201);
    const { id } = (await spawn.json()) as SpawnResponse;

    try {
      const screenshot = await request.post(`/api/managed-containers/${String(id)}/screenshot`, {
        data: { url: INDEED_SEARCH_URL, useProxy: true },
        timeout: ACTION_TIMEOUT_MS,
      });
      expect(screenshot.status()).toBe(200);
      expect(screenshot.headers()["content-type"]).toMatch(/image\/png/);
      const buffer = await screenshot.body();
      // Cloudflare's "Request Blocked" / "Additional Verification" pages render
      // to PNGs in the 30-50KB range. A real Indeed search results render is
      // well over 80KB once the listings, filters, and sidebar are included.
      expect(buffer.byteLength).toBeGreaterThan(REAL_PAGE_MIN_BYTES);
    } finally {
      await request.delete(`/api/managed-containers/${String(id)}`).catch(() => undefined);
    }
  });

  test("Indeed /analyze (via proxy) → agent reasoning does not mention the block", async ({ request }) => {
    const spawn = await request.post("/api/managed-containers", {
      data: {},
      timeout: SPAWN_TIMEOUT_MS,
    });
    expect(spawn.status()).toBe(201);
    const { id } = (await spawn.json()) as SpawnResponse;

    try {
      const analyze = await request.post(`/api/managed-containers/${String(id)}/analyze`, {
        data: { url: INDEED_SEARCH_URL, useProxy: true },
        timeout: ACTION_TIMEOUT_MS,
      });
      expect(analyze.status()).toBe(200);
      const result = (await analyze.json()) as AnalyzeResponse;

      // We don't assert is_job_description here — Indeed's *search* page
      // may or may not pass our Class-A/B detector depending on what listings
      // it renders. The hard signal is that the agent's reasoning shouldn't
      // mention any of the Cloudflare block / challenge text — that would
      // mean we got blocked instead of seeing the real page.
      for (const marker of CLOUDFLARE_BLOCK_MARKERS) {
        expect(result.reasoning).not.toContain(marker);
      }
      expect(result.screenshot_b64.length).toBeGreaterThan(1000);
    } finally {
      await request.delete(`/api/managed-containers/${String(id)}`).catch(() => undefined);
    }
  });
});
