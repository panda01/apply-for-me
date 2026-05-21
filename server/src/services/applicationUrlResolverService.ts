/**
 * Service module that resolves the off-platform application URL for a job
 * listing. Job listings sourced from Indeed/LinkedIn frequently require the
 * applicant to log in or use the host's apply flow; this resolver finds the
 * "real" company-side application form so the auto-apply flow downstream has
 * something it can fill out without a login wall.
 *
 * Algorithm:
 *
 *   1. If the originalUrl's host is NOT linkedin.com / indeed.com → it's
 *      already a direct apply page; outcome = "direct", application_url =
 *      originalUrl. No proxy or search call is made.
 *
 *   2. Inspect the apply button on the original page via the smart proxy
 *      scraper. If it points to a host that's NEITHER linkedin/indeed →
 *      outcome = "resolved_via_redirect", application_url = the apply
 *      button URL.
 *
 *   3. Otherwise, web-search for "{company} {title}". Every non-gated Brave
 *      result is sent to {@link classifyPages}, which labels each as either
 *      direct_job_listing, careers_page, or irrelevant. Two ordered sweeps
 *      follow, both gated by the existing jobMatchService:
 *
 *        a. Fuzzy-rank the direct_job_listing subset by snippet vs target
 *           title, then iterate scrape + evaluate. First match wins →
 *           outcome = "resolved_via_search".
 *        b. If none match, fuzzy-rank the careers_page subset, drill into
 *           each via careersPageHarvesterService (extract anchors,
 *           fuzzy-match to target title, keep top-K on-domain hrefs), then
 *           iterate scrape + evaluate on those hrefs. First match →
 *           outcome = "resolved_via_careers_page".
 *
 *      The total number of scrape+evaluate operations across both sweeps is
 *      capped by MAX_SEARCH_CANDIDATES_TO_INSPECT so worst-case latency
 *      remains bounded.
 *
 *   4. If no candidate matches → outcome = "not_found", application_url =
 *      null. The caller flips the JobListing's status to "missing_form_url"
 *      so the UI surfaces the failure and offers a retry button.
 *
 * Every invocation also returns a `trace` describing the search query, the
 * Brave results, and the per-candidate verdicts. The caller persists this in
 * application_url_resolution_logs so the UI can render a "what did the
 * resolver actually do?" panel — particularly useful when the outcome is
 * not_found.
 */

import { searchWeb, type BraveSearchResult } from "./braveSearchService.js";
import { evaluateJobMatch } from "./jobMatchService.js";
import { scrapeJobViaContainer, findFirstRunningContainer } from "./smartProxyScraperService.js";
import {
  classifyPages,
  PageClassifierProtocolError,
  type BraveCandidateInput,
  type ClassifiedCandidate,
} from "./aiPageClassifierService.js";
import { rankByFuzzyScore } from "./fuzzyMatchService.js";
import { harvestCareersPage } from "./careersPageHarvesterService.js";

/**
 * Identifies each distinct phase the resolver runs through. The string values
 * are the wire format the server pushes to the container's progress map and
 * that the frontend renders in the live trace timeline. Container and client
 * keep an identical mirror of this enum (see
 * docker/managed-container/resolutionTypes.ts and
 * client/src/services/jobListingsApi.ts) — this file is the source of truth.
 */
export enum ResolutionPhase {
  DirectCheck = "direct_check",
  AcquireContainer = "acquire_container",
  ApplyButtonScrape = "apply_button_scrape",
  ApplyButtonDecision = "apply_button_decision",
  BuildQuery = "build_query",
  BraveSearch = "brave_search",
  /** AI classifies each non-gated Brave result as direct_job_listing / careers_page / irrelevant. One Anthropic call per resolver attempt. */
  AIPageClassify = "ai_page_classify",
  /** Code-side fuzzy ranking (no threshold) of the direct_job_listing subset by snippet-vs-target-title. Determines scrape order. */
  FuzzyRankDirectListings = "fuzzy_rank_direct_listings",
  /** Code-side fuzzy ranking (no threshold) of the careers_page subset by snippet-vs-target-title. Determines harvest order. */
  FuzzyRankCareersPages = "fuzzy_rank_careers_pages",
  /** Drill into a single classified careers page: extract <a> tags via the container, fuzzy-match against the target title, keep top-K hrefs. */
  CareersPageHarvest = "careers_page_harvest",
  CandidateScrape = "candidate_scrape",
  CandidateEvaluate = "candidate_evaluate",
  Finalize = "finalize",
}

/**
 * Per-step status. "running" is emitted when a phase begins; the same step
 * index is then settled with one of the three terminal values. Mirrored in
 * the container and client.
 */
export enum StepStatus {
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Skipped = "skipped",
}

/**
 * Hosts whose URLs the resolver treats as "behind a login wall" / "needs to
 * be redirected off-platform". Matched against the URL's hostname using both
 * exact equality and a trailing-suffix match (so www.linkedin.com and
 * uk.indeed.com still trip).
 */
const GATED_HOSTS = ["linkedin.com", "indeed.com"];

/**
 * Maximum number of search candidates the resolver will smart-proxy-scrape
 * before giving up. Each candidate costs an /analyze call (several seconds
 * + an LLM round-trip + possibly Smartproxy fees), so the cap keeps total
 * latency bounded. Applied across BOTH the direct-listing sweep and any
 * careers-page-harvested href sweep — once N total candidates have been
 * scraped (matched or not), the resolver stops.
 */
