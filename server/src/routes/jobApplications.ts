import { Router, Request, Response } from "express";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import prisma from "../prismaClient.js";
import { applyToJob } from "../services/jobApplicationService.js";
import type { UserInfo, StepLog } from "../services/jobApplicationService.js";
import { scrapeAndUpdateJobListing } from "./jobListings.js";
import { findJobListingOrSend404 } from "./_helpers.js";

const router = Router();

/**
 * In-memory state for tracking the batch apply process.
 * Only one batch process can run at a time.
 */
interface BatchApplyState {
  isRunning: boolean;
  currentJobId: number | null;
  completed: number[];
  errors: Array<{ jobId: number; error: string }>;
  totalJobs: number;
}

let batchState: BatchApplyState = {
  isRunning: false,
  currentJobId: null,
  completed: [],
  errors: [],
  totalJobs: 0,
};

/**
 * Reads the user info JSON file from the scripts directory.
 * @returns {Promise<UserInfo>} The parsed user info
 */
async function readUserInfo(): Promise<UserInfo> {
  const userInfoPath = resolve(__dirname, "../scripts/user_info.json");
  const userInfoJson = await readFile(userInfoPath, "utf-8");
  return JSON.parse(userInfoJson) as UserInfo;
}

/**
 * Reads the Browser Use profile ID from environment variables.
 * @returns {string} The profile ID
 * @throws {Error} If the profile ID is not set
 */
function getProfileId(): string {
  const profileId = process.env["BROWSER_USE_PROFILE_ID"];
  const isMissing = !profileId;
  if (isMissing) {
    throw new Error("BROWSER_USE_PROFILE_ID environment variable is not set. Add it to your .env file.");
  }
  return profileId;
}

/**
 * Loads the user info file and the Browser Use profile id, returning both on success.
 * Sends a 400 response and returns null when either fails so the caller can early-exit.
 * @param {Response} res - The response (used to write 400 on error)
 * @param {string} logTag - Prefix for the error log line (e.g., "applicator:route")
 * @returns {Promise<{ userInfo: UserInfo; profileId: string } | null>} The loaded values or null on error
 */
async function loadConfigOrSend400(
  res: Response,
  logTag: string
): Promise<{ userInfo: UserInfo; profileId: string } | null> {
  try {
    const userInfo = await readUserInfo();
    const profileId = getProfileId();
    return { userInfo, profileId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[${logTag}] Config error: ${errorMessage}`);
    res.status(400).json({ error: errorMessage });
    return null;
  }
}

/**
 * POST /api/job-listings/:id/apply
 * Starts the application process for a single job listing.
 * Sets the job status to "applying" and kicks off the Browser Use agent in the background.
 * Returns 202 immediately while the application runs asynchronously.
 * @param {number} req.params.id - The ID of the job listing to apply to
 * @returns {object} 202 - The job listing with status "applying"
 * @returns {object} 400 - Invalid id, job not in "init" status, or missing config
 * @returns {object} 404 - Job listing not found
 */
router.post("/:id/apply", async (req: Request, res: Response) => {
  const jobListing = await findJobListingOrSend404(req, res);
  if (jobListing === null) {
    return;
  }

  const isNotReadyToApply = jobListing.status !== "init" && jobListing.status !== "error_applying";
  if (isNotReadyToApply) {
    res.status(400).json({ error: `Job listing has status "${jobListing.status}" and cannot be applied to. Only "init" or "error_applying" jobs can be applied to.` });
    return;
  }

  const config = await loadConfigOrSend400(res, "applicator:route");
  if (config === null) {
    return;
  }

  console.log(`[applicator:route] Starting application for job ${String(jobListing.id)}: ${jobListing.url}`);

  const updatedListing = await prisma.jobListing.update({
    where: { id: jobListing.id },
    data: { status: "applying", live_url: null },
  });

  res.status(202).json(updatedListing);

  applyToSingleJob(jobListing.id, jobListing.url, config.userInfo, config.profileId).catch(() => {
    /* error already handled inside */
  });
});

/**
 * Runs the application process for a single job listing. Updates the database
 * with the live URL during the process and sets the final status.
 * @param {number} jobId - The ID of the job listing
 * @param {string} jobUrl - The URL of the job listing
 * @param {UserInfo} userInfo - The user's personal information
 * @param {string} profileId - The Browser Use profile ID
 */
async function applyToSingleJob(
  jobId: number,
  jobUrl: string,
  userInfo: UserInfo,
  profileId: string,
): Promise<void> {
  try {
    const handleLiveUrlReady = async (liveUrl: string) => {
      await prisma.jobListing.update({
        where: { id: jobId },
        data: { live_url: liveUrl },
      });
    };

    const result = await applyToJob(jobUrl, userInfo, profileId, handleLiveUrlReady, jobId);

    let finalStatus: "applied" | "error_applying" | "closed";
    if (result.closedListing) {
      finalStatus = "closed";
    } else if (result.success) {
      finalStatus = "applied";
    } else {
      finalStatus = "error_applying";
    }
    console.log(`[applicator:route] Job ${jobId} application result: ${finalStatus}`);
    await prisma.jobListing.update({
      where: { id: jobId },
      data: { status: finalStatus, live_url: null },
    });

    await saveAttemptLog(jobId, result);

    // Enrich the job listing with title/description if not already filled
    if (result.success) {
      await enrichJobListingDetails(jobId, jobUrl);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[applicator:route] Application failed for job ${jobId}: ${errorMessage}`);
    await prisma.jobListing.update({
      where: { id: jobId },
      data: { status: "error_applying", live_url: null },
    });

    await saveAttemptLog(jobId, { message: errorMessage });
  }
}

