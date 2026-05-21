/**
 * Service module providing the deterministic fuzzy-match scoring function used
 * in two distinct places by the application-URL resolver:
 *
 *   1. ORDERING Brave search results that have been classified as either
 *      direct_job_listing or careers_page. We sort each subset by fuzzy score
 *      best-first so the resolver inspects the most-likely-correct candidate
 *      before the less-likely ones. NO threshold is applied — the existing
 *      jobMatchService.evaluateJobMatch decides which candidate is actually
 *      accepted; this service only chooses the order.
 *
 *   2. SELECTING anchor hrefs inside a careers page. Once a careers page has
 *      been scraped and its <a> tags extracted, we score each link's text
 *      against the target job title and keep only the top FUZZY_MATCH_TOP_K
 *      hrefs whose score is at or above FUZZY_MATCH_MIN_SCORE. A threshold is
 *      necessary here because careers pages can render hundreds of irrelevant
 *      links (filters, locations, departments, footer nav) — without a cutoff
 *      we'd scrape unrelated pages.
 *
 * The scoring function itself is the same in both places — only the post-
 * filtering differs. Keep this asymmetry in mind when modifying the constants:
 * they exist solely for the careers-page link-selection case.
 */

/**
 * Minimum Jaccard score (0..1) a link must achieve to be considered a viable
 * candidate INSIDE a careers page. 0.50 was chosen because token-set Jaccard
 * tends to under-score titles that include extra qualifying tokens
 * ("Senior Backend Engineer - Remote (US)" vs "Senior Backend Engineer" =
 * ~0.55), while clearly unrelated links score well below 0.20.
 *
 * IMPORTANT: this threshold applies ONLY to careers-page link selection
 * (selectTopKAboveThreshold). It does NOT apply when ordering Brave results
 * (rankByFuzzyScore) — that path retains all classified candidates and only
 * uses the score for sort order.
 */
export const FUZZY_MATCH_MIN_SCORE = 0.50;

/**
 * Maximum number of careers-page links to retain after threshold filtering.
 * Bounds the worst-case scrape budget so a pathological careers page (with
 * many superficially-similar links) cannot blow up the resolver's latency.
 *
 * IMPORTANT: applies ONLY to careers-page link selection
 * (selectTopKAboveThreshold). NOT used by rankByFuzzyScore.
 */
export const FUZZY_MATCH_TOP_K = 5;

/**
 * Words ignored during tokenization — common English stop-words plus a small
 * set of job-board boilerplate. Kept short on purpose; over-aggressive
 * filtering removes signal that distinguishes "Senior Software Engineer" from
 * "Senior Site Reliability Engineer".
 */
const STOP_WORDS = new Set<string>([
  "a", "an", "and", "or", "of", "at", "for", "in", "on", "to", "the", "with",
  "by", "from", "as", "is", "are", "be",
]);

/**
 * Tokenizes a string for fuzzy comparison: lowercase, strip punctuation,
 * split on whitespace, drop stop-words. Returns a Set so subsequent
 * intersection/union math is O(n+m). The function is exported so tests can
 * pin its behavior independently of the scoring caller.
 *
 * @param {string} text - Raw string (may be empty, whitespace, or punctuated)
 * @returns {Set<string>} Set of meaningful tokens (possibly empty)
 */
export function tokenizeForFuzzyMatch(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = new Set<string>();
  if (normalized.length === 0) return tokens;
  for (const word of normalized.split(" ")) {
    if (STOP_WORDS.has(word)) continue;
    if (word.length === 0) continue;
    tokens.add(word);
  }
  return tokens;
}

/**
 * Computes the token-set Jaccard similarity between two strings:
 * |A ∩ B| / |A ∪ B|. Returns 0 when either input tokenizes to the empty set
 * (so callers don't accidentally rank something against nothing as "perfect").
 *
 * Chosen over Levenshtein because Levenshtein penalizes extra qualifying
 * tokens ("Senior Backend Engineer - Remote (US)" vs "Senior Backend
 * Engineer") heavily, whereas Jaccard ignores order and tolerates extras.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Score in [0, 1]
 */
