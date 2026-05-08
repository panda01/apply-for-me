/**
 * Frontend API service for interacting with the job listings backend.
 */

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
  const response = await fetch("/api/job-listings");

  const isNotOk = !response.ok;
  if (isNotOk) {
    throw new Error("Failed to fetch job listings");
  }

  return response.json() as Promise<JobListingResponse[]>;
}

/**
 * Fetches a single job listing by its ID.
 * @param {number} id - The ID of the job listing to fetch
 * @returns {Promise<JobListingResponse>} The job listing object
 * @throws {Error} If the API request fails or the listing is not found
 */
export async function getJobListing(id: number): Promise<JobListingResponse> {
  const response = await fetch(`/api/job-listings/${id}`);

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Failed to fetch job listing");
  }

  return response.json() as Promise<JobListingResponse>;
}

/**
 * Creates a new job listing by submitting a URL for background scraping.
 * @param {string} url - The job listing URL to scrape
 * @returns {Promise<JobListingResponse>} The created pending job listing
 * @throws {Error} If the API request fails
 */
export async function createJobListing(url: string): Promise<JobListingResponse> {
  const response = await fetch("/api/job-listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Failed to create job listing");
  }

  return response.json() as Promise<JobListingResponse>;
}

/**
 * Triggers background scraping to enrich a job listing with title, description, salary, and post date.
 * Returns the current job listing record immediately — poll GET /api/job-listings/:id for updates.
 * @param {number} id - The ID of the job listing to fetch data for
 * @returns {Promise<JobListingResponse>} The current job listing (data will update after scraping completes)
 * @throws {Error} If the API request fails
 */
export async function fetchJobData(id: number): Promise<JobListingResponse> {
  const response = await fetch(`/api/job-listings/${id}/fetch`, {
    method: "POST",
  });

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Failed to fetch job data");
  }

  return response.json() as Promise<JobListingResponse>;
}

/**
 * Deletes a job listing by its ID.
 * @param {number} id - The ID of the job listing to delete
 * @returns {Promise<JobListingResponse>} The deleted job listing
 * @throws {Error} If the API request fails
 */
export async function deleteJobListing(id: number): Promise<JobListingResponse> {
  const response = await fetch(`/api/job-listings/${id}`, {
    method: "DELETE",
  });

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Failed to delete job listing");
  }

  return response.json() as Promise<JobListingResponse>;
}

/**
 * Bulk-creates job listings from an array of URLs.
 * @param {string[]} urls - The job listing URLs to import
 * @returns {Promise<{ count: number; listings: JobListingResponse[] }>} The created records
 * @throws {Error} If the API request fails
 */
export async function bulkCreateJobListings(urls: string[]): Promise<{ count: number; listings: JobListingResponse[] }> {
  const response = await fetch("/api/job-listings/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Failed to bulk create job listings");
  }

  return response.json() as Promise<{ count: number; listings: JobListingResponse[] }>;
}

/**
 * Starts the application process for a single job listing.
 * @param {number} id - The ID of the job listing to apply to
 * @returns {Promise<JobListingResponse>} The job listing with status "applying"
 * @throws {Error} If the API request fails
 */
export async function applyToJob(id: number): Promise<JobListingResponse> {
  const response = await fetch(`/api/job-listings/${id}/apply`, {
    method: "POST",
  });

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Failed to start job application");
  }

  return response.json() as Promise<JobListingResponse>;
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
  const response = await fetch("/api/job-listings/apply-batch", {
    method: "POST",
  });

  const isNotOk = !response.ok;
  if (isNotOk) {
    const errorBody = await response.json() as { error?: string };
    throw new Error(errorBody.error ?? "Failed to start batch application");
  }

  return response.json() as Promise<{ message: string; totalJobs: number }>;
}

/**
 * Gets the current status of the batch application process.
 * @returns {Promise<BatchApplyStatusResponse>} The current batch status
 * @throws {Error} If the API request fails
 */
export async function getBatchApplyStatus(): Promise<BatchApplyStatusResponse> {
  const response = await fetch("/api/job-listings/apply-batch/status");

  const isNotOk = !response.ok;
  if (isNotOk) {
    throw new Error("Failed to fetch batch apply status");
  }

  return response.json() as Promise<BatchApplyStatusResponse>;
}