/**
 * Enriches a job listing with title, description, and post date by scraping the URL.
 * Only scrapes if the job listing currently has no title (empty string).
 * Runs in the background — failures are logged but do not affect application status.
 * @param {number} jobId - The job listing ID
 * @param {string} jobUrl - The job listing URL to scrape
 */
async function enrichJobListingDetails(jobId: number, jobUrl: string): Promise<void> {
  try {
    const jobListing = await prisma.jobListing.findUnique({ where: { id: jobId } });
    const alreadyHasTitle = !!jobListing?.title;
    if (alreadyHasTitle) {
      console.log(`[applicator:route] Job ${jobId} already has title, skipping enrichment`);
      return;
    }

    console.log(`[applicator:route] Enriching job ${jobId} details via scraping: ${jobUrl}`);

    const parsedUrl = new URL(jobUrl);
    const isLinkedInUrl = parsedUrl.hostname === "linkedin.com" || parsedUrl.hostname.endsWith(".linkedin.com");
    const credentialsPath = isLinkedInUrl
      ? resolve(__dirname, "../scripts/linkedin_credentials.json")
      : null;

    await scrapeAndUpdateJobListing(jobId, jobUrl, credentialsPath);
    console.log(`[applicator:route] Job ${jobId} details enriched successfully`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[applicator:route] Failed to enrich job ${jobId} details: ${errorMessage}`);
  }
}

/**
 * Persists an application attempt log to the database.
 * Saves the step logs (if available) and the final response message.
 * @param {number} jobId - The job listing ID
 * @param {object} result - The application result containing message and optional stepLogs
 */
async function saveAttemptLog(
  jobId: number,
  result: { message: string; stepLogs?: StepLog[] },
): Promise<void> {
  try {
    const logsJson = JSON.stringify(result.stepLogs ?? []);
    await prisma.applicationAttemptLogs.create({
      data: {
        job_listing_id: jobId,
        logs: logsJson,
        end_response: result.message,
      },
    });
    console.log(`[applicator:route] Attempt log saved for job ${jobId}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[applicator:route] Failed to save attempt log for job ${jobId}: ${errorMessage}`);
  }
}

/**
 * POST /api/job-listings/apply-batch
 * Starts the batch application process for all job listings with status "init".
 * Processes jobs one at a time sequentially. Only one batch can run at a time.
 * @returns {object} 202 - Batch started with initial status
 * @returns {object} 409 - A batch is already running
 * @returns {object} 400 - Missing config or no jobs to apply to
 */
router.post("/apply-batch", async (_req: Request, res: Response) => {
  const isBatchAlreadyRunning = batchState.isRunning;
  if (isBatchAlreadyRunning) {
    res.status(409).json({ error: "A batch application process is already running" });
    return;
  }

  const config = await loadConfigOrSend400(res, "applicator:batch");
  if (config === null) {
    return;
  }
  const { userInfo, profileId } = config;

  const eligibleJobs = await prisma.jobListing.findMany({
    where: { status: "init" },
    orderBy: { created_date: "asc" },
  });

  const hasNoEligibleJobs = eligibleJobs.length === 0;
  if (hasNoEligibleJobs) {
    res.status(400).json({ error: "No job listings with status 'init' to apply to" });
    return;
  }

  batchState = {
    isRunning: true,
    currentJobId: null,
    completed: [],
    errors: [],
    totalJobs: eligibleJobs.length,
  };

  res.status(202).json({
    message: `Batch application started for ${eligibleJobs.length} jobs`,
    totalJobs: eligibleJobs.length,
  });

  runBatchApply(eligibleJobs, userInfo, profileId).catch(() => {
    /* error already handled inside */
  });
});

/**
 * Processes a batch of job listings one at a time, applying to each sequentially.
 * Updates the batchState as each job is processed.
 * @param {Array<{ id: number; url: string }>} jobs - The jobs to apply to
 * @param {UserInfo} userInfo - The user's personal information
 * @param {string} profileId - The Browser Use profile ID
 */
async function runBatchApply(
  jobs: Array<{ id: number; url: string }>,
  userInfo: UserInfo,
  profileId: string,
): Promise<void> {
  console.log(`[applicator:batch] ════════════════════════════════════════════`);
  console.log(`[applicator:batch] Starting batch apply for ${jobs.length} jobs`);
  console.log(`[applicator:batch] ════════════════════════════════════════════`);

  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];
    batchState.currentJobId = job.id;

    console.log(`[applicator:batch] Processing job ${job.id} (${index + 1}/${jobs.length}): ${job.url}`);

    await prisma.jobListing.update({
      where: { id: job.id },
      data: { status: "applying", live_url: null },
    });

    try {
      const handleLiveUrlReady = async (liveUrl: string) => {
        await prisma.jobListing.update({
          where: { id: job.id },
          data: { live_url: liveUrl },
        });
      };

      const result = await applyToJob(job.url, userInfo, profileId, handleLiveUrlReady, job.id);

      let finalStatus: "applied" | "error_applying" | "closed";
      if (result.closedListing) {
        finalStatus = "closed";
      } else if (result.success) {
        finalStatus = "applied";
      } else {
        finalStatus = "error_applying";
      }
      console.log(`[applicator:batch] Job ${job.id} result: ${finalStatus}`);
      await prisma.jobListing.update({
        where: { id: job.id },
        data: { status: finalStatus, live_url: null },
      });

      await saveAttemptLog(job.id, result);

      if (result.success) {
        batchState.completed.push(job.id);
        await enrichJobListingDetails(job.id, job.url);
      } else {
        batchState.errors.push({ jobId: job.id, error: result.message });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[applicator:batch] Job ${job.id} failed: ${errorMessage}`);
      await prisma.jobListing.update({
        where: { id: job.id },
        data: { status: "error_applying", live_url: null },
      });
      await saveAttemptLog(job.id, { message: errorMessage });
      batchState.errors.push({ jobId: job.id, error: errorMessage });
    }
  }

  console.log(`[applicator:batch] ════════════════════════════════════════════`);
  console.log(`[applicator:batch] Batch complete: ${batchState.completed.length} succeeded, ${batchState.errors.length} failed`);
  console.log(`[applicator:batch] ════════════════════════════════════════════`);

  batchState.isRunning = false;
  batchState.currentJobId = null;
}

/**
 * GET /api/job-listings/apply-batch/status
 * Returns the current state of the batch application process.
 * @returns {object} 200 - The batch status including isRunning, currentJobId, completed, errors, totalJobs
 */
router.get("/apply-batch/status", (_req: Request, res: Response) => {
  res.json({
    isRunning: batchState.isRunning,
    currentJobId: batchState.currentJobId,
    completed: batchState.completed,
    errors: batchState.errors,
    totalJobs: batchState.totalJobs,
    remaining: batchState.totalJobs - batchState.completed.length - batchState.errors.length,
  });
});

export { router as jobApplicationsRouter, applyToSingleJob, runBatchApply, batchState, readUserInfo, getProfileId };
