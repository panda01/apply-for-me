/**
 * Service module that scrapes a job listing by proxying to a managed Docker
 * container's /analyze endpoint. Replaces the previous Browser-Use SDK based
 * scraper: the container's Playwright+Claude agent visits the page (through
 * its WireGuard egress and optionally Smartproxy), dismisses popups, expands
 * collapsed descriptions, and reports back structured fields plus an
 * apply-button URL the resolver service consumes downstream.
 *
 * All calls are aborted after SCRAPE_TIMEOUT_MS so a stuck container doesn't
 * stall the API for minutes. The container side has its own per-turn token
 * limit, so this timeout only fires for catastrophic stalls (browser crash,
 * Playwright nav timeout, etc.).
 */

import prisma from "../prismaClient.js";

/**
 * Maximum time (ms) to wait for the container's /analyze response. The agent
 * loop inside the container is allowed up to ~120s by managedContainers.ts;
 * we set this to the same value here so the host gives up at the same time
 * the container does.
 */
const SCRAPE_TIMEOUT_MS = 120000;

/**
 * Whether to route the container's outbound page fetch through Smartproxy
 * residential exits. Defaults to true so Cloudflare-protected sites like
 * Indeed work out of the box (matches the frontend ScreenshotPanel default).
 */
const DEFAULT_USE_PROXY = true;

/**
 * Subset of the AnalyzeResult shape returned by the container's /analyze
 * endpoint that the host scraper exposes to callers. The host does not need
 * the description_signals chips or the screenshot bytes (kept inside the
 * /analyze proxy route's existing response shape for the UI) — those would
 * just bloat the scraper API.
 */
export interface ScrapedJobListing {
  title: string;
  company: string;
  description: string;
  salary: string | null;
  post_date: string | null;
  apply_button_url: string | null;
  is_job_description: boolean;
  reasoning: string;
}

/**
 * Raw response shape from POST /api/managed-containers/:id/analyze. Mirrors
 * docker/managed-container/agent.ts:AnalyzeResult so the structural type stays
 * in sync; if the agent's report schema changes, update both.
 */
interface AnalyzeRouteResponse {
  is_job_description: boolean;
  apply_button_present: boolean;
  description_signals: string[];
  reasoning: string;
  screenshot_b64: string;
  title: string;
  company: string;
  description: string;
  salary: string | null;
  post_date: string | null;
  apply_button_url: string | null;
}

/**
 * Finds the first running managed container (lowest id) the resolver can use.
 * Returns null when none exist; callers should surface a clear error so the
 * user knows to spawn one on the /containers page.
 * @returns {Promise<{ id: number; hostPort: number } | null>} The chosen container's id + hostPort, or null
 */
export async function findFirstRunningContainer(): Promise<{ id: number; hostPort: number } | null> {
  const candidate = await prisma.managedContainer.findFirst({
    where: { status: "running" },
    orderBy: { id: "asc" },
    select: { id: true, hostPort: true },
  });
  return candidate;
}

/**
 * Calls a managed container's /analyze endpoint directly on localhost (the
 * container is bound to 127.0.0.1:hostPort by dockerContainerService). We use
 * the loopback fetch rather than going through Express to avoid an extra hop
 * and to keep this service independent of the route layer.
 *
 * @param {number} containerHostPort - The host port the container is bound to
 * @param {string} jobUrl - The job listing URL to scrape
 * @param {boolean} useProxy - When true, the container routes its page fetch through Smartproxy
 * @returns {Promise<ScrapedJobListing>} The structured scrape result
 * @throws {Error} If the container returns non-2xx, times out, or is unreachable
 */
export async function scrapeJobViaContainer(
  containerHostPort: number,
  jobUrl: string,
  useProxy: boolean = DEFAULT_USE_PROXY
): Promise<ScrapedJobListing> {
  // AbortSignal.timeout encapsulates the abort/clearTimeout pair into a single
  // signal that self-aborts after the elapsed window.
  const upstream = await fetch(`http://127.0.0.1:${String(containerHostPort)}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: jobUrl, useProxy }),
    signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
  });

  const isNotOk = !upstream.ok;
  if (isNotOk) {
    let errorBody: { error?: string } = {};
    try {
      errorBody = await upstream.json() as { error?: string };
    } catch {
      // No parseable JSON body — fall through to status-text fallback below.
    }
    const message = typeof errorBody.error === "string" && errorBody.error.length > 0
      ? errorBody.error
      : `${String(upstream.status)} ${upstream.statusText}`;
    throw new Error(`Container scrape failed: ${message}`);
  }

  const body = await upstream.json() as AnalyzeRouteResponse;
  return {
    title: body.title,
    company: body.company,
    description: body.description,
    salary: body.salary,
    post_date: body.post_date,
    apply_button_url: body.apply_button_url,
    is_job_description: body.is_job_description,
    reasoning: body.reasoning,
  };
}
