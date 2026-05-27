/**
 * Small helper that owns the company/title normalization used by the
 * inbox-discovery feature's duplicate detection. Lives in its own file so
 * the normalize function is unit-testable in isolation and so the discovery
 * service doesn't grow a normalization concern that's reused elsewhere.
 *
 * The normalization is intentionally simple — trim, collapse internal
 * whitespace, lowercase — because the user explicitly decided NOT to strip
 * seniority qualifiers ("Sr." vs "Senior") in v1 (false-positive merge risk).
 */

import type { JobListing } from "../../prisma/generated/client/client.js";
import prisma from "../prismaClient.js";

/**
 * Normalizes a string for case-insensitive, whitespace-tolerant comparison.
 * Used by findExistingJobListingByCompanyTitle to compare the discovered
 * (company, title, location) against the persisted JobListing.
 *
 * Accepts null/undefined and whitespace-only inputs — all coerce to the empty
 * string. This makes the function safe to call on optional fields like
 * `location` without the caller having to special-case null.
 *
 * @param {string | null | undefined} value - The raw string to normalize (typically a company, job title, or location). Null/undefined coerce to empty string.
 * @returns {string} `(value ?? "").trim().replace(/\s+/g, " ").toLowerCase()`
 */
export function normalizeForMatch(value: string | null | undefined): string {
  const safeValue = value ?? "";
  const trimmedValue = safeValue.trim();
  const whitespaceCollapsedValue = trimmedValue.replace(/\s+/g, " ");
  const lowercasedValue = whitespaceCollapsedValue.toLowerCase();
  return lowercasedValue;
}

/**
 * Looks for an existing JobListing whose normalized (company, title, location)
 * matches the given values. Loads all rows where `company !== null` and
 * `company !== ""` and compares in application code — SQLite + Prisma can't
 * express a function-based predicate on (LOWER(company), LOWER(title)) directly,
 * and the JobListing table is sub-1000-rows in scale.
 *
 * Returns null when no match is found OR when the input `company` is empty
 * (an empty company is "unknown" by convention — see jobListingCompanyBackfill).
 *
 * Location matching follows an "either-side-null is wildcard" rule:
 *   - Both sides normalize via `normalizeForMatch` (null/whitespace-only → "").
 *   - If EITHER side normalizes to "", location is ignored and the match
 *     succeeds on (company, title) alone.
 *   - If BOTH sides have non-empty normalized values, they must be exactly
 *     equal after normalization.
 *
 * This wildcard semantic means a caller passing `location: "Remote"` will still
 * match a stored row with `location = null`, and vice-versa; only two distinct
 * concrete locations cause a non-match.
 *
 * @param {string} company - The candidate company name (raw, will be normalized)
 * @param {string} title - The candidate job title (raw, will be normalized)
 * @param {string | null} location - The candidate location (raw or null; null/whitespace acts as wildcard)
 * @returns {Promise<JobListing | null>} The first matching JobListing, or null when no match
 */
export async function findExistingJobListingByCompanyTitle(
  company: string,
  title: string,
  location: string | null
): Promise<JobListing | null> {
  const normalizedCompany = normalizeForMatch(company);
  const companyIsEmpty = normalizedCompany.length === 0;
  if (companyIsEmpty) {
    return null;
  }

  const normalizedTitle = normalizeForMatch(title);
  const normalizedCallSideLocation = normalizeForMatch(location);
  const callSideLocationIsWildcard = normalizedCallSideLocation.length === 0;

  // Pull every JobListing with a non-null, non-empty company column.
  // The table is sub-1000-rows so the in-memory filter is acceptable, and
  // SQLite/Prisma cannot express a function-based predicate on
  // (LOWER(company), LOWER(title)) directly.
  const candidateRows = await prisma.jobListing.findMany({
    where: {
      company: { not: null },
      NOT: { company: "" },
    },
  });

  for (const candidateRow of candidateRows) {
    const candidateCompany = candidateRow.company ?? "";
    const candidateTitle = candidateRow.title ?? "";
    const candidateHasEmptyCompany = candidateCompany.length === 0;
    if (candidateHasEmptyCompany) {
      // Defensive: even though the query filtered out empty companies,
      // empty/null titles still need to be skipped from the "unknown" bucket.
      continue;
    }
    const companyMatches = normalizeForMatch(candidateCompany) === normalizedCompany;
    const titleMatches = normalizeForMatch(candidateTitle) === normalizedTitle;
    if (!companyMatches || !titleMatches) {
      continue;
    }

    // Location matching: either-side-null is treated as a wildcard. We only
    // require equality when BOTH the call-side and candidate-side have
    // non-empty normalized locations.
    const normalizedCandidateLocation = normalizeForMatch(candidateRow.location);
    const candidateLocationIsWildcard = normalizedCandidateLocation.length === 0;
    const eitherSideIsWildcard = callSideLocationIsWildcard || candidateLocationIsWildcard;
    const bothSidesHaveLocation = !eitherSideIsWildcard;
    const locationsMatchExactly = normalizedCandidateLocation === normalizedCallSideLocation;
    const locationMatches = eitherSideIsWildcard || (bothSidesHaveLocation && locationsMatchExactly);

    if (locationMatches) {
      return candidateRow;
    }
  }

  return null;
}
