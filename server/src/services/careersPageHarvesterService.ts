/**
 * Service module that, given a careers page URL, returns the top candidate
 * hrefs likely to point at a specific job opening. Used by the resolver's
 * fallback path: when no Brave search result is a direct job listing but
 * one is a company careers page, we drill into that page to find the actual
 * posting.
 *
 * Pipeline inside this service (all deterministic, no LLM calls):
 *
 *   1. Call the managed container's /extract-links endpoint to get every
 *      absolute http(s) anchor on the rendered careers page.
 *   2. Fuzzy-match the combined "text + accessibleName" of each anchor
 *      against the target job title using fuzzyMatchService's
 *      selectTopKAboveThreshold (so the FUZZY_MATCH_MIN_SCORE threshold and
 *      FUZZY_MATCH_TOP_K cap from that module both apply here — see the
 *      JSDoc on those constants for why this is the call site they were
 *      designed for).
 *   3. Return the top-K candidate hrefs in best-first order along with a
 *      `rawLinkCount` (for trace logging) and the per-link score (so the
 *      resolver can persist it for inspection).
 *
 * Note: we intentionally do NOT pre-filter by domain. Most modern careers
 * pages host postings on third-party ATSes (Workable, Greenhouse, Lever,
 * Ashby) reached via off-domain hrefs — a same-domain filter would drop
 * exactly the candidates we want. The 0.50 fuzzy threshold filters noise
 * (social-media badges, login pages, footer nav), and the resolver's own
 * gated-host check still blocks anything pointing back to LinkedIn/Indeed.
 *
 * Failure modes are gracefully reported (not thrown) by the resolver: an
 * empty result array means "no usable links found" and the resolver falls
 * through to the next careers page or to not_found.
 */

import {
  extractLinksViaContainer,
  type ExtractedLink,
} from "./smartProxyScraperService.js";
import { selectTopKAboveThreshold } from "./fuzzyMatchService.js";

/**
 * Deduplicates a list of links by absolute href. Many careers pages render
 * each role multiple times (header listing + grid listing + footer recap)
 * so the same href shows up dozens of times — keeping only the first
 * occurrence yields a cleaner trace and avoids exhausting the resolver's
 * top-K budget on duplicates of the same posting.
 *
 * @param {ExtractedLink[]} links - The raw anchor list returned by /extract-links
 * @returns {ExtractedLink[]} The unique-by-href subset, in original order
 */
function dedupeLinksByHref(links: ExtractedLink[]): ExtractedLink[] {
  const seenHrefs = new Set<string>();
  const unique: ExtractedLink[] = [];
  for (const link of links) {
    if (seenHrefs.has(link.href)) continue;
    seenHrefs.add(link.href);
    unique.push(link);
  }
  return unique;
}

/**
 * One scored candidate href ready to be scraped + evaluated by the resolver.
 * Score is the token-set Jaccard between the target title and the link's
 * combined text+accessibleName, in [0, 1].
 */
export interface HarvestedHref {
  href: string;
  text: string;
  accessibleName: string;
  score: number;
}

/**
 * Result of {@link harvestCareersPage}. The host persists `rawLinkCount` in
 * the resolution trace so the user can see "we looked at N anchors on the
 * careers page and kept K". `topHrefs` is in best-first order.
 */
export interface CareersPageHarvestResult {
  careersPageUrl: string;
  rawLinkCount: number;
  topHrefs: HarvestedHref[];
}

/**
 * Returns the string the harvester scores against the target title: the
 * link's visible text concatenated with its accessibleName when the two
 * differ. Falls back to whichever is non-empty when one is missing.
 *
 * The combined string is more robust than either field alone — icon-only
 * anchors carry their meaning in the accessibleName, while text-only anchors
 * have an empty accessibleName.
 *
 * @param {ExtractedLink} link - The anchor entry
 * @returns {string} The combined text used for fuzzy scoring
 */
export function buildFuzzyMatchText(link: ExtractedLink): string {
  const text = link.text.trim();
  const accessibleName = link.accessibleName.trim();
  if (text.length > 0 && accessibleName.length > 0 && text !== accessibleName) {
    return `${text} ${accessibleName}`;
  }
  if (text.length > 0) return text;
  return accessibleName;
}

/**
 * Fetches every anchor on the careers page via the container, filters to
 * on-domain anchors, and returns the top candidate hrefs likely to be the
 * target job's posting — ranked by fuzzy match score against the title.
 *
 * Empty result list when:
 *   - the container returns zero anchors (e.g. SPA careers page that lazy-
 *     loads via a search box without a static listing),
 *   - every anchor is off-domain (filtered out),
 *   - no on-domain anchor meets the fuzzy-score threshold.
 *
 * The caller surfaces the empty case as "no candidates from this careers
 * page" in the resolution trace and continues to the next page.
 *
 * @param {number} containerHostPort - The managed container's host port
 * @param {string} careersPageUrl - The careers page to harvest
 * @param {string} targetTitle - The target job title for fuzzy matching
 * @returns {Promise<CareersPageHarvestResult>} Top scored on-domain hrefs (possibly empty)
 * @throws {Error} If the container's /extract-links call fails
 */
export async function harvestCareersPage(
  containerHostPort: number,
  careersPageUrl: string,
  targetTitle: string
): Promise<CareersPageHarvestResult> {
  const response = await extractLinksViaContainer(containerHostPort, careersPageUrl);
  const rawLinkCount = response.links.length;
  const uniqueLinks = dedupeLinksByHref(response.links);

  const scoredLinks = selectTopKAboveThreshold(
    uniqueLinks,
    (link) => buildFuzzyMatchText(link),
    targetTitle,
    (link) => link.href
  );

  const topHrefs: HarvestedHref[] = scoredLinks.map(({ item, score }) => ({
    href: item.href,
    text: item.text,
    accessibleName: item.accessibleName,
    score,
  }));

  return {
    careersPageUrl,
    rawLinkCount,
    topHrefs,
  };
}
