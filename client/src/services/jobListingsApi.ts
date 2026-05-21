/**
 * Frontend API service for interacting with the job listings backend.
 */
import { requestJson } from "./httpClient";

export interface JobListingResponse {
  id: number;
  title: string;
  url: string;
  application_url: string | null;
  description: string;
  salary: string | null;
  status: string;
  live_url: string | null;
  post_date: string;
  created_date: string;
  // Computed by the server from the latest ApplicationUrlResolutionLog row:
  // true when the most recent attempt's `outcome` is null (i.e. still running).
  resolution_in_progress: boolean;
  // The id of the latest resolution log row, or null when no attempt has been
  // recorded yet. The UrlResolutionTracePage uses this to deep-link.
  latest_resolution_log_id: number | null;
}

/**
 * Mirror of server-side enums in
 * server/src/services/applicationUrlResolverService.ts — that file is the
 * source of truth. Keep the string values byte-identical so the wire format
 * round-trips cleanly.
 */
export enum ResolutionPhase {
  DirectCheck = "direct_check",
  AcquireContainer = "acquire_container",
  ApplyButtonScrape = "apply_button_scrape",
  ApplyButtonDecision = "apply_button_decision",
  BuildQuery = "build_query",
  BraveSearch = "brave_search",
  AIPageClassify = "ai_page_classify",
  FuzzyRankDirectListings = "fuzzy_rank_direct_listings",
  FuzzyRankCareersPages = "fuzzy_rank_careers_pages",
  CareersPageHarvest = "careers_page_harvest",
  CandidateScrape = "candidate_scrape",
  CandidateEvaluate = "candidate_evaluate",
  Finalize = "finalize",
}

/** Status of a single step in a live trace. */
export enum StepStatus {
  Running = "running",
  Succeeded = "succeeded",
  Failed = "failed",
  Skipped = "skipped",
}

/** Terminal outcomes of a resolver attempt. */
export enum ApplicationUrlResolutionOutcome {
  Direct = "direct",
  ResolvedViaRedirect = "resolved_via_redirect",
  ResolvedViaSearch = "resolved_via_search",
  ResolvedViaCareersPage = "resolved_via_careers_page",
  NotFound = "not_found",
}

/**
 * One step in the live trace timeline. Mirrors the LiveStep type stored by
 * the container's in-memory progress map.
 */
export interface LiveStep {
  stepIndex: number;
  phase: ResolutionPhase;
  status: StepStatus;
  message: string;
  payload: Record<string, unknown>;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

/**
 * Live progress snapshot for a single resolver attempt. Returned by
 * GET /api/job-listings/:id/url-resolution/live.
 */
export interface LiveProgress {
  logId: number;
  jobListingId: number;
  isFinished: boolean;
  startedAt: string;
  finishedAt: string | null;
  steps: LiveStep[];
  finalOutcome: ApplicationUrlResolutionOutcome | null;
  finalApplicationUrl: string | null;
  reason: string | null;
}

/**
 * Fetches all job listings from the API, ordered by created_date descending.
 * @returns {Promise<JobListingResponse[]>} Array of job listing objects
 * @throws {Error} If the API request fails
 */
export async function getJobListings(): Promise<JobListingResponse[]> {
  return requestJson<JobListingResponse[]>(
    "/api/job-listings",
    undefined,
    "Failed to fetch job listings"
  );
}

/**
 * Fetches a single job listing by its ID.
 * @param {number} id - The ID of the job listing to fetch
 * @returns {Promise<JobListingResponse>} The job listing object
 * @throws {Error} If the API request fails or the listing is not found
 */
export async function getJobListing(id: number): Promise<JobListingResponse> {
  return requestJson<JobListingResponse>(
    `/api/job-listings/${String(id)}`,
    undefined,
    "Failed to fetch job listing"
  );
}

/**
 * Creates a new job listing by submitting a URL for background scraping.
 * @param {string} url - The job listing URL to scrape
 * @returns {Promise<JobListingResponse>} The created pending job listing
 * @throws {Error} If the API request fails
 */
export async function createJobListing(url: string): Promise<JobListingResponse> {
  return requestJson<JobListingResponse>(
    "/api/job-listings",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    },
    "Failed to create job listing"
  );
}

/**
 * Triggers background scraping to enrich a job listing with title, description, salary, and post date.
 * Returns the current job listing record immediately — poll GET /api/job-listings/:id for updates.
 * @param {number} id - The ID of the job listing to fetch data for
 * @returns {Promise<JobListingResponse>} The current job listing (data will update after scraping completes)
 * @throws {Error} If the API request fails
 */
export async function fetchJobData(id: number): Promise<JobListingResponse> {
  return requestJson<JobListingResponse>(
    `/api/job-listings/${String(id)}/fetch`,
    { method: "POST" },
    "Failed to fetch job data"
  );
}

/**
 * Retries the application-URL resolution for a job listing whose first resolve
 * failed (status=missing_form_url). The server runs the resolver against the
 * persisted title + description without re-scraping the original page content.
 * Returns the current row immediately; poll GET /api/job-listings/:id to see the result.
 * @param {number} id - The ID of the job listing to retry resolution for
 * @returns {Promise<JobListingResponse>} The current job listing (will update after resolution completes)
 * @throws {Error} If the API request fails
 */
export async function resolveApplicationUrl(id: number): Promise<JobListingResponse> {
  return requestJson<JobListingResponse>(
    `/api/job-listings/${String(id)}/resolve-application-url`,
    { method: "POST" },
    "Failed to retry application URL resolution"
  );
}

