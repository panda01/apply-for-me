/**
 * Service module that decides whether a candidate page (found via web search)
 * represents the SAME job listing as the original scraped one. The resolver
 * uses this to verify that "Senior Software Engineer" at acme.com is actually
 * the same role as the LinkedIn / Indeed posting we started from, before
 * adopting the company-site URL as the application_url.
 *
 * Decision strategy: title containment (case-insensitive, normalized — one
 * title appears as a whole-word phrase inside the other) AND a minimum
 * token-overlap ratio between descriptions. Both signals are cheap,
 * deterministic, and avoid an extra LLM round-trip. Containment (rather than
 * exact equality) lets a "Full Stack Engineer - Senior" listing match a company
 * page titled just "Full Stack Engineer". The description overlap is the guard
 * against over-matching, since two different roles at one company rarely share
 * their bullet-point Responsibilities text.
 */

/**
 * Minimum fraction of the original job's description tokens that must also
 * appear in the candidate's description for the pages to be considered the
 * same job. 0.40 (40%) is intentionally permissive so paraphrased
 * company-site descriptions (which often re-word the Indeed/LinkedIn text)
 * still match. Tune downward if false positives appear in practice.
 */
const MIN_DESCRIPTION_TOKEN_OVERLAP_RATIO = 0.40;

/**
 * Words ignored when tokenizing descriptions — common English stop-words plus
 * a small set of job-listing boilerplate ("apply", "company", etc.) that
 * appears in nearly every posting and would inflate the overlap ratio.
 */
const STOP_WORDS = new Set<string>([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was",
  "were", "will", "with", "you", "your", "we", "our", "us", "they", "their",
  "but", "not", "if", "than", "then", "so", "do", "does", "did", "can", "may",
  "any", "all", "no", "more", "less", "such", "what", "who", "which", "how",
  "apply", "company", "candidate", "candidates", "applicant", "role", "position",
  "job", "jobs", "opportunity", "team", "work", "working",
]);

/**
 * Normalizes a string into a comparable form: lowercase, collapse internal
 * whitespace, and strip punctuation. Used so "Senior Software Engineer, II"
 * matches "senior software engineer ii".
 * @param {string} text - The raw string to normalize
 * @returns {string} The normalized form (may be empty)
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenizes a description for overlap comparison: normalizes, splits on
 * whitespace, drops stop words and tokens shorter than 3 characters (which
 * tend to be noise).
 * @param {string} text - The raw description text
 * @returns {Set<string>} The set of unique meaningful tokens
 */
export function tokenizeDescription(text: string): Set<string> {
  const normalized = normalizeForMatch(text);
  const tokens = new Set<string>();
  if (normalized.length === 0) return tokens;
  for (const word of normalized.split(" ")) {
    const isStopWord = STOP_WORDS.has(word);
    const isTooShort = word.length < 3;
    if (isStopWord || isTooShort) continue;
    tokens.add(word);
  }
  return tokens;
}

/**
 * Computes what fraction of the FIRST set's tokens are also present in the
 * SECOND set. Returns 0 when the first set is empty (so callers don't
 * accidentally accept a match against an empty description).
 *
 * Asymmetric on purpose: we want to know how much of the ORIGINAL job's
 * substance appears in the candidate, not vice-versa. A candidate page
 * may include a lot of extra boilerplate the original didn't.
 *
 * @param {Set<string>} originalTokens - Tokens from the original job description
 * @param {Set<string>} candidateTokens - Tokens from the candidate page description
 * @returns {number} Overlap ratio in [0, 1]
 */
export function computeOverlapRatio(originalTokens: Set<string>, candidateTokens: Set<string>): number {
  const isEmpty = originalTokens.size === 0;
  if (isEmpty) return 0;
  let intersectionCount = 0;
  for (const token of originalTokens) {
    if (candidateTokens.has(token)) intersectionCount += 1;
  }
  return intersectionCount / originalTokens.size;
}

/**
 * Inputs to isSameJob. Titles + descriptions of the original (Indeed/LinkedIn-
 * scraped) listing and the candidate page found via web search.
 */
export interface JobMatchInput {
  originalTitle: string;
  originalDescription: string;
  candidateTitle: string;
  candidateDescription: string;
}

