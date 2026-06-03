import { Router, Request, Response } from "express";
import prisma from "../prismaClient.js";
import { applyToJob } from "../services/jobApplicationService.js";
import type { UserInfo, WorkAuthorization, ApplicationResult } from "../services/jobApplicationService.js";
import type { ApplicationAttemptOutcome } from "../../prisma/generated/client/enums.js";
import { findJobListingOrSend404 } from "./_helpers.js";
import { getSignedReadUrl, APPLY_URL_TTL_MS } from "../services/gcsStorageService.js";

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
 * Reads the Browser Use profile ID from environment variables. This is the
 * persistent browser-session profile (cookies, logins, etc.), unrelated to
 * the ApplicationProfile row that holds the user's identity for form-fill.
 * @returns {string} The Browser Use profile ID
 * @throws {Error} If the profile ID is not set
 */
function getBrowserUseProfileId(): string {
  const profileId = process.env["BROWSER_USE_PROFILE_ID"];
  const isMissing = !profileId;
  if (isMissing) {
    throw new Error("BROWSER_USE_PROFILE_ID environment variable is not set. Add it to your .env file.");
  }
  return profileId;
}

/**
 * Extracts and validates the applicationProfileId field from a request body.
 * Sends a 400 response when missing or not a positive integer and returns null.
 * @param {Request} req - The request to read the body from
 * @param {Response} res - The response (used to write 400 on error)
 * @returns {number | null} The validated id, or null when an error response has been written
 */
function parseApplicationProfileIdOrSend400(req: Request, res: Response): number | null {
  const body = req.body as { applicationProfileId?: unknown } | undefined;
  const raw = body?.applicationProfileId;
  const isNumber = typeof raw === "number" && Number.isFinite(raw);
  const isPositiveInteger = isNumber && Number.isInteger(raw) && raw > 0;
  if (!isPositiveInteger) {
    res.status(400).json({ error: "Missing or invalid 'applicationProfileId' in request body — pick a profile before applying" });
    return null;
  }
  return raw;
}

/**
 * Loads an ApplicationProfile by id and maps it into the UserInfo shape used
 * by the Browser-Use prompt builder. Returns null when the row is missing so
 * the caller can respond with 400 / "profile not found".
 *
 * The resume and cover-letter PDFs live in Google Cloud Storage; the profile
 * row only stores their object keys. For each present key we generate a fresh,
 * short-lived signed read URL (valid for APPLY_URL_TTL_MS = 24h, i.e. the
 * duration of an apply run) that the Browser-Use agent can fetch directly.
 * When a key is absent, the corresponding URL is null.
 * @param {number} applicationProfileId - The selected ApplicationProfile.id
 * @returns {Promise<UserInfo | null>} The mapped UserInfo (with freshly-signed
 *   GCS resume/cover-letter URLs), or null when the profile is missing
 */
async function loadUserInfoFromProfile(applicationProfileId: number): Promise<UserInfo | null> {
  const profile = await prisma.applicationProfile.findUnique({ where: { id: applicationProfileId } });
  if (profile === null) {
    return null;
  }
  const resumeUrl = profile.resumeStorageKey ? await getSignedReadUrl(profile.resumeStorageKey, APPLY_URL_TTL_MS) : null;
  const coverLetterUrl = profile.coverLetterStorageKey ? await getSignedReadUrl(profile.coverLetterStorageKey, APPLY_URL_TTL_MS) : null;
  return {
    firstName: profile.firstName,
    middleName: profile.middleName,
    lastName: profile.lastName,
    email: profile.email,
    phone: profile.phone,
    github: profile.github,
    linkedin: profile.linkedin,
    website: profile.website,
    resumeUrl,
    coverLetterUrl,
    workAuthorization: profile.workAuthorization as WorkAuthorization | null,
    desiredSalaryMin: profile.desiredSalaryMin,
  };
}

/**
 * Loads the UserInfo for the chosen applicationProfileId plus the Browser Use
 * profile id from the environment. Sends a 400 response and returns null when
 * either lookup fails so the caller can early-exit.
 * @param {Request} req - The request carrying applicationProfileId in the JSON body
 * @param {Response} res - The response (used to write 400 on error)
 * @param {string} logTag - Prefix for the error log line (e.g., "applicator:route")
 * @returns {Promise<{ userInfo: UserInfo; browserUseProfileId: string } | null>} The loaded values or null on error
 */