export function tokenSetJaccardScore(a: string, b: string): number {
  const tokensA = tokenizeForFuzzyMatch(a);
  const tokensB = tokenizeForFuzzyMatch(b);
  const isEitherEmpty = tokensA.size === 0 || tokensB.size === 0;
  if (isEitherEmpty) return 0;
  let intersectionCount = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersectionCount += 1;
  }
  const unionCount = tokensA.size + tokensB.size - intersectionCount;
  return intersectionCount / unionCount;
}

/**
 * Result row from rankByFuzzyScore / selectTopKAboveThreshold. Preserves the
 * original item plus its computed score so callers can both act on the item
 * and log the score in the resolution trace.
 */
export interface ScoredItem<T> {
  item: T;
  score: number;
}

/**
 * Sorts a list of items by fuzzy score against the target, descending. Does
 * NOT apply a threshold — every input item appears in the output. Stable
 * tiebreaker: when two items share the same score, the one with the shorter
 * extracted text wins; if both are equal length too, the one with the
 * lexicographically smaller tiebreaker key wins. This gives a deterministic
 * order across runs which is required for the trace to be reproducible.
 *
 * Intended call sites: ordering Brave results that have already been
 * classified into the direct_job_listing or careers_page subsets. Each
 * subset is sorted independently.
 *
 * @template T
 * @param {T[]} items - The items to rank
 * @param {(item: T) => string} extractText - Returns the string scored against the target (e.g., the snippet)
 * @param {string} target - The reference string (e.g., the job title)
 * @param {(item: T) => string} extractTiebreakerKey - Returns a stable key used to break score+length ties
 * @returns {ScoredItem<T>[]} The same items in best-first order with their scores
 */
export function rankByFuzzyScore<T>(
  items: T[],
  extractText: (item: T) => string,
  target: string,
  extractTiebreakerKey: (item: T) => string
): ScoredItem<T>[] {
  const scored: { item: T; score: number; extractedText: string; tiebreaker: string }[] = items.map((item) => {
    const extractedText = extractText(item);
    return {
      item,
      score: tokenSetJaccardScore(target, extractedText),
      extractedText,
      tiebreaker: extractTiebreakerKey(item),
    };
  });
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.extractedText.length !== right.extractedText.length) {
      return left.extractedText.length - right.extractedText.length;
    }
    return left.tiebreaker.localeCompare(right.tiebreaker);
  });
  return scored.map(({ item, score }) => ({ item, score }));
}

/**
 * Filters a list of items to those whose fuzzy score is at or above the given
 * minimum score, then keeps the top topK by score (descending). Uses the same
 * stable tiebreaker as {@link rankByFuzzyScore}.
 *
 * Intended call site: careers-page link selection, where the input is the
 * full list of `<a>` tags scraped from a careers page (often hundreds) and
 * we need a small, high-confidence subset to actually scrape and evaluate.
 *
 * @template T
 * @param {T[]} items - The items to filter and rank
 * @param {(item: T) => string} extractText - Returns the string scored against the target
 * @param {string} target - The reference string (e.g., the job title)
 * @param {(item: T) => string} extractTiebreakerKey - Stable key used to break score+length ties
 * @param {{ topK: number; minScore: number }} options - Overrides for the topK cap and threshold; defaults to the module-level constants
 * @returns {ScoredItem<T>[]} Up to topK items above minScore, best-first
 */
export function selectTopKAboveThreshold<T>(
  items: T[],
  extractText: (item: T) => string,
  target: string,
  extractTiebreakerKey: (item: T) => string,
  options: { topK?: number; minScore?: number } = {}
): ScoredItem<T>[] {
  const topK = options.topK ?? FUZZY_MATCH_TOP_K;
  const minScore = options.minScore ?? FUZZY_MATCH_MIN_SCORE;
  const ranked = rankByFuzzyScore(items, extractText, target, extractTiebreakerKey);
  const aboveThreshold = ranked.filter((entry) => entry.score >= minScore);
  return aboveThreshold.slice(0, topK);
}