const MAX_SEARCH_CANDIDATES_TO_INSPECT = 5;

/**
 * Maximum number of careers pages the resolver will drill into during the
 * Step 7 careers-page sweep. Each careers page costs one /extract-links
 * navigation; this cap prevents a long classified-careers-page list from
 * blowing up resolver latency. Per-page hrefs are independently capped by
 * the harvester's FUZZY_MATCH_TOP_K.
 */
const MAX_CAREERS_PAGES_TO_HARVEST = 3;

/**
 * Discriminated union representing the five resolver outcomes. Callers use
 * this to decide whether to update the JobListing's status (only on
 * "not_found") or just write application_url (on the four success cases).
 */
export type ResolverOutcome =
  | { outcome: "direct"; applicationUrl: string }
  | { outcome: "resolved_via_redirect"; applicationUrl: string }
  | { outcome: "resolved_via_search"; applicationUrl: string }
  | { outcome: "resolved_via_careers_page"; applicationUrl: string }
  | { outcome: "not_found"; reason: string };

/**
 * A single candidate the resolver actually fetched via the smart proxy and
 * compared against the original. Persisted as part of the resolution log so
 * the UI can render per-candidate verdicts.
 */
export interface InspectedCandidate {
  url: string;
  scrapedTitle: string;
  matched: boolean;
  rejectionReason: string;
}

/**
 * Per-attempt trace describing exactly what the resolver looked at and why
 * it landed where it did. Every field is populated when the relevant step
 * actually ran; steps that were skipped (e.g. search on a "direct" outcome)
 * leave their fields null/empty.
 */
export interface ResolutionTrace {
  /** The apply-button URL the resolver considered for case 2; null when no apply button was found, or for the "direct" outcome which skips the check. */
  applyButtonUrlConsidered: string | null;
  /** The Brave query that ran for case 3; null when search was skipped. */
  searchQuery: string | null;
  /** Every Brave result returned for the searchQuery; empty when search didn't run. */
  braveResults: BraveSearchResult[];
  /** Each candidate the resolver actually scraped, in inspection order. */
  inspectedCandidates: InspectedCandidate[];
}

/**
 * Inputs the resolver needs to do its work. originalUrl is the URL the user
 * submitted on the add-job form; title/description/company come from the
 * smart proxy's scrape of that URL (so we can match candidates against the
 * authoritative content, not whatever the LLM-summarized variant of it).
 *
 * originalApplyButtonUrl is optional: when the caller already has it from
 * the same scrape that produced title/description (the initial-fetch case),
 * passing it in saves the resolver an extra smart-proxy round-trip. When
 * omitted (e.g. the manual retry route, which only has the persisted DB
 * fields), the resolver re-scrapes the original URL to obtain it.
 *
 * progressReporter is optional: when supplied, the resolver emits
 * startStep/endStep/finalize callbacks so a caller (typically the route layer
 * pushing into the container's progress map) can render a live trace. When
 * omitted (programmatic / test callers), behavior is unchanged.
 */
export interface ResolverInput {
  originalUrl: string;
  originalTitle: string;
  originalDescription: string;
  originalCompany: string;
  originalApplyButtonUrl?: string | null;
  progressReporter?: ResolverProgressReporter;
}

/**
 * Outcome string written into the live progress finalize call. Identical to
 * the discriminated-union outcome key, but extracted as its own alias so the
 * reporter API doesn't need to depend on the full ResolverOutcome shape.
 */
export type ResolverOutcomeKey = ResolverOutcome["outcome"];

/**
 * Callback the resolver invokes at every phase transition. startStep returns
 * a monotonic step index the caller threads back through endStep so the
 * trace timeline can correlate the start and end events.
 *
 * Implementations are expected to be best-effort: a failed progress push
 * MUST NOT abort the resolution. The createContainerProgressReporter helper
 * swallows network errors via console.warn for exactly this reason.
 */
export interface ResolverProgressReporter {
  /**
   * Announce that a new phase has begun. The returned step index identifies
   * this entry for the matching endStep call.
   * @param {ResolutionPhase} phase - The enum identifying which phase is starting
   * @param {string} message - Human-readable summary shown in the timeline
   * @param {Record<string, unknown>} [payload] - Optional structured detail (e.g., query, URL)
   * @returns {Promise<number>} The monotonic step index assigned to this entry
   */
  startStep(phase: ResolutionPhase, message: string, payload?: Record<string, unknown>): Promise<number>;
  /**
   * Settle a previously-started step with a terminal status and any
   * additional payload (e.g., result counts, timing details).
   * @param {number} stepIndex - The index returned by the matching startStep call
   * @param {StepStatus} status - Terminal status (succeeded / failed / skipped)
   * @param {string} [message] - Optional updated human-readable summary
   * @param {Record<string, unknown>} [payload] - Optional structured detail merged with the start payload
   * @returns {Promise<void>}
   */
  endStep(stepIndex: number, status: StepStatus, message?: string, payload?: Record<string, unknown>): Promise<void>;
  /**
   * Mark the whole attempt as finished. Called exactly once per resolver run.
   * @param {ResolverOutcomeKey} outcome - The terminal outcome key the resolver landed on
   * @param {string | null} applicationUrl - The resolved URL on the three success outcomes; null on not_found
   * @param {string | null} reason - Free-text reason; populated on not_found
   * @returns {Promise<void>}
   */
  finalize(outcome: ResolverOutcomeKey, applicationUrl: string | null, reason: string | null): Promise<void>;
}