async function loadConfigOrSend400(
  req: Request,
  res: Response,
  logTag: string
): Promise<{ userInfo: UserInfo; browserUseProfileId: string } | null> {
  const applicationProfileId = parseApplicationProfileIdOrSend400(req, res);
  if (applicationProfileId === null) {
    return null;
  }

  const userInfo = await loadUserInfoFromProfile(applicationProfileId);
  if (userInfo === null) {
    res.status(400).json({ error: `Application profile ${String(applicationProfileId)} not found` });
    return null;
  }

  try {
    const browserUseProfileId = getBrowserUseProfileId();
    return { userInfo, browserUseProfileId };
  } catch (err) {
    // getBrowserUseProfileId only ever throws Error so the cast is safe; no
    // String(err) fallback because there's nowhere for a non-Error to come from.
    const errorMessage = (err as Error).message;
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
 * @param {number} req.body.applicationProfileId - The ApplicationProfile.id whose fields fill the form
 * @returns {object} 202 - The job listing with status "applying"
 * @returns {object} 400 - Invalid id, job not in "init" status, missing applicationProfileId, or missing config
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

  // Application URL gate: the auto-apply flow drives Browser-Use against the
  // application_url (the off-platform form), not the original Indeed/LinkedIn
  // job-details page. If the resolver never found a usable application URL
  // there is no form to fill out, so refuse early with an actionable error.
  const hasNoApplicationUrl = jobListing.application_url === null || jobListing.application_url.length === 0;
  if (hasNoApplicationUrl) {
    res.status(400).json({ error: "Job listing has no application_url. Run POST /:id/fetch to resolve it, or use the Retry button if resolution previously failed." });
    return;
  }

  const config = await loadConfigOrSend400(req, res, "applicator:route");
  if (config === null) {
    return;
  }

  console.log(`[applicator:route] Starting application for job ${String(jobListing.id)}: ${jobListing.application_url}`);

  const updatedListing = await prisma.jobListing.update({
    where: { id: jobListing.id },
    data: { status: "applying", live_url: null },
  });

  res.status(202).json(updatedListing);

  // Narrowing — the hasNoApplicationUrl gate above guarantees non-null at this point.
  applyToSingleJob(jobListing.id, jobListing.application_url!, config.userInfo, config.browserUseProfileId).catch(() => {
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
  // Captured by the Phase-4 one-fire callback; stays null when Phase 4 was never reached
  // (e.g. closed_listing detected early, agent went stuck/captcha, or the agent skipped review).
  let submissionScreenshotPath: string | null = null;

  try {
    const handleLiveUrlReady = async (liveUrl: string) => {
      await prisma.jobListing.update({
        where: { id: jobId },
        data: { live_url: liveUrl },
      });
    };
    const handleSubmissionScreenshotSaved = (filePath: string) => {
      submissionScreenshotPath = filePath;
    };

    const result = await applyToJob(
      jobUrl,
      userInfo,
      profileId,
      handleLiveUrlReady,
      jobId,
      handleSubmissionScreenshotSaved,
    );

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

    await saveAttemptLog(jobId, result, submissionScreenshotPath);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[applicator:route] Application failed for job ${jobId}: ${errorMessage}`);
    await prisma.jobListing.update({
      where: { id: jobId },
      data: { status: "error_applying", live_url: null },
    });

    // Synthetic ApplicationResult so deriveAttemptOutcome can run consistently on the catch path.
    const syntheticResult: ApplicationResult = {
      success: false,
      message: errorMessage,
      stepLogs: [],
    };
    await saveAttemptLog(jobId, syntheticResult, submissionScreenshotPath);
  }
}

/**
 * Maps an ApplicationResult to the terminal ApplicationAttemptOutcome enum value
 * that gets persisted on the ApplicationAttemptLogs row.
 *
 * Precedence (first match wins): closed_listing > captcha_blocked > stuck > applied > failed.
 * closed_listing is checked first because the agent stops early on closed listings —
 * `success` will be false but the more-specific outcome is the useful signal.
 * captcha and stuck are checked before applied because they take precedence over
 * a self-reported success on the same run.
 *
 * @param {ApplicationResult} result - The application result from applyToJob (or a synthetic equivalent on the catch path)
 * @returns {ApplicationAttemptOutcome} The terminal outcome enum value
 */
export function deriveAttemptOutcome(result: ApplicationResult): ApplicationAttemptOutcome {
  if (result.closedListing === true) {
    return "closed_listing";
  }
  const hasCaptcha = result.stepLogs?.some((step) => step.captchaDetected === true) === true;
  if (hasCaptcha) {
    return "captcha_blocked";
  }
  const hasStuck = result.stepLogs?.some((step) => step.stuckDetected === true) === true;
  if (hasStuck) {
    return "stuck";
  }
  if (result.success === true) {
    return "applied";
  }
  return "failed";
}

/**
 * Persists an application attempt log to the database. Derives the terminal
 * outcome enum from the ApplicationResult and stores the canonical Phase-4
 * screenshot path + the per-run logs directory so the UI can stream every
 * step's PNG back to the client.
 *
 * @param {number} jobId - The job listing ID
 * @param {ApplicationResult} result - The application result (use a synthetic { success: false, message } on the catch path so derivation still runs)
 * @param {string | null} submissionScreenshotPath - Absolute path returned by the Phase-4 one-fire callback; null when Phase 4 wasn't reached
 */
async function saveAttemptLog(
  jobId: number,
  result: ApplicationResult,
  submissionScreenshotPath: string | null,
): Promise<void> {
  try {
    const logsJson = JSON.stringify(result.stepLogs ?? []);
    const endResponse = deriveAttemptOutcome(result);
    await prisma.applicationAttemptLogs.create({
      data: {
        job_listing_id: jobId,
        logs: logsJson,
        end_response: endResponse,
        submission_screenshot_path: submissionScreenshotPath,
        log_directory: result.logDirectory ?? null,
      },
    });
    console.log(`[applicator:route] Attempt log saved for job ${jobId} (outcome: ${endResponse})`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[applicator:route] Failed to save attempt log for job ${jobId}: ${errorMessage}`);
  }
}

/**
 * POST /api/job-listings/apply-batch
 * Starts the batch application process for all job listings with status "init".
 * Processes jobs one at a time sequentially. Only one batch can run at a time.
 * @param {number} req.body.applicationProfileId - The ApplicationProfile.id used for every job in the batch
 * @returns {object} 202 - Batch started with initial status
 * @returns {object} 409 - A batch is already running
 * @returns {object} 400 - Missing config, missing applicationProfileId, or no jobs to apply to
 */
router.post("/apply-batch", async (req: Request, res: Response) => {
  const isBatchAlreadyRunning = batchState.isRunning;
  if (isBatchAlreadyRunning) {
    res.status(409).json({ error: "A batch application process is already running" });
    return;
  }

  const config = await loadConfigOrSend400(req, res, "applicator:batch");
  if (config === null) {
    return;
  }
  const { userInfo, browserUseProfileId } = config;

  const eligibleJobs = await prisma.jobListing.findMany({
    where: { status: "init", application_url: { not: null } },
    orderBy: { created_date: "asc" },
  });

  const hasNoEligibleJobs = eligibleJobs.length === 0;
  if (hasNoEligibleJobs) {
    res.status(400).json({ error: "No job listings with status 'init' and a resolved application_url to apply to. Run Fetch Data on the jobs first." });
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

  runBatchApply(eligibleJobs, userInfo, browserUseProfileId).catch(() => {
    /* error already handled inside */
  });
});

/**
 * Processes a batch of job listings one at a time, applying to each sequentially.
 * Updates the batchState as each job is processed. Drives Browser-Use against
 * each row's application_url (the off-platform application form URL) — the
 * batch-eligible filter in the route handler guarantees application_url is set.
 * @param {Array<{ id: number; url: string; application_url: string | null }>} jobs - The jobs to apply to
 * @param {UserInfo} userInfo - The user's personal information
 * @param {string} profileId - The Browser Use profile ID
 */
async function runBatchApply(
  jobs: Array<{ id: number; url: string; application_url: string | null }>,
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

    // Per-iteration screenshot path; stays null when Phase 4 isn't reached on this job.
    let submissionScreenshotPath: string | null = null;

    try {
      const handleLiveUrlReady = async (liveUrl: string) => {
        await prisma.jobListing.update({
          where: { id: job.id },
          data: { live_url: liveUrl },
        });
      };
      const handleSubmissionScreenshotSaved = (filePath: string) => {
        submissionScreenshotPath = filePath;
      };

      // Drive Browser-Use against the resolved application_url (the off-platform
      // form), not the original Indeed/LinkedIn job-details URL. The batch-eligible
      // filter above already ensures application_url is non-null.
      const result = await applyToJob(
        job.application_url!,
        userInfo,
        profileId,
        handleLiveUrlReady,
        job.id,
        handleSubmissionScreenshotSaved,
      );

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

      await saveAttemptLog(job.id, result, submissionScreenshotPath);

      if (result.success) {
        batchState.completed.push(job.id);
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
      const syntheticResult: ApplicationResult = {
        success: false,
        message: errorMessage,
        stepLogs: [],
      };
      await saveAttemptLog(job.id, syntheticResult, submissionScreenshotPath);
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

export { router as jobApplicationsRouter, applyToSingleJob, runBatchApply, batchState, loadUserInfoFromProfile, getBrowserUseProfileId };
