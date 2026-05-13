/**
 * Canonical real-world URLs we use to test our bot-bypass plumbing against
 * job-board sites. Importable from any spec so we don't have to retype them.
 *
 * - LINKEDIN_JOB_URL is a Cloudflare-light page (LinkedIn's own anti-bot is
 *   not Cloudflare-based) — used as our no-proxy baseline.
 * - INDEED_SEARCH_URL is a Cloudflare-protected page with Bot Management +
 *   Turnstile. Used to validate that our chosen anti-detect stack
 *   (currently: patchright + Smartproxy residential + headed Xvfb) actually
 *   gets past Cloudflare.
 *
 * These URLs may rot over time (LinkedIn job IDs are temporary). When that
 * happens, swap with any other public job listing/search URL on the same site
 * — the bot-detection profile is the property of the host, not the slug.
 */

/** A LinkedIn job listing the agent can analyze without any proxy. */
export const LINKEDIN_JOB_URL =
  "https://www.linkedin.com/jobs/view/software-engineer-new-grads-at-giga-4374834620/";

/** An Indeed search page (Cloudflare-protected). Must be hit with useProxy=true. */
export const INDEED_SEARCH_URL =
  "https://www.indeed.com/q-javascript-developer-l-new-york,-ny-jobs.html?vjk=50b8e91f61510df6";

/**
 * Substrings present in Cloudflare/Indeed's block + challenge pages but NOT in
 * the real Indeed listings. If any of these appears in a response body, we
 * know the bypass failed.
 */
export const CLOUDFLARE_BLOCK_MARKERS = [
  "Request Blocked",
  "Additional Verification Required",
  "Just a moment...",
  "Security Check - Indeed",
];
