/**
 * Service module for cleaning user-supplied job URLs before they're stored or
 * used to resolve an application page.
 *
 * Job links pasted from email digests (LinkedIn/Indeed especially) carry a long
 * tail of per-recipient tracking tokens that add nothing to the actual posting
 * identity and just bloat logs and the stored URL. We strip those by DENYLIST
 * rather than wiping the whole query string, because some applicant-tracking
 * systems encode the job id in the query (e.g. Greenhouse `?gh_jid=123`,
 * Lever/Ashby variants) and must be preserved.
 */

/**
 * Exact query-param keys (lowercased) considered pure tracking noise. Generic
 * web analytics plus the LinkedIn/Indeed email-digest tokens. `utm_*` is matched
 * by prefix separately in {@link stripTrackingParams}.
 */
const TRACKING_PARAM_DENYLIST = new Set<string>([
  // Generic click/analytics ids
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "vero_id",
  "_hsenc",
  "_hsmi",
  "oly_anon_id",
  "oly_enc_id",
  // LinkedIn / Indeed email-digest + page-instrumentation tokens
  "trackingid",
  "refid",
  "lipi",
  "lici",
  "midtoken",
  "midsig",
  "trk",
  "trkemail",
  "eid",
  "otptoken",
  "savelippt",
]);

/**
 * Removes known tracking/analytics query parameters from a URL by denylist,
 * preserving functional params and the path. Matching is case-insensitive, and
 * any `utm_*` param is dropped regardless of suffix.
 *
 * Returns the original string unchanged when it isn't a parseable absolute URL,
 * or when no tracking params were present (so a clean URL is never re-encoded
 * or normalized in surprising ways).
 *
 * @param {string} rawUrl - The URL to clean
 * @returns {string} The URL with tracking params stripped, or the original on parse failure / nothing to strip
 */
export function stripTrackingParams(rawUrl: string): string {
  if (!URL.canParse(rawUrl)) {
    return rawUrl;
  }
  const parsed = new URL(rawUrl);
  const isTrackingParam = (key: string): boolean => {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith("utm_")) {
      return true;
    }
    return TRACKING_PARAM_DENYLIST.has(lowerKey);
  };
  // Snapshot the keys first — deleting from URLSearchParams while iterating it
  // is unsafe and can skip entries.
  const trackingKeys = [...parsed.searchParams.keys()].filter(isTrackingParam);
  if (trackingKeys.length === 0) {
    return rawUrl;
  }
  for (const key of trackingKeys) {
    parsed.searchParams.delete(key);
  }
  return parsed.toString();
}