/**
 * Verdict + human-readable reason for a single match attempt. The resolver
 * captures this on every inspected candidate so the UI can render
 * "rejected: title mismatch" / "rejected: description overlap 23% < 40%"
 * rather than just a boolean.
 */
export interface JobMatchVerdict {
  matched: boolean;
  reason: string;
}

/**
 * Returns the verdict (matched + a reason) for whether the candidate page is
 * the same job as the original. Wraps the underlying title-equality and
 * description-overlap checks and produces a single string the resolver trace
 * can persist verbatim.
 *
 * The verdict is the source of truth — `isSameJob` is a thin boolean wrapper
 * around it for callers that only care about pass/fail.
 *
 * @param {JobMatchInput} input - The four strings to compare
 * @returns {JobMatchVerdict} matched + reason
 */
export function evaluateJobMatch(input: JobMatchInput): JobMatchVerdict {
  const normalizedOriginal = normalizeForMatch(input.originalTitle);
  const normalizedCandidate = normalizeForMatch(input.candidateTitle);
  const isEmptyOriginal = normalizedOriginal.length === 0;
  if (isEmptyOriginal) {
    return { matched: false, reason: "original title is empty after normalization" };
  }
  const isEmptyCandidate = normalizedCandidate.length === 0;
  if (isEmptyCandidate) {
    return { matched: false, reason: "candidate title is empty after normalization" };
  }

  // Title containment ("in") rather than exact equality. Candidate pages often
  // title a role slightly differently than the source listing — e.g. a
  // "Full Stack Engineer - Senior" posting whose company careers page just says
  // "Full Stack Engineer". We accept the pair when one normalized title appears
  // as a whole-word phrase inside the other. Space-padding both sides enforces
  // word boundaries so "engineer" doesn't spuriously match "engineering".
  const paddedOriginal = ` ${normalizedOriginal} `;
  const paddedCandidate = ` ${normalizedCandidate} `;
  const isTitleMatch =
    paddedCandidate.includes(paddedOriginal) || paddedOriginal.includes(paddedCandidate);
  if (!isTitleMatch) {
    return {
      matched: false,
      reason: `title mismatch (original="${input.originalTitle.trim()}", candidate="${input.candidateTitle.trim()}")`,
    };
  }

  const originalTokens = tokenizeDescription(input.originalDescription);
  const candidateTokens = tokenizeDescription(input.candidateDescription);
  // When the original listing has no usable description — e.g. it came from a
  // gated source like LinkedIn/Indeed that we couldn't scrape — there's nothing
  // to compare against, so the overlap would always be 0% and reject every
  // candidate. Fall back to the (already-passed) title match alone.
  const hasOriginalDescriptionTokens = originalTokens.size > 0;
  if (!hasOriginalDescriptionTokens) {
    return {
      matched: true,
      reason: "title matched; original description unavailable, so the description-overlap check was skipped",
    };
  }
  const overlap = computeOverlapRatio(originalTokens, candidateTokens);
  const overlapPercent = Math.round(overlap * 100);
  const thresholdPercent = Math.round(MIN_DESCRIPTION_TOKEN_OVERLAP_RATIO * 100);
  const isOverlapBelowThreshold = overlap < MIN_DESCRIPTION_TOKEN_OVERLAP_RATIO;
  if (isOverlapBelowThreshold) {
    return {
      matched: false,
      reason: `description token overlap ${String(overlapPercent)}% below ${String(thresholdPercent)}% threshold`,
    };
  }

  return {
    matched: true,
    reason: `title matched and description overlap ${String(overlapPercent)}% >= ${String(thresholdPercent)}%`,
  };
}

/**
 * Boolean shorthand for {@link evaluateJobMatch}: returns true when the
 * verdict's `matched` is true. Kept for call sites that don't need the reason.
 * @param {JobMatchInput} input - The four strings to compare
 * @returns {boolean} The verdict's matched flag
 */
export function isSameJob(input: JobMatchInput): boolean {
  return evaluateJobMatch(input).matched;
}

export { MIN_DESCRIPTION_TOKEN_OVERLAP_RATIO };