/**
 * One Brave search result, as captured in the resolution log. Mirrors the
 * server's BraveSearchResult shape (already JSON-parsed by the route layer).
 */
export interface ResolutionLogBraveResult {
  title: string;
  url: string;
  description: string;
}

/**
 * One candidate the resolver actually scraped + verdict. Mirrors the
 * server-side InspectedCandidate interface.
 */
export interface ResolutionLogInspectedCandidate {
  url: string;
  scrapedTitle: string;
  matched: boolean;
  rejectionReason: string;
}

/**
 * Shape of one row from GET /api/job-listings/:id/resolution-logs. Matches the
 * server's ParsedResolutionLog: the two JSON columns are pre-parsed into
 * structured arrays so the client doesn't have to double-parse.
 */
export interface ResolutionLog {
  id: number;
  job_listing_id: number;
  outcome: "direct" | "resolved_via_redirect" | "resolved_via_search" | "resolved_via_careers_page" | "not_found";
  search_query: string | null;
  brave_results: ResolutionLogBraveResult[];
  inspected_candidates: ResolutionLogInspectedCandidate[];
  final_application_url: string | null;
  reason: string | null;
  created_date: string;
}

/**
 * Fetches every resolver attempt recorded for a job listing, newest first.
 * Used by the ResolutionTracePanel on the job-view page so the user can see
 * exactly what the resolver did.
 * @param {number} id - The ID of the job listing
 * @returns {Promise<ResolutionLog[]>} Array of attempts, newest first
 * @throws {Error} If the API request fails
 */
export async function getResolutionLogs(id: number): Promise<ResolutionLog[]> {
  return requestJson<ResolutionLog[]>(
    `/api/job-listings/${String(id)}/resolution-logs`,
    undefined,
    "Failed to fetch resolution logs"
  );
}

/**
 * Fetches the live progress trace for the latest resolution attempt on a job
 * listing. Returns null when the server has no resolution attempts recorded
 * for this job yet (HTTP 404). The UrlResolutionTracePage uses this on a 1 s
 * poll while `isFinished === false`.
 * @param {number} id - The ID of the job listing
 * @returns {Promise<LiveProgress | null>} The live snapshot, or null on 404
 * @throws {Error} If the API request fails for any reason other than 404
 */
export async function getLiveUrlResolution(id: number): Promise<LiveProgress | null> {
  try {
    return await requestJson<LiveProgress>(
      `/api/job-listings/${String(id)}/url-resolution/live`,
      undefined,
      "Failed to fetch live URL resolution trace"
    );
  } catch (err) {
    // requestJson throws plain Error objects whose .message is the server's
    // { error } body or the default. A 404 manifests as "No resolution
    // attempts found for this job"; treat that as the null/empty case.
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("No resolution attempts")) {
      return null;
    }
    throw err;
  }
}

/**
 * Deletes a job listing by its ID.
 * @param {number} id - The ID of the job listing to delete
 * @returns {Promise<JobListingResponse>} The deleted job listing
 * @throws {Error} If the API request fails
 */
export async function deleteJobListing(id: number): Promise<JobListingResponse> {
  return requestJson<JobListingResponse>(
    `/api/job-listings/${String(id)}`,
    { method: "DELETE" },
    "Failed to delete job listing"
  );
}

/**
 * Bulk-creates job listings from an array of URLs.
 * @param {string[]} urls - The job listing URLs to import
 * @returns {Promise<{ count: number; listings: JobListingResponse[] }>} The created records
 * @throws {Error} If the API request fails
 */
export async function bulkCreateJobListings(urls: string[]): Promise<{ count: number; listings: JobListingResponse[] }> {
  return requestJson<{ count: number; listings: JobListingResponse[] }>(
    "/api/job-listings/bulk",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    },
    "Failed to bulk create job listings"
  );
}

/**
 * Starts the application process for a single job listing.
 * @param {number} id - The ID of the job listing to apply to
 * @returns {Promise<JobListingResponse>} The job listing with status "applying"
 * @throws {Error} If the API request fails
 */
export async function applyToJob(id: number): Promise<JobListingResponse> {
  return requestJson<JobListingResponse>(
    `/api/job-listings/${String(id)}/apply`,
    { method: "POST" },
    "Failed to start job application"
  );
}

/**
 * Response from the batch apply status endpoint.
 */
export interface BatchApplyStatusResponse {
  isRunning: boolean;
  currentJobId: number | null;
  completed: number[];
  errors: Array<{ jobId: number; error: string }>;
  totalJobs: number;
  remaining: number;
}

/**
 * Starts the batch application process for all eligible job listings.
 * @returns {Promise<{ message: string; totalJobs: number }>} Batch start confirmation
 * @throws {Error} If the API request fails
 */
export async function startBatchApply(): Promise<{ message: string; totalJobs: number }> {
  return requestJson<{ message: string; totalJobs: number }>(
    "/api/job-listings/apply-batch",
    { method: "POST" },
    "Failed to start batch application"
  );
}

/**
 * Gets the current status of the batch application process.
 * @returns {Promise<BatchApplyStatusResponse>} The current batch status
 * @throws {Error} If the API request fails
 */
export async function getBatchApplyStatus(): Promise<BatchApplyStatusResponse> {
  return requestJson<BatchApplyStatusResponse>(
    "/api/job-listings/apply-batch/status",
    undefined,
    "Failed to fetch batch apply status"
  );
}
