import { Router, Request, Response } from "express";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDate } from "chrono-node";
import prisma from "../prismaClient.js";
import { fetchJobListingFromUrl } from "../services/jobListingScraperService.js";
import type { LinkedInCredentials } from "../services/jobListingScraperService.js";

const router = Router();

/**
 * POST /api/job-listings
 * Accepts a job listing URL and kicks off background scraping.
 * Returns 202 immediately with a pending record while the scraping runs asynchronously.
 * @param {string} req.body.url - The URL of the job posting to scrape
 * @returns {object} 202 - The pending job listing record
 * @returns {object} 400 - Missing or invalid url field error
 */
router.post("/", async (req: Request, res: Response) => {
  const { url } = req.body;

  const isMissingUrl = !url;
  if (isMissingUrl) {
    res.status(400).json({ error: "Missing required field: url" });
    return;
  }

  const isValidHttpUrl = typeof url === "string" && /^https?:\/\//i.test(url) && URL.canParse(url);
  if (!isValidHttpUrl) {
    res.status(400).json({ error: "Invalid url: must be a valid HTTP or HTTPS URL" });
    return;
  }

  const pendingJobListing = await prisma.jobListing.create({
    data: {
      url,
      title: "",
      description: "",
      post_date: new Date(),
      status: "pending",
    },
  });

  res.status(202).json(pendingJobListing);

  const parsedUrl = new URL(url);
  const isLinkedInUrl = parsedUrl.hostname === "linkedin.com" || parsedUrl.hostname.endsWith(".linkedin.com");
  const credentialsPath = isLinkedInUrl
    ? resolve(__dirname, "../scripts/linkedin_credentials.json")
    : null;

  scrapeAndUpdateJobListing(pendingJobListing.id, url, credentialsPath).catch(() => {
    /* error already handled inside */
  });
});

/**
 * Parses a post date string into a Date object using natural language parsing.
 * Handles relative dates like "2 hours ago", "yesterday", and absolute dates like "2026-03-01".
 * Falls back to the current date if the string cannot be parsed.
 * @param {string} postDateString - The date string to parse (e.g., "2 hours ago", "March 1, 2026")
 * @returns {Date} The parsed date, or the current date if parsing fails
 */
function parsePostDate(postDateString: string): Date {
  const parsedDate = parseDate(postDateString);
  const isUnparseable = parsedDate === null;
  if (isUnparseable) {
    return new Date();
  }
  return parsedDate;
}

/**
 * Reads the credentials file (if provided), scrapes the job listing, and updates
 * the database record with the scraped data or a failed status.
 * @param {number} jobListingId - The ID of the pending job listing record
 * @param {string} url - The job listing URL to scrape
 * @param {string | null} credentialsPath - Absolute path to the LinkedIn credentials JSON file, or null if no login is needed
 */
async function scrapeAndUpdateJobListing(jobListingId: number, url: string, credentialsPath: string | null): Promise<void> {
  try {
    let credentials: LinkedInCredentials | null = null;
    const hasCredentialsPath = !!credentialsPath;
    if (hasCredentialsPath) {
      const credentialsJson = await readFile(credentialsPath, "utf-8");
      credentials = JSON.parse(credentialsJson) as LinkedInCredentials;
    }
    const handleLiveUrlReady = async (liveUrl: string) => {
      await prisma.jobListing.update({
        where: { id: jobListingId },
        data: { live_url: liveUrl },
      });
    };

    const scrapedData = await fetchJobListingFromUrl(url, credentials, handleLiveUrlReady);

    const formattedTitle = scrapedData.company
      ? `${scrapedData.company} - ${scrapedData.title}`
      : scrapedData.title;

    await prisma.jobListing.update({
      where: { id: jobListingId },
      data: {
        title: formattedTitle,
        description: scrapedData.description,
        post_date: parsePostDate(scrapedData.postDate),
        status: "completed",
        live_url: null,
      },
    });
  } catch {
    await prisma.jobListing.update({
      where: { id: jobListingId },
      data: { status: "failed", live_url: null },
    });
  }
}

/**
 * GET /api/job-listings
 * Retrieves all job listings from the database, ordered by created_date descending.
 * @returns {object[]} 200 - Array of all job listings
 */
router.get("/", async (_req: Request, res: Response) => {
  const jobListings = await prisma.jobListing.findMany({
    orderBy: { created_date: "desc" },
  });

  res.json(jobListings);
});

/**
 * GET /api/job-listings/:id
 * Retrieves a single job listing by its ID.
 * @param {number} req.params.id - The ID of the job listing
 * @returns {object} 200 - The job listing
 * @returns {object} 404 - Job listing not found error
 */
router.get("/:id", async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const isArrayParam = Array.isArray(rawId);
  if (isArrayParam) {
    res.status(400).json({ error: "Invalid id parameter" });
    return;
  }

  const id = parseInt(rawId, 10);

  const isInvalidId = isNaN(id);
  if (isInvalidId) {
    res.status(400).json({ error: "Invalid id parameter" });
    return;
  }

  const jobListing = await prisma.jobListing.findUnique({
    where: { id },
  });

  const isNotFound = !jobListing;
  if (isNotFound) {
    res.status(404).json({ error: "Job listing not found" });
    return;
  }

  res.json(jobListing);
});

/**
 * DELETE /api/job-listings/:id
 * Deletes a job listing by its ID.
 * @param {number} req.params.id - The ID of the job listing to delete
 * @returns {object} 200 - The deleted job listing
 * @returns {object} 404 - Job listing not found error
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const isArrayParam = Array.isArray(rawId);
  if (isArrayParam) {
    res.status(400).json({ error: "Invalid id parameter" });
    return;
  }

  const id = parseInt(rawId, 10);

  const isInvalidId = isNaN(id);
  if (isInvalidId) {
    res.status(400).json({ error: "Invalid id parameter" });
    return;
  }

  const existingJobListing = await prisma.jobListing.findUnique({
    where: { id },
  });

  const isNotFound = !existingJobListing;
  if (isNotFound) {
    res.status(404).json({ error: "Job listing not found" });
    return;
  }

  const deletedJobListing = await prisma.jobListing.delete({
    where: { id },
  });

  res.json(deletedJobListing);
});

export { router as jobListingsRouter, scrapeAndUpdateJobListing, parsePostDate };
