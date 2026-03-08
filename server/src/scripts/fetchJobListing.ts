import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchJobListingFromUrl } from "../services/jobListingScraperService.js";
import type { LinkedInCredentials } from "../services/jobListingScraperService.js";

/**
 * Standalone CLI script that fetches a job listing by URL
 * using the scraping service and prints the extracted details.
 * For LinkedIn URLs, reads credentials from linkedin_credentials.json.
 *
 * @usage npx tsx server/src/scripts/fetchJobListing.ts "<job_url>"
 */
async function main() {
  const jobUrl = process.argv[2];

  const isMissingUrl = !jobUrl;
  if (isMissingUrl) {
    console.error("Usage: npx tsx server/src/scripts/fetchJobListing.ts <job_url>");
    process.exit(1);
  }

  const parsedUrl = new URL(jobUrl);
  const isLinkedInUrl = parsedUrl.hostname === "linkedin.com" || parsedUrl.hostname.endsWith(".linkedin.com");

  let credentials: LinkedInCredentials | null = null;
  if (isLinkedInUrl) {
    const credentialsPath = resolve(__dirname, "linkedin_credentials.json");
    console.log(`Loading LinkedIn credentials from: ${credentialsPath}`);
    const credentialsJson = await readFile(credentialsPath, "utf-8");
    credentials = JSON.parse(credentialsJson) as LinkedInCredentials;
  }

  console.log(`Fetching job listing from: ${jobUrl}`);
  const jobListing = await fetchJobListingFromUrl(jobUrl, credentials);

  console.log("\n========== Job Listing Details ==========");
  console.log(`Title:       ${jobListing.title}`);
  console.log(`Company:     ${jobListing.company}`);
  console.log(`Post Date:   ${jobListing.postDate}`);
  console.log(`URL:         ${jobListing.url}`);
  console.log(`\nDescription:\n${jobListing.description}`);
  console.log("==========================================\n");
}

main().catch((err: Error) => {
  console.error("Error:", err.message);
  process.exit(1);
});