/**
 * The full result of a resolver invocation: the classified outcome plus the
 * trace that produced it. Callers persist the trace in the resolution-log
 * table and act on the outcome (DB updates + UI status).
 */
export interface ResolveApplicationUrlResult {
  outcome: ResolverOutcome;
  trace: ResolutionTrace;
}

/**
 * Returns true when the given hostname is one of the GATED_HOSTS or one of
 * their subdomains. Used to decide whether a URL is "on a gated platform"
 * (in which case the resolver should not adopt it as the application URL).
 *
 * @param {string} hostname - The lowercase hostname to test
 * @returns {boolean} True when the host is gated
 */
export function isGatedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  for (const gated of GATED_HOSTS) {
    if (lower === gated || lower.endsWith(`.${gated}`)) return true;
  }
  return false;
}

/**
 * Safely parses a URL and returns its lowercase hostname, or null if the URL
 * is malformed. The resolver and downstream services should never throw on
 * a bad URL — they should just classify it as "not eligible".
 *
 * @param {string} rawUrl - A URL that may or may not be valid
 * @returns {string | null} The lowercase hostname, or null
 */
export function tryGetHostname(rawUrl: string): string | null {
  if (!URL.canParse(rawUrl)) return null;
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Builds the Brave Search query for a given job. Plain "company role" works
 * well in practice — adding "careers" or "apply" biases too aggressively and
 * misses pages that just describe the role.
 *
 * @param {string} company - The hiring company's name
 * @param {string} title - The job title
 * @returns {string} The query string
 */
export function buildSearchQuery(company: string, title: string): string {
  return `${company.trim()} ${title.trim()}`.replace(/\s+/g, " ").trim();
}

/**
 * Returns the apply_button_url already extracted from the original-URL
 * scrape, but only when it's an absolute http(s) URL pointing at a non-gated
 * host. Returns null otherwise so the resolver knows to fall back to web
 * search.
 *
 * @param {string | null} applyButtonUrl - The apply button URL from the original scrape, or null
 * @returns {string | null} The accepted off-platform URL, or null
 */
function pickOffPlatformApplyButton(applyButtonUrl: string | null): string | null {
  if (applyButtonUrl === null) return null;
  const host = tryGetHostname(applyButtonUrl);
  if (host === null) return null;
  if (isGatedHost(host)) return null;
  return applyButtonUrl;
}

/**
 * Builds an empty trace the resolver mutates as it progresses. Keeping this
 * as a helper means every callsite returns a fully-populated shape even on
 * the very-early-exit paths (malformed URL, no container available).
 *
 * @returns {ResolutionTrace} A fresh trace with all collection fields empty
 */
function emptyTrace(): ResolutionTrace {
  return {
    applyButtonUrlConsidered: null,
    searchQuery: null,
    braveResults: [],
    inspectedCandidates: [],
  };
}

/**
 * Resolves the application_url for a job listing using the algorithm in the
 * module docstring. Picks the first running managed container automatically;
 * fails with a clear error if none exists so the route layer can map that
 * to a 503-style response and tell the user to spawn one.
 *
 * When `input.progressReporter` is supplied, every phase emits a
 * startStep/endStep pair plus a final finalize() so callers can render a live
 * trace timeline. The reporter is invoked best-effort — a thrown error from
 * inside it is caught and logged so a flaky progress sink can never abort
 * the resolution itself.
 *
 * @param {ResolverInput} input - The original URL + scraped title/description/company plus an optional progressReporter
 * @returns {Promise<ResolveApplicationUrlResult>} The classified outcome and the trace that produced it
 */
export async function resolveApplicationUrl(input: ResolverInput): Promise<ResolveApplicationUrlResult> {
  const trace = emptyTrace();
  const reporter = input.progressReporter;

  // Phase: DirectCheck — also handles the "original URL malformed" branch since
  // that's the same act of inspecting the URL hostname.
  const directCheckStepIndex = await safeStartStep(reporter, ResolutionPhase.DirectCheck, "Classifying original URL hostname", { originalUrl: input.originalUrl });
  const originalHostname = tryGetHostname(input.originalUrl);
  const isOriginalMalformed = originalHostname === null;
  if (isOriginalMalformed) {
    console.warn(`[resolver] original URL is malformed: ${input.originalUrl}`);
    await safeEndStep(reporter, directCheckStepIndex, StepStatus.Failed, "Original URL is malformed", { originalUrl: input.originalUrl });
    const reason = `Original URL is malformed: ${input.originalUrl}`;
    await safeFinalize(reporter, "not_found", null, reason);
    return { outcome: { outcome: "not_found", reason }, trace };
  }

  const isOriginalGated = isGatedHost(originalHostname);
  if (!isOriginalGated) {
    console.log(`[resolver] outcome=direct host=${originalHostname} url=${input.originalUrl}`);
    await safeEndStep(reporter, directCheckStepIndex, StepStatus.Succeeded, `Host "${originalHostname}" is already off-platform; adopting directly`, { hostname: originalHostname, isGated: false });
    await safeFinalize(reporter, "direct", input.originalUrl, null);
    return { outcome: { outcome: "direct", applicationUrl: input.originalUrl }, trace };
  }
  await safeEndStep(reporter, directCheckStepIndex, StepStatus.Succeeded, `Host "${originalHostname}" is gated; continuing to apply-button + search`, { hostname: originalHostname, isGated: true });

  // Phase: AcquireContainer — needed for the apply-button re-scrape (when no
  // hint was supplied) and for each search candidate.
  const acquireContainerStepIndex = await safeStartStep(reporter, ResolutionPhase.AcquireContainer, "Finding a running managed container", {});
  const container = await findFirstRunningContainer();
  if (container === null) {
    console.warn("[resolver] no running managed container available");
    await safeEndStep(reporter, acquireContainerStepIndex, StepStatus.Failed, "No running managed container available", {});
    const reason = "No running managed container available. Spawn one on the Containers page and retry.";
    await safeFinalize(reporter, "not_found", null, reason);
    return { outcome: { outcome: "not_found", reason }, trace };
  }
  await safeEndStep(reporter, acquireContainerStepIndex, StepStatus.Succeeded, `Selected container id=${String(container.id)} on host port ${String(container.hostPort)}`, { containerId: container.id, hostPort: container.hostPort });

  // Phase: ApplyButtonScrape — skipped when caller already supplied the hint
  // (initial fetch path). The retry path always re-scrapes because it only
  // has the persisted DB fields available. A re-scrape failure is recoverable
  // (Brave search may still find the right page) so we log + continue.
  let applyButtonUrlForDecision: string | null;
  const wasApplyButtonProvided = input.originalApplyButtonUrl !== undefined;
  const applyButtonScrapeStepIndex = await safeStartStep(reporter, ResolutionPhase.ApplyButtonScrape, wasApplyButtonProvided ? "Using caller-supplied apply button URL" : "Re-scraping original URL for apply button", { wasApplyButtonProvided, originalUrl: input.originalUrl });
  if (wasApplyButtonProvided) {
    applyButtonUrlForDecision = input.originalApplyButtonUrl ?? null;
    await safeEndStep(reporter, applyButtonScrapeStepIndex, StepStatus.Skipped, `Apply button URL pre-supplied: ${applyButtonUrlForDecision ?? "(none)"}`, { applyButtonUrl: applyButtonUrlForDecision });
  } else {
    const scrapeStartedAt = Date.now();
    try {
      const originalScrape = await scrapeJobViaContainer(container.hostPort, input.originalUrl);
      applyButtonUrlForDecision = originalScrape.apply_button_url;
      await safeEndStep(reporter, applyButtonScrapeStepIndex, StepStatus.Succeeded, `Scrape returned apply button URL: ${applyButtonUrlForDecision ?? "(none)"}`, { applyButtonUrl: applyButtonUrlForDecision, durationMs: Date.now() - scrapeStartedAt });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[resolver] apply-button re-scrape failed; continuing to search: ${errorMessage}`);
      applyButtonUrlForDecision = null;
      await safeEndStep(reporter, applyButtonScrapeStepIndex, StepStatus.Failed, `Apply button re-scrape failed; falling through to search: ${errorMessage}`, { error: errorMessage, durationMs: Date.now() - scrapeStartedAt });
    }
  }
  trace.applyButtonUrlConsidered = applyButtonUrlForDecision;
  console.log(`[resolver] applyButtonUrl=${applyButtonUrlForDecision ?? "(none)"}`);

  // Phase: ApplyButtonDecision — verdict on the apply-button URL.
  const applyButtonDecisionStepIndex = await safeStartStep(reporter, ResolutionPhase.ApplyButtonDecision, "Evaluating apply button URL for off-platform redirect", { applyButtonUrl: applyButtonUrlForDecision });
  const offPlatformApplyUrl = pickOffPlatformApplyButton(applyButtonUrlForDecision);
  if (offPlatformApplyUrl !== null) {
    console.log(`[resolver] outcome=resolved_via_redirect application_url=${offPlatformApplyUrl}`);
    await safeEndStep(reporter, applyButtonDecisionStepIndex, StepStatus.Succeeded, `Adopting off-platform apply button URL: ${offPlatformApplyUrl}`, { accepted: true, applicationUrl: offPlatformApplyUrl });
    await safeFinalize(reporter, "resolved_via_redirect", offPlatformApplyUrl, null);
    return { outcome: { outcome: "resolved_via_redirect", applicationUrl: offPlatformApplyUrl }, trace };
  }
  await safeEndStep(reporter, applyButtonDecisionStepIndex, StepStatus.Skipped, "Apply button URL is missing or gated; continuing to web search", { accepted: false });

  // Phase: BuildQuery — produce "{company} {title}". An empty query is fatal.
  const buildQueryStepIndex = await safeStartStep(reporter, ResolutionPhase.BuildQuery, "Building Brave search query", { company: input.originalCompany, title: input.originalTitle });
  const query = buildSearchQuery(input.originalCompany, input.originalTitle);
  const isQueryUnusable = query.length === 0;
  if (isQueryUnusable) {
    console.warn("[resolver] cannot search: company + title both empty after trim");
    await safeEndStep(reporter, buildQueryStepIndex, StepStatus.Failed, "Company and title both empty after trim; cannot search", { query });
    const reason = "Cannot search the web: scraped company name and title are both empty.";
    await safeFinalize(reporter, "not_found", null, reason);
    return { outcome: { outcome: "not_found", reason }, trace };
  }
  trace.searchQuery = query;
  await safeEndStep(reporter, buildQueryStepIndex, StepStatus.Succeeded, `Query: "${query}"`, { query });
  console.log(`[resolver] searching brave query="${query}"`);

  // Phase: BraveSearch — single HTTP call. Failures are fatal for this attempt.
  const braveSearchStepIndex = await safeStartStep(reporter, ResolutionPhase.BraveSearch, `Calling Brave Search for "${query}"`, { query });
  const braveStartedAt = Date.now();
  try {
    trace.braveResults = await searchWeb(query);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[resolver] brave search failed: ${errorMessage}`);
    await safeEndStep(reporter, braveSearchStepIndex, StepStatus.Failed, `Brave Search failed: ${errorMessage}`, { error: errorMessage, durationMs: Date.now() - braveStartedAt });
    const reason = `Web search failed: ${errorMessage}`;
    await safeFinalize(reporter, "not_found", null, reason);
    return { outcome: { outcome: "not_found", reason }, trace };
  }
  console.log(`[resolver] brave returned=${String(trace.braveResults.length)} result(s)`);
  await safeEndStep(reporter, braveSearchStepIndex, StepStatus.Succeeded, `Brave returned ${String(trace.braveResults.length)} result(s)`, { resultCount: trace.braveResults.length, results: trace.braveResults, durationMs: Date.now() - braveStartedAt });

  // Pre-filter Brave results: drop malformed URLs and gated hosts (linkedin/
  // indeed) before classification so we don't burn LLM tokens on candidates
  // the resolver can never adopt anyway.
  const eligibleBraveResults: BraveSearchResult[] = trace.braveResults.filter((result) => {
    const host = tryGetHostname(result.url);
    if (host === null) return false;
    if (isGatedHost(host)) return false;
    return true;
  });

  // Phase: AIPageClassify — one Anthropic call labels each eligible Brave
  // result as direct_job_listing / careers_page / irrelevant. Empty result
  // set short-circuits the call (no point spending tokens to learn that an
  // empty list classifies to an empty list).
  const aiClassifyStepIndex = await safeStartStep(reporter, ResolutionPhase.AIPageClassify, `Classifying ${String(eligibleBraveResults.length)} eligible Brave result(s)`, { eligibleCount: eligibleBraveResults.length });
  let classifications: ClassifiedCandidate[] = [];
  if (eligibleBraveResults.length === 0) {
    await safeEndStep(reporter, aiClassifyStepIndex, StepStatus.Skipped, "No eligible Brave results to classify", { eligibleCount: 0 });
  } else {
    const classifyStartedAt = Date.now();
    const candidatesForClassifier: BraveCandidateInput[] = eligibleBraveResults.map((result, index) => ({
      index,
      title: result.title,
      snippet: result.description,
      url: result.url,
    }));
    try {
      const classifierResult = await classifyPages({
        targetTitle: input.originalTitle,
        targetCompany: input.originalCompany,
        targetDescription: input.originalDescription,
        candidates: candidatesForClassifier,
      });
      classifications = classifierResult.classifications;
      await safeEndStep(reporter, aiClassifyStepIndex, StepStatus.Succeeded, `Classified ${String(classifications.length)} result(s)`, { classifications, durationMs: Date.now() - classifyStartedAt });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isProtocolError = err instanceof PageClassifierProtocolError;
      console.warn(`[resolver] AI page classifier failed (${isProtocolError ? "protocol" : "transport"}): ${errorMessage}`);
      await safeEndStep(reporter, aiClassifyStepIndex, StepStatus.Failed, `AI page classifier failed: ${errorMessage}`, { error: errorMessage, isProtocolError, durationMs: Date.now() - classifyStartedAt });
      const reason = `AI page classifier failed: ${errorMessage}`;
      await safeFinalize(reporter, "not_found", null, reason);
      return { outcome: { outcome: "not_found", reason }, trace };
    }
  }

  // Bucket the eligible results by classification. Drops "irrelevant"
  // entries entirely (the LLM has told us they are not worth inspecting).
  const directListings: BraveSearchResult[] = [];
  const careersPages: BraveSearchResult[] = [];
  for (const entry of classifications) {
    const matchingResult = eligibleBraveResults[entry.index];
    if (matchingResult === undefined) continue;
    if (entry.classification === "direct_job_listing") directListings.push(matchingResult);
    else if (entry.classification === "careers_page") careersPages.push(matchingResult);
  }

  // Track URLs already scraped this attempt so a careers-page-harvested href
  // that duplicates a direct-listing URL doesn't burn a second /analyze call.
  const inspectedUrls = new Set<string>();

  // Phase: FuzzyRankDirectListings — code-side ranking of the
  // direct_job_listing subset by snippet vs target title. No threshold; the
  // existing jobMatchService is still the accept/reject gate.
  const rankDirectStepIndex = await safeStartStep(reporter, ResolutionPhase.FuzzyRankDirectListings, `Fuzzy-ranking ${String(directListings.length)} direct-listing candidate(s)`, { count: directListings.length });
  const rankedDirect = rankByFuzzyScore(
    directListings,
    (result) => result.description,
    input.originalTitle,
    (result) => result.url
  );
  await safeEndStep(reporter, rankDirectStepIndex, StepStatus.Succeeded, `Ranked ${String(rankedDirect.length)} direct-listing candidate(s)`, { ranked: rankedDirect.map(({ item, score }) => ({ url: item.url, score })) });

  // Phases: CandidateScrape + CandidateEvaluate — iterate ranked direct
  // listings best-first. First match wins.
  for (const { item: candidate } of rankedDirect) {
    if (trace.inspectedCandidates.length >= MAX_SEARCH_CANDIDATES_TO_INSPECT) break;
    if (inspectedUrls.has(candidate.url)) continue;
    inspectedUrls.add(candidate.url);

    const directMatch = await tryScrapeAndEvaluateCandidate({
      reporter,
      container,
      input,
      trace,
      candidateUrl: candidate.url,
      candidateLabel: "direct-listing",
    });
    if (directMatch !== null) {
      await safeFinalize(reporter, "resolved_via_search", directMatch, null);
      return { outcome: { outcome: "resolved_via_search", applicationUrl: directMatch }, trace };
    }
  }

  // Phase: FuzzyRankCareersPages — code-side ranking of the careers_page
  // subset by snippet vs target title. Determines harvest order.
  const rankCareersStepIndex = await safeStartStep(reporter, ResolutionPhase.FuzzyRankCareersPages, `Fuzzy-ranking ${String(careersPages.length)} careers-page candidate(s)`, { count: careersPages.length });
  const rankedCareers = rankByFuzzyScore(
    careersPages,
    (result) => result.description,
    input.originalTitle,
    (result) => result.url
  );
  await safeEndStep(reporter, rankCareersStepIndex, StepStatus.Succeeded, `Ranked ${String(rankedCareers.length)} careers-page candidate(s)`, { ranked: rankedCareers.map(({ item, score }) => ({ url: item.url, score })) });

  // Phase: CareersPageHarvest — drill into each ranked careers page,
  // extract its anchors, fuzzy-match link text against the target title,
  // then scrape + evaluate each top href. First match wins → outcome =
  // "resolved_via_careers_page".
  let careersPagesHarvestedCount = 0;
  for (const { item: careersResult } of rankedCareers) {
    if (trace.inspectedCandidates.length >= MAX_SEARCH_CANDIDATES_TO_INSPECT) break;
    if (careersPagesHarvestedCount >= MAX_CAREERS_PAGES_TO_HARVEST) break;
    careersPagesHarvestedCount += 1;

    const harvestStepIndex = await safeStartStep(reporter, ResolutionPhase.CareersPageHarvest, `Harvesting careers page ${String(careersPagesHarvestedCount)}: ${careersResult.url}`, { url: careersResult.url, careersPageNumber: careersPagesHarvestedCount });
    const harvestStartedAt = Date.now();
    let topHrefs: { href: string; text: string; accessibleName: string; score: number }[] = [];
    try {
      const harvestResult = await harvestCareersPage(container.hostPort, careersResult.url, input.originalTitle);
      topHrefs = harvestResult.topHrefs;
      await safeEndStep(reporter, harvestStepIndex, StepStatus.Succeeded, `Harvested ${String(harvestResult.rawLinkCount)} link(s); kept ${String(harvestResult.topHrefs.length)} after fuzzy match`, { rawLinkCount: harvestResult.rawLinkCount, topHrefs: harvestResult.topHrefs, durationMs: Date.now() - harvestStartedAt });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[resolver] careers-page harvest failed for ${careersResult.url}: ${errorMessage}`);
      await safeEndStep(reporter, harvestStepIndex, StepStatus.Failed, `Careers-page harvest failed: ${errorMessage}`, { url: careersResult.url, error: errorMessage, durationMs: Date.now() - harvestStartedAt });
      continue;
    }

    for (const harvested of topHrefs) {
      if (trace.inspectedCandidates.length >= MAX_SEARCH_CANDIDATES_TO_INSPECT) break;
      const harvestedHost = tryGetHostname(harvested.href);
      if (harvestedHost === null) continue;
      if (isGatedHost(harvestedHost)) continue;
      if (inspectedUrls.has(harvested.href)) continue;
      inspectedUrls.add(harvested.href);

      const careersMatch = await tryScrapeAndEvaluateCandidate({
        reporter,
        container,
        input,
        trace,
        candidateUrl: harvested.href,
        candidateLabel: `careers-page-href (${careersResult.url})`,
      });
      if (careersMatch !== null) {
        await safeFinalize(reporter, "resolved_via_careers_page", careersMatch, null);
        return { outcome: { outcome: "resolved_via_careers_page", applicationUrl: careersMatch }, trace };
      }
    }
  }

  const inspectedCount = trace.inspectedCandidates.length;
  console.log(`[resolver] outcome=not_found inspected=${String(inspectedCount)} candidate(s) without a match`);
  const finalizeStepIndex = await safeStartStep(reporter, ResolutionPhase.Finalize, "Finalizing not_found outcome", { inspectedCount, directListingCount: directListings.length, careersPageCount: careersPages.length, careersPagesHarvested: careersPagesHarvestedCount });
  const notFoundReason = `Inspected ${String(inspectedCount)} candidate(s) (across ${String(directListings.length)} direct listing(s) and ${String(careersPagesHarvestedCount)} careers page(s)); none matched the original title + description.`;
  await safeEndStep(reporter, finalizeStepIndex, StepStatus.Succeeded, notFoundReason, { outcome: "not_found", inspectedCount });
  await safeFinalize(reporter, "not_found", null, notFoundReason);
  return { outcome: { outcome: "not_found", reason: notFoundReason }, trace };
}

/**
 * Inputs to {@link tryScrapeAndEvaluateCandidate}. Bundled into an object so
 * the function signature stays readable as the resolver evolves.
 */
interface ScrapeAndEvaluateArgs {
  reporter: ResolverProgressReporter | undefined;
  container: { id: number; hostPort: number };
  input: ResolverInput;
  trace: ResolutionTrace;
  /** The URL to scrape + evaluate. */
  candidateUrl: string;
  /** Free-text label distinguishing call sites in logs (e.g. "direct-listing" vs "careers-page-href (https://...)"). */
  candidateLabel: string;
}

/**
 * Scrapes a single candidate URL via the managed container and evaluates the
 * scraped result against the original job using jobMatchService. Pushes the
 * verdict (matched or not) into trace.inspectedCandidates and emits
 * CandidateScrape + CandidateEvaluate phase events.
 *
 * Returns the candidate URL when the match is accepted, or null when the
 * candidate was rejected (mismatch) or could not be scraped (error). Callers
 * decide which outcome key to finalize on (resolved_via_search vs
 * resolved_via_careers_page) and proceed accordingly.
 *
 * A scrape error is intentionally NOT propagated — one bad candidate must
 * never abort the resolver's overall sweep. The failure is recorded as a
 * rejection in trace.inspectedCandidates with the error message verbatim.
 *
 * @param {ScrapeAndEvaluateArgs} args - Bundled call arguments
 * @returns {Promise<string | null>} The matched URL, or null when no match
 */
async function tryScrapeAndEvaluateCandidate(args: ScrapeAndEvaluateArgs): Promise<string | null> {
  const { reporter, container, input, trace, candidateUrl, candidateLabel } = args;
  const candidateNumber = trace.inspectedCandidates.length + 1;
  const candidateScrapeStepIndex = await safeStartStep(reporter, ResolutionPhase.CandidateScrape, `Scraping candidate ${String(candidateNumber)} [${candidateLabel}]: ${candidateUrl}`, { url: candidateUrl, candidateNumber, candidateLabel });
  const candidateScrapeStartedAt = Date.now();
  let candidateScrapedTitle = "";
  try {
    const candidateScrape = await scrapeJobViaContainer(container.hostPort, candidateUrl);
    candidateScrapedTitle = candidateScrape.title;
    await safeEndStep(reporter, candidateScrapeStepIndex, StepStatus.Succeeded, `Scraped title: "${candidateScrape.title}"`, { url: candidateUrl, scrapedTitle: candidateScrape.title, scrapedDescription: candidateScrape.description, durationMs: Date.now() - candidateScrapeStartedAt });

    const candidateEvaluateStepIndex = await safeStartStep(reporter, ResolutionPhase.CandidateEvaluate, `Evaluating match for candidate ${String(candidateNumber)}`, { url: candidateUrl, scrapedTitle: candidateScrape.title, candidateLabel });
    const verdict = evaluateJobMatch({
      originalTitle: input.originalTitle,
      originalDescription: input.originalDescription,
      candidateTitle: candidateScrape.title,
      candidateDescription: candidateScrape.description,
    });
    trace.inspectedCandidates.push({
      url: candidateUrl,
      scrapedTitle: candidateScrape.title,
      matched: verdict.matched,
      rejectionReason: verdict.reason,
    });
    console.log(`[resolver] candidate=${candidateUrl} [${candidateLabel}] scrapedTitle="${candidateScrape.title}" verdict=${verdict.matched ? "accept" : "reject"} reason="${verdict.reason}"`);
    await safeEndStep(reporter, candidateEvaluateStepIndex, verdict.matched ? StepStatus.Succeeded : StepStatus.Skipped, verdict.matched ? `Match accepted: ${verdict.reason}` : `Match rejected: ${verdict.reason}`, { matched: verdict.matched, reason: verdict.reason });
    if (verdict.matched) return candidateUrl;
    return null;
  } catch (err) {
    // One bad candidate shouldn't abort the search — record the failure
    // verbatim in the trace and return null so the caller moves on.
    const errorMessage = err instanceof Error ? err.message : String(err);
    trace.inspectedCandidates.push({
      url: candidateUrl,
      scrapedTitle: candidateScrapedTitle,
      matched: false,
      rejectionReason: `scrape failed: ${errorMessage}`,
    });
    console.warn(`[resolver] candidate=${candidateUrl} [${candidateLabel}] scrape failed: ${errorMessage}`);
    await safeEndStep(reporter, candidateScrapeStepIndex, StepStatus.Failed, `Scrape failed: ${errorMessage}`, { url: candidateUrl, error: errorMessage, durationMs: Date.now() - candidateScrapeStartedAt });
    return null;
  }
}

/**
 * Calls reporter.startStep, swallowing any error so a flaky reporter cannot
 * abort the resolution. Returns -1 when the reporter is undefined or threw —
 * subsequent safeEndStep / safeFinalize calls tolerate this sentinel.
 *
 * @param {ResolverProgressReporter | undefined} reporter - The optional reporter
 * @param {ResolutionPhase} phase - Phase to announce
 * @param {string} message - Human-readable summary
 * @param {Record<string, unknown>} payload - Structured detail
 * @returns {Promise<number>} The step index, or -1 on missing/failing reporter
 */
async function safeStartStep(
  reporter: ResolverProgressReporter | undefined,
  phase: ResolutionPhase,
  message: string,
  payload: Record<string, unknown>
): Promise<number> {
  if (reporter === undefined) return -1;
  try {
    return await reporter.startStep(phase, message, payload);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[resolver] progress startStep failed for phase=${phase}: ${errorMessage}`);
    return -1;
  }
}

/**
 * Calls reporter.endStep, swallowing any error and treating stepIndex=-1 as a
 * no-op (the matching safeStartStep failed or the reporter is undefined).
 *
 * @param {ResolverProgressReporter | undefined} reporter - The optional reporter
 * @param {number} stepIndex - The index returned by the matching safeStartStep
 * @param {StepStatus} status - Terminal status to record
 * @param {string} message - Human-readable summary
 * @param {Record<string, unknown>} payload - Structured detail
 * @returns {Promise<void>}
 */
async function safeEndStep(
  reporter: ResolverProgressReporter | undefined,
  stepIndex: number,
  status: StepStatus,
  message: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (reporter === undefined) return;
  if (stepIndex < 0) return;
  try {
    await reporter.endStep(stepIndex, status, message, payload);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[resolver] progress endStep failed for stepIndex=${String(stepIndex)}: ${errorMessage}`);
  }
}

/**
 * Calls reporter.finalize, swallowing any error.
 *
 * @param {ResolverProgressReporter | undefined} reporter - The optional reporter
 * @param {ResolverOutcomeKey} outcome - Terminal outcome key
 * @param {string | null} applicationUrl - Resolved URL or null on not_found
 * @param {string | null} reason - Free-text reason or null on success outcomes
 * @returns {Promise<void>}
 */
async function safeFinalize(
  reporter: ResolverProgressReporter | undefined,
  outcome: ResolverOutcomeKey,
  applicationUrl: string | null,
  reason: string | null
): Promise<void> {
  if (reporter === undefined) return;
  try {
    await reporter.finalize(outcome, applicationUrl, reason);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[resolver] progress finalize failed: ${errorMessage}`);
  }
}

