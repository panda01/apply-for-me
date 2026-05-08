import { BrowserUse } from "browser-use-sdk/v3";
import { z } from "zod";

/**
 * Service module that encapsulates the scraping logic for fetching job listings
 * via the Browser Use agent API (v3). Uses an LLM-driven browser agent to navigate
 * pages and extract structured data using a Zod schema.
 */

export interface JobListing {
  title: string;
  company: string;
  description: string;
  salary: string;
  postDate: string;
  url: string;
}

/**
 * Zod schema defining the structured output expected from the Browser Use agent
 * when extracting job listing details from a page.
 */
const JobListingSchema = z.object({
  title: z.string(),
  company: z.string(),
  description: z.string(),
  salary: z.string().describe("The salary or compensation range listed for the job, or empty string if not found"),
  postDate: z.string(),
});

/**
 * Credentials used to authenticate with LinkedIn before scraping.
 */
export interface LinkedInCredentials {
  email: string;
  password: string;
}

/**
 * Waits for a SessionRun's sessionId to become available by polling, then fetches
 * the session info to retrieve the live view URL and calls the provided callback.
 * @param {BrowserUse} client - The Browser Use client instance
 * @param {{ sessionId: string | null }} sessionRun - The SessionRun object with a sessionId getter
 * @param {((liveUrl: string) => void) | undefined} onLiveUrlReady - Optional callback invoked with the live URL
 */
async function notifyLiveUrl(
  client: BrowserUse,
  sessionRun: { sessionId: string | null },
  onLiveUrlReady?: (liveUrl: string) => void
): Promise<void> {
  const hasNoCallback = !onLiveUrlReady;
  if (hasNoCallback) return;

  const maxWaitMs = 15000;
  const pollIntervalMs = 200;
  let elapsedMs = 0;

  const isSessionIdPending = () => sessionRun.sessionId === null && elapsedMs < maxWaitMs;
  while (isSessionIdPending()) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    elapsedMs += pollIntervalMs;
  }

  const hasSessionId = sessionRun.sessionId !== null;
  if (!hasSessionId) {
    console.warn("[scraper] Session ID not available within timeout, cannot fetch live URL");
    return;
  }
  try {
    const session = await client.sessions.get(sessionRun.sessionId!);
    const hasLiveUrl = !!session.liveUrl;
    if (hasLiveUrl) {
      onLiveUrlReady(session.liveUrl!);
    }
  } catch {
    console.warn("[scraper] Failed to fetch live URL for session");
  }
}

/**
 * Builds the extraction prompt for the Browser Use agent. If credentials are provided,
 * includes login instructions so the agent can authenticate if the page requires it.
 * @param {string} jobUrl - The job listing URL to navigate to
 * @param {LinkedInCredentials | null} credentials - Optional login credentials to include in the prompt
 * @returns {string} The full prompt string for the Browser Use agent
 */
function buildExtractionPrompt(jobUrl: string, credentials: LinkedInCredentials | null): string {
  const basePrompt = `Navigate to ${jobUrl}. If there is a "Show more" or "See more" button on the job description, click it to expand the full description. Extract the job listing details: the job title, the company name, the full job description text, the salary or compensation range (if listed), and when it was posted.`;

  const hasCredentials = credentials !== null;
  if (hasCredentials) {
    return `${basePrompt} If the page requires you to log in, use the email "${credentials.email}" and the password "${credentials.password}" to sign in, then continue extracting the job details.`;
  }

  return basePrompt;
}

/**
 * Orchestrates the full job listing fetch workflow using the Browser Use agent API.
 * Uses a single unified flow for all URLs: navigates directly to the job URL and
 * extracts details. If credentials are provided, they are included in the prompt so
 * the agent can use them to log in if the page requires authentication.
 *
 * @param {string} jobUrl - The job listing URL to scrape
 * @param {LinkedInCredentials | null} credentials - Login credentials to use if the page requires authentication, or null
 * @param {((liveUrl: string) => void)} [onLiveUrlReady] - Optional callback invoked with the Browser Use live view URL once the session starts
 * @returns {Promise<JobListing>} The extracted job listing details
 * @throws {Error} If the BROWSER_USE_API environment variable is missing or any scraping step fails
 */
export async function fetchJobListingFromUrl(
  jobUrl: string,
  credentials: LinkedInCredentials | null,
  onLiveUrlReady?: (liveUrl: string) => void
): Promise<JobListing> {
  console.log(`[scraper] Starting scrape for URL: ${jobUrl}`);

  const apiKey = process.env["BROWSER_USE_API"];
  const isMissingApiKey = !apiKey;
  if (isMissingApiKey) {
    throw new Error("BROWSER_USE_API environment variable is not set. Add it to your .env file.");
  }

  const client = new BrowserUse({ apiKey });
  let sessionId: string | undefined;

  try {
    const extractionPrompt = buildExtractionPrompt(jobUrl, credentials);
    console.log(`[scraper] Extracting job details from: ${jobUrl}`);

    const extractionRun = client.run(extractionPrompt, {
      schema: JobListingSchema,
      keepAlive: false,
    });

    await notifyLiveUrl(client, extractionRun, onLiveUrlReady);

    const extractionResult = await extractionRun;
    sessionId = extractionResult.id;

    const extractionFailed = extractionResult.status === "error" || extractionResult.status === "timed_out";
    if (extractionFailed) {
      throw new Error(`Job extraction failed with status: ${extractionResult.status}`);
    }

    const hasNoOutput = !extractionResult.output;
    if (hasNoOutput) {
      throw new Error("Browser Use agent returned no output for the extraction task");
    }

    const extractedData = extractionResult.output;
    console.log(`[scraper] Extraction complete — title: "${extractedData.title}", company: "${extractedData.company}"`);

    return {
      title: extractedData.title,
      company: extractedData.company,
      description: extractedData.description,
      salary: extractedData.salary,
      postDate: extractedData.postDate,
      url: jobUrl,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[scraper] Scraping failed for ${jobUrl}: ${errorMessage}`);
    throw err;
  } finally {
    const hasActiveSession = !!sessionId;
    if (hasActiveSession) {
      console.log(`[scraper] Stopping session ${sessionId}...`);
      try {
        await client.sessions.stop(sessionId!);
        console.log("[scraper] Session stopped");
      } catch {
        console.warn("[scraper] Failed to stop session (may already be stopped)");
      }
    }
  }
}
