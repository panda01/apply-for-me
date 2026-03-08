/**
 * Frontend API service for interacting with the job listings backend.
 */

export interface JobListingResponse {
  id: number;
  title: string;
  url: string;
  description: string;
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
