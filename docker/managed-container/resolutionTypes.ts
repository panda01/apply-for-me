/**
 * Mirror of the server-side resolver enums in
 * server/src/services/applicationUrlResolverService.ts — that file is the
 * source of truth. This file exists because the container is a separate
 * TypeScript package (no shared workspace) and we want strict enum types on
 * the in-memory progress map below. Keep the string values byte-identical so
 * the wire format round-trips cleanly between server and container.
 */

/**
 * The distinct phases the resolver walks through. Used as the `phase` field
 * on each LiveStep stored in the in-container progress map.
 */
export enum ResolutionPhase {
  DirectCheck = "direct_check",
  AcquireContainer = "acquire_container",
  ApplyButtonScrape = "apply_button_scrape",
  ApplyButtonDecision = "apply_button_decision",
  BuildQuery = "build_query",
  BraveSearch = "brave_search",
  CandidateScrape = "candidate_scrape",
  CandidateEvaluate = "candidate_evaluate",
  Finalize = "finalize",
}

/**
 * Status of a single step. "running" is emitted when a phase begins; the
 * same step index is then settled with one of the three terminal values.
 */
export enum StepStatus {
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Skipped = "skipped",
}

/**
 * Terminal outcomes of a resolver attempt. Mirrors the Prisma enum
 * ApplicationUrlResolutionOutcome on the server.
 */
export enum ApplicationUrlResolutionOutcome {
  Direct = "direct",
  ResolvedViaRedirect = "resolved_via_redirect",
  ResolvedViaSearch = "resolved_via_search",
  NotFound = "not_found",
}

/**
 * Returns true when the given string is one of the ResolutionPhase enum
 * values. Used by HTTP handlers to validate inbound JSON before storing.
 *
 * @param {unknown} value - The candidate value to test
 * @returns {boolean} True when the value is a ResolutionPhase string
 */
export function isResolutionPhase(value: unknown): value is ResolutionPhase {
  if (typeof value !== "string") return false;
  return Object.values(ResolutionPhase).includes(value as ResolutionPhase);
}

/**
 * Returns true when the given string is one of the StepStatus enum values.
 *
 * @param {unknown} value - The candidate value to test
 * @returns {boolean} True when the value is a StepStatus string
 */
export function isStepStatus(value: unknown): value is StepStatus {
  if (typeof value !== "string") return false;
  return Object.values(StepStatus).includes(value as StepStatus);
}

/**
 * Returns true when the given string is one of the
 * ApplicationUrlResolutionOutcome enum values.
 *
 * @param {unknown} value - The candidate value to test
 * @returns {boolean} True when the value is an ApplicationUrlResolutionOutcome string
 */
export function isApplicationUrlResolutionOutcome(value: unknown): value is ApplicationUrlResolutionOutcome {
  if (typeof value !== "string") return false;
  return Object.values(ApplicationUrlResolutionOutcome).includes(value as ApplicationUrlResolutionOutcome);
}
