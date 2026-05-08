/**
 * Frontend API service for interacting with the job listings backend.
 */
import { requestJson } from "./httpClient";

export interface JobListingResponse {
  id: number;
  title: string;
  url: string;
  description: string;
  salary: string | null;
  status: string;
  live_url: string | null;
  post_date: string;
  created_date: string;
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