/**
 * Builds a ResolverProgressReporter that pushes every event over HTTP to the
 * given managed container's `/resolution-progress/:logId/*` endpoints. The
 * stepIndex is assigned monotonically by this reporter (the server is the
 * source of truth for ordering). Errors are caught and logged via
 * console.warn so a flaky container can't abort the resolution.
 *
 * The startedAt / endedAt / durationMs fields are computed locally so the
 * container doesn't have to trust client clocks for timing analysis.
 *
 * @param {number} containerHostPort - The host port the target container is bound to (127.0.0.1)
 * @param {number} logId - The ApplicationUrlResolutionLog row id this attempt belongs to
 * @returns {ResolverProgressReporter} A reporter wired to that container
 */
export function createContainerProgressReporter(containerHostPort: number, logId: number): ResolverProgressReporter {
  let nextStepIndex = 0;
  const startTimes = new Map<number, number>();
  const startMessages = new Map<number, string>();
  const startPhases = new Map<number, ResolutionPhase>();
  const startPayloads = new Map<number, Record<string, unknown>>();

  const containerBaseUrl = `http://127.0.0.1:${String(containerHostPort)}/resolution-progress/${String(logId)}`;

  /**
   * POSTs a JSON body to the given path under the container's progress
   * endpoint base. Errors are logged and swallowed.
   * @param {string} path - The trailing path segment (e.g., "/step", "/finalize")
   * @param {unknown} body - The JSON body to send
   * @returns {Promise<void>}
   */
  const post = async (path: string, body: unknown): Promise<void> => {
    try {
      await fetch(`${containerBaseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`[resolver:reporter] POST ${path} failed for log=${String(logId)}: ${errorMessage}`);
    }
  };

  return {
    async startStep(phase: ResolutionPhase, message: string, payload?: Record<string, unknown>): Promise<number> {
      const stepIndex = nextStepIndex++;
      const startedAt = new Date();
      startTimes.set(stepIndex, startedAt.getTime());
      startMessages.set(stepIndex, message);
      startPhases.set(stepIndex, phase);
      startPayloads.set(stepIndex, payload ?? {});
      await post("/step", {
        stepIndex,
        phase,
        status: StepStatus.Running,
        message,
        payload: payload ?? {},
        startedAt: startedAt.toISOString(),
        endedAt: null,
        durationMs: null,
      });
      return stepIndex;
    },
    async endStep(stepIndex: number, status: StepStatus, message?: string, payload?: Record<string, unknown>): Promise<void> {
      const startedAtMs = startTimes.get(stepIndex);
      const phase = startPhases.get(stepIndex) ?? ResolutionPhase.Finalize;
      const startMessage = startMessages.get(stepIndex) ?? "";
      const mergedMessage = message ?? startMessage;
      const startPayload = startPayloads.get(stepIndex) ?? {};
      const mergedPayload = { ...startPayload, ...(payload ?? {}) };
      const endedAt = new Date();
      const durationMs = startedAtMs !== undefined ? endedAt.getTime() - startedAtMs : null;
      await post("/step", {
        stepIndex,
        phase,
        status,
        message: mergedMessage,
        payload: mergedPayload,
        startedAt: startedAtMs !== undefined ? new Date(startedAtMs).toISOString() : endedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs,
      });
    },
    async finalize(outcome: ResolverOutcomeKey, applicationUrl: string | null, reason: string | null): Promise<void> {
      await post("/finalize", {
        finalOutcome: outcome,
        finalApplicationUrl: applicationUrl,
        reason,
      });
    },
  };
}
