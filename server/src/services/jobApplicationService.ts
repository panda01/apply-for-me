import { BrowserUse } from "browser-use-sdk";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Service module that handles applying to job listings via the Browser Use agent API (v2).
 * Uses a personal browser profile for persistent login state and flashMode: false
 * for careful, slow navigation during the application process.
 *
 * Logs real-time step-by-step progress, classifies steps into 4 phases,
 * detects captcha/stuck issues, and saves screenshots to a logs directory.
 */

/**
 * User information used to fill out job application forms.
 */
export interface UserInfo {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  phone: string;
  github: string;
  linkedin: string;
  website: string;
  resumeUrl: string;
}

/**
 * Result returned after attempting to apply to a job.
 */
export interface ApplicationResult {
  success: boolean;
  message: string;
  logDirectory?: string;
  stepLogs?: StepLog[];
  closedListing?: boolean;
}

/**
 * Represents a classified phase of the application process.
 */
export interface ApplicationPhase {
  phase: 1 | 2 | 3 | 4;
  label: string;
}

/**
 * A single step captured during the application process for the run summary.
 */
export interface StepLog {
  stepNumber: number;
  phase: number;
  phaseLabel: string;
  url: string;
  nextGoal: string;
  actions: string[];
  screenshotSaved: boolean;
  captchaDetected: boolean;
  stuckDetected: boolean;
  timestamp: string;
}

// ─── Phase Classification ────────────────────────────────────────────────────

const APPLY_KEYWORDS = /apply|easy\s*apply|submit\s*application|start\s*application/i;
const FORM_KEYWORDS = /fill|input|type|select|enter|upload|attach|resume|cover\s*letter|phone|email|name|experience|education/i;
const SUBMIT_KEYWORDS = /submit|confirm|send\s*application|review\s*application|finish/i;
const CAPTCHA_KEYWORDS = /captcha|verify\s*you\s*are|robot|challenge|human\s*verification|are\s*you\s*a\s*human/i;
const CLOSED_KEYWORDS = /no longer accepting|applications?\s*closed|position has been filled|job has been removed|listing has expired|no longer available|this job is closed/i;

/**
 * Classifies a Browser Use step into one of the 4 application phases.
 * Phase only advances forward (never goes backward from the previous phase).
 * @param {object} step - The step data from Browser Use (nextGoal, url, actions)
 * @param {string} jobUrl - The original job listing URL
 * @param {number} previousPhase - The phase of the previous step (minimum for this step)
 * @returns {ApplicationPhase} The classified phase
 */
export function classifyApplicationPhase(
  step: { nextGoal: string; url: string; actions: string[] },
  jobUrl: string,
  previousPhase: number
): ApplicationPhase {
  const combinedText = `${step.nextGoal} ${step.actions.join(" ")}`;

  let detectedPhase = 1;

  const isSubmitStep = SUBMIT_KEYWORDS.test(combinedText);
  if (isSubmitStep) {
    detectedPhase = 4;
  } else {
    const isFormStep = FORM_KEYWORDS.test(combinedText);
    if (isFormStep) {
      detectedPhase = 3;
    } else {
      const isApplyStep = APPLY_KEYWORDS.test(combinedText);
      if (isApplyStep) {
        detectedPhase = 2;
      }
    }
  }

  const phaseNeverGoesBackward = Math.max(detectedPhase, previousPhase) as 1 | 2 | 3 | 4;

  const phaseLabels: Record<number, string> = {
    1: "Opening job URL",
    2: "Following apply links",
    3: "Filling out form",
    4: "Submitting application",
  };

  return {
    phase: phaseNeverGoesBackward,
    label: phaseLabels[phaseNeverGoesBackward],
  };
}

// ─── Captcha / Stuck Detection ───────────────────────────────────────────────

/**
 * Checks a step for captcha presence and detects if the agent is stuck on the same URL.
 * A step is considered "idle" (counting toward stuck) only if it has no actions — steps
 * where the agent is actively performing actions (typing, clicking, etc.) are not stuck.
 * @param {object} step - The step data from Browser Use (nextGoal, memory, url, actions)
 * @param {number} idleSameUrlCount - How many consecutive idle steps have been on the same URL
 * @returns {{ isCaptcha: boolean; isStuck: boolean }} Detection results
 */
export function detectCaptchaOrStuck(
  step: { nextGoal: string; memory: string; url: string; actions: string[] },
  idleSameUrlCount: number
): { isCaptcha: boolean; isStuck: boolean } {
  const combinedText = `${step.nextGoal} ${step.memory}`;
  const isCaptcha = CAPTCHA_KEYWORDS.test(combinedText);

  const stuckThreshold = 3;
  const isStuck = idleSameUrlCount >= stuckThreshold;

  return { isCaptcha, isStuck };
}

/**
 * Checks if a step indicates the job listing is no longer accepting applications.
 * @param {object} step - The step data from Browser Use (nextGoal, memory)
 * @returns {boolean} True if the listing appears to be closed
 */
export function detectClosedListing(
  step: { nextGoal: string; memory: string }
): boolean {
  const combinedText = `${step.nextGoal} ${step.memory}`;
  return CLOSED_KEYWORDS.test(combinedText);
}

// ─── File I/O Helpers ────────────────────────────────────────────────────────

/**
 * Creates the log directory for a specific application run.
 * @param {number | string} jobId - The job ID or URL slug for the directory name
 * @returns {Promise<string>} The absolute path to the created log directory
 */
export async function ensureLogDirectory(jobId: number | string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dirName = `${jobId}-${timestamp}`;
  const logDir = resolve(process.cwd(), "logs", dirName);
  await mkdir(logDir, { recursive: true });
  console.log(`[applicator] Log directory created: ${logDir}`);
  return logDir;
}

/**
 * Downloads a screenshot from a URL and saves it to the log directory.
 * Fails silently with a warning if the download fails.
 * @param {string} screenshotUrl - The URL to download the screenshot from
 * @param {string} logDir - The directory to save the screenshot to
 * @param {number} stepNumber - The step number for the filename
 */
export async function saveStepScreenshot(
  screenshotUrl: string,
  logDir: string,
  stepNumber: number
): Promise<void> {
  try {
    const response = await fetch(screenshotUrl);
    const isNotOk = !response.ok;
    if (isNotOk) {
      console.warn(`[applicator] Failed to download screenshot for step ${stepNumber}: HTTP ${response.status}`);
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = resolve(logDir, `step-${stepNumber}.png`);
    await writeFile(filePath, buffer);
    console.log(`[applicator] Screenshot saved: step-${stepNumber}.png`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[applicator] Error saving screenshot for step ${stepNumber}: ${errorMessage}`);
  }
}

/**
 * Saves a JSON summary of all steps from the application run.
 * @param {string} logDir - The directory to save the summary to
 * @param {StepLog[]} steps - The step data collected during the run
 * @param {string} taskId - The Browser Use task ID
 * @param {string} jobUrl - The job listing URL
 * @param {ApplicationResult} result - The final application result
 */
export async function saveRunSummary(
  logDir: string,
  steps: StepLog[],
  taskId: string,
  jobUrl: string,
  result: ApplicationResult
): Promise<void> {
  try {
    const summary = {
      taskId,
      jobUrl,
      result,
      totalSteps: steps.length,
      steps,
      completedAt: new Date().toISOString(),
    };
    const filePath = resolve(logDir, "run-summary.json");
    await writeFile(filePath, JSON.stringify(summary, null, 2));
    console.log("[applicator] Run summary saved: run-summary.json");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[applicator] Error saving run summary: ${errorMessage}`);
  }
}

/**
 * Fetches the task execution log from Browser Use and saves it to the log directory.
 * @param {BrowserUse} client - The Browser Use client
 * @param {string} taskId - The task ID
 * @param {string} logDir - The directory to save the log to
 */
async function saveTaskLog(
  client: BrowserUse,
  taskId: string,
  logDir: string
): Promise<void> {
  try {
    const logFile = await client.tasks.logs(taskId);
    const logUrl = (logFile as { url?: string }).url;
    const hasLogUrl = !!logUrl;
    if (hasLogUrl) {
      const response = await fetch(logUrl);
      const logText = await response.text();
      const filePath = resolve(logDir, "task-log.txt");
      await writeFile(filePath, logText);
      console.log("[applicator] Task log saved: task-log.txt");
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[applicator] Error saving task log: ${errorMessage}`);
  }
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

/**
 * Builds the prompt that instructs the Browser Use agent to apply to a job.
 * Includes the user's personal information so the agent can fill out application forms.
 * @param {string} jobUrl - The URL of the job listing to apply to
 * @param {UserInfo} userInfo - The user's personal information for filling out forms
 * @returns {string} The full prompt for the Browser Use agent
 */
function buildApplicationPrompt(jobUrl: string, userInfo: UserInfo): string {
  return `Navigate to ${jobUrl}. Your goal is to apply to this job listing.

  Look for buttons or links that indicate applying to the job, such as "Apply", "Easy Apply", "Submit Application", or similar. Click through those links to get to the application form.

Fill out the application form with the following information:
- First Name: ${userInfo.firstName}
- Middle Name: ${userInfo.middleName}
- Last Name: ${userInfo.lastName}
- Full Name: ${userInfo.firstName} ${userInfo.middleName} ${userInfo.lastName}
- Email: ${userInfo.email}
- Phone: ${userInfo.phone}
- LinkedIn: ${userInfo.linkedin}
- GitHub: ${userInfo.github}
- Website/Portfolio: ${userInfo.website}
- Resume URL: ${userInfo.resumeUrl}

If the form asks to upload a resume, upload the file from the provided resume URL. If a field is optional and you don't have the information, skip it. If there are multiple steps in the application, complete all of them.

If the job listing says it is no longer accepting applications, or the position is closed/filled/expired, stop immediately and report that the listing is closed.

Proceed carefully through each step. After submitting the application, confirm that it was submitted successfully.`;
}

// ─── Live URL Notification ───────────────────────────────────────────────────

/**
 * Waits for a TaskRun's taskId to become available by polling, then fetches
 * the task to get the sessionId, then fetches the session to get the live URL.
 * @param {BrowserUse} client - The Browser Use v2 client instance
 * @param {{ taskId: string | null }} taskRun - The TaskRun object with a taskId getter
 * @param {((liveUrl: string) => void) | undefined} onLiveUrlReady - Optional callback invoked with the live URL
 */
async function notifyLiveUrl(
  client: BrowserUse,
  taskRun: { taskId: string | null },
  onLiveUrlReady?: (liveUrl: string) => void
): Promise<void> {
  const hasNoCallback = !onLiveUrlReady;
  if (hasNoCallback) return;

  const maxWaitMs = 15000;
  const pollIntervalMs = 200;
  let elapsedMs = 0;

  const isTaskIdPending = () => taskRun.taskId === null && elapsedMs < maxWaitMs;
  while (isTaskIdPending()) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    elapsedMs += pollIntervalMs;
  }

  const hasTaskId = taskRun.taskId !== null;
  if (!hasTaskId) {
    console.warn("[applicator] Task ID not available within timeout, cannot fetch live URL");
    return;
  }

  try {
    const task = await client.tasks.get(taskRun.taskId!);
    const session = await client.sessions.get(task.sessionId);
    const hasLiveUrl = !!session.liveUrl;
    if (hasLiveUrl) {
      onLiveUrlReady(session.liveUrl!);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[applicator] Failed to fetch live URL for application session: ${errorMessage}`);
  }
}

// ─── Main Application Function ───────────────────────────────────────────────

/**
 * Uses the Browser Use agent (v2 SDK) to navigate to a job listing page and submit
 * an application on behalf of the user. Uses flashMode: false for careful/slow navigation
 * and a persistent browser profile for login state.
 *
 * Iterates through each agent step in real-time, classifying into 4 phases:
 *   1. Opening job URL
 *   2. Following apply links
 *   3. Filling out form
 *   4. Submitting application
 *
 * Detects captcha and stuck conditions. Saves screenshots and a run summary to logs/.
 *
 * @param {string} jobUrl - The job listing URL to apply to
 * @param {UserInfo} userInfo - The user's personal information for the application
 * @param {string} profileId - The Browser Use profile ID for persistent browser state
 * @param {((liveUrl: string) => void)} [onLiveUrlReady] - Optional callback invoked with the live view URL once the session starts
 * @param {number | string} [jobId] - Optional job ID used for naming the log directory
 * @returns {Promise<ApplicationResult>} Whether the application was successful
 * @throws {Error} If the BROWSER_USE_API environment variable is missing or the application process fails
 */
export async function applyToJob(
  jobUrl: string,
  userInfo: UserInfo,
  profileId: string,
  onLiveUrlReady?: (liveUrl: string) => void,
  jobId?: number | string
): Promise<ApplicationResult> {
  console.log(`[applicator] ════════════════════════════════════════════════`);
  console.log(`[applicator] Starting application for job ${jobId ?? "unknown"}: ${jobUrl}`);
  console.log(`[applicator] ════════════════════════════════════════════════`);

  const apiKey = process.env["BROWSER_USE_API"];
  const isMissingApiKey = !apiKey;
  if (isMissingApiKey) {
    throw new Error("BROWSER_USE_API environment variable is not set. Add it to your .env file.");
  }

  const client = new BrowserUse({ apiKey });
  let taskId: string | undefined;
  let logDir: string | undefined;

  try {
    logDir = await ensureLogDirectory(jobId ?? "unknown");

    const applicationPrompt = buildApplicationPrompt(jobUrl, userInfo);
    console.log(`[applicator] [Phase 1/4] Opening job URL: ${jobUrl}`);

    const applicationRun = client.run(applicationPrompt, {
      flashMode: false,
      sessionSettings: {
        profileId,
        proxyCountryCode: "us",
      },
    });

    await notifyLiveUrl(client, applicationRun, onLiveUrlReady);

    // ── Real-time step iteration ──────────────────────────────────────
    let currentPhase = 1;
    let lastUrl = "";
    let idleSameUrlCount = 0;
    const stepLogs: StepLog[] = [];

    for await (const step of applicationRun) {
      const phase = classifyApplicationPhase(step, jobUrl, currentPhase);

      // Track idle-same-URL count: only steps with NO actions on the same URL count as idle.
      // Steps with actions (typing, clicking, etc.) mean the agent is making progress.
      const isOnSameUrl = step.url === lastUrl;
      const hasActions = step.actions.length > 0;
      if (isOnSameUrl && !hasActions) {
        idleSameUrlCount++;
      } else if (!isOnSameUrl) {
        idleSameUrlCount = 0;
      }
      // If on same URL but has actions, keep the idle count unchanged (not incrementing, not resetting)

      const detection = detectCaptchaOrStuck(step, idleSameUrlCount);
      const isClosedListing = detectClosedListing(step);

      if (isClosedListing) {
        console.log(`[applicator] ════════════════════════════════════════════════`);
        console.log(`[applicator] CLOSED: job listing is no longer accepting applications`);
        console.log(`[applicator]   Detected at step ${step.number}: ${step.nextGoal}`);
        console.log(`[applicator] ════════════════════════════════════════════════`);
        const hasClosedScreenshot = !!step.screenshotUrl;
        if (hasClosedScreenshot) {
          await saveStepScreenshot(step.screenshotUrl!, logDir, step.number);
        }
        stepLogs.push({
          stepNumber: step.number, phase: phase.phase, phaseLabel: phase.label,
          url: step.url, nextGoal: step.nextGoal, actions: step.actions,
          screenshotSaved: hasClosedScreenshot, captchaDetected: false,
          stuckDetected: false, timestamp: new Date().toISOString(),
        });
        const closedResult: ApplicationResult = {
          success: false,
          closedListing: true,
          message: `Job listing is no longer accepting applications (detected at step ${step.number})`,
          logDirectory: logDir,
          stepLogs,
        };
        await saveRunSummary(logDir, stepLogs, taskId ?? "unknown", jobUrl, closedResult);
        return closedResult;
      }

      const phaseChanged = phase.phase > currentPhase;
      if (phaseChanged) {
        console.log(`[applicator] ────────────────────────────────────────────`);
        console.log(`[applicator] [Phase ${phase.phase}/4] ${phase.label}`);
        console.log(`[applicator] ────────────────────────────────────────────`);
        const hasPhaseScreenshot = !!step.screenshotUrl;
        if (hasPhaseScreenshot) {
          console.log(`[applicator] Phase transition screenshot saving: step-${step.number}.png`);
          await saveStepScreenshot(step.screenshotUrl!, logDir, step.number);
        }
      }

      console.log(`[applicator]   Step ${step.number}: ${step.nextGoal}`);
      console.log(`[applicator]     URL: ${step.url}`);

      if (hasActions) {
        console.log(`[applicator]     Actions: ${step.actions.join(", ")}`);
      }

      if (detection.isCaptcha) {
        console.warn(`[applicator] ⚠ CAPTCHA detected at step ${step.number} on ${step.url}`);
        const hasScreenshot = !!step.screenshotUrl;
        if (hasScreenshot) {
          await saveStepScreenshot(step.screenshotUrl!, logDir, step.number);
        }
      }

      if (detection.isStuck) {
        console.error(`[applicator] ════════════════════════════════════════════════`);
        console.error(`[applicator] STUCK: ${idleSameUrlCount} idle steps on same URL at ${step.url}`);
        console.error(`[applicator] ════════════════════════════════════════════════`);
        const hasStuckScreenshot = !!step.screenshotUrl;
        if (hasStuckScreenshot) {
          await saveStepScreenshot(step.screenshotUrl!, logDir, step.number);
        }

        // Record the final step before aborting
        stepLogs.push({
          stepNumber: step.number,
          phase: phase.phase,
          phaseLabel: phase.label,
          url: step.url,
          nextGoal: step.nextGoal,
          actions: step.actions,
          screenshotSaved: hasStuckScreenshot,
          captchaDetected: detection.isCaptcha,
          stuckDetected: true,
          timestamp: new Date().toISOString(),
        });

        const stuckResult: ApplicationResult = {
          success: false,
          message: `Application got stuck: ${idleSameUrlCount} idle steps on same page (${step.url}) at step ${step.number}`,
          logDirectory: logDir,
          stepLogs,
        };
        await saveRunSummary(logDir, stepLogs, taskId ?? "unknown", jobUrl, stuckResult);

        throw new Error(stuckResult.message);
      }

      const hasScreenshot = !!step.screenshotUrl;
      if (hasScreenshot) {
        await saveStepScreenshot(step.screenshotUrl!, logDir, step.number);
      }

      currentPhase = phase.phase;
      lastUrl = step.url;
      stepLogs.push({
        stepNumber: step.number,
        phase: phase.phase,
        phaseLabel: phase.label,
        url: step.url,
        nextGoal: step.nextGoal,
        actions: step.actions,
        screenshotSaved: hasScreenshot,
        captchaDetected: detection.isCaptcha,
        stuckDetected: false,
        timestamp: new Date().toISOString(),
      });
    }

    // ── Post-iteration: get final result ──────────────────────────────
    const applicationResult = applicationRun.result;
    taskId = applicationResult?.id;

    const isSuccessValue = (applicationResult as Record<string, unknown> | null)?.isSuccess;

    console.log(`[applicator] ════════════════════════════════════════════════`);
    console.log(`[applicator] Application run completed. Total steps: ${stepLogs.length}`);
    console.log(`[applicator] Final status: ${applicationResult?.status ?? "unknown"}`);
    console.log(`[applicator] isSuccess (agent self-report): ${String(isSuccessValue ?? "null")}`);
    console.log(`[applicator] Output: ${applicationResult?.output ?? "(none)"}`);
    console.log(`[applicator] ════════════════════════════════════════════════`);

    // Check if the agent's output indicates the listing is closed
    const outputIndicatesClosedListing = !!applicationResult?.output && CLOSED_KEYWORDS.test(applicationResult.output);
    if (outputIndicatesClosedListing) {
      console.log(`[applicator] CLOSED: agent output indicates listing is no longer accepting applications`);
      const closedResult: ApplicationResult = {
        success: false,
        closedListing: true,
        message: applicationResult!.output!,
        logDirectory: logDir,
        stepLogs,
      };
      await saveRunSummary(logDir, stepLogs, taskId ?? "unknown", jobUrl, closedResult);
      return closedResult;
    }

    // Use browser-use's isSuccess as primary success indicator.
    // Fall back to status check when isSuccess is null/undefined.
    // isSuccess=false → always failure
    // status="stopped" → always failure
    // isSuccess=true → always success
    // status="finished" with isSuccess=null → success (task completed normally)
    const isExplicitSuccess = isSuccessValue === true;
    const isExplicitFailure = isSuccessValue === false;
    const isStatusStopped = applicationResult?.status === "stopped";
    const isStatusFinished = applicationResult?.status === "finished";

    const applicationFailed = isExplicitFailure || isStatusStopped || (!isExplicitSuccess && !isStatusFinished);
    if (applicationFailed) {
      const failMessage = applicationResult?.output
        ?? `Application failed (isSuccess: ${String(isSuccessValue)}, status: ${applicationResult?.status})`;
      const failResult: ApplicationResult = {
        success: false,
        message: failMessage,
        logDirectory: logDir,
        stepLogs,
      };
      await saveRunSummary(logDir, stepLogs, taskId ?? "unknown", jobUrl, failResult);
      return failResult;
    }

    const successResult: ApplicationResult = {
      success: true,
      message: applicationResult?.output ?? "Application submitted successfully",
      logDirectory: logDir,
      stepLogs,
    };

    console.log(`[applicator] Application completed successfully for: ${jobUrl}`);
    await saveRunSummary(logDir, stepLogs, taskId ?? "unknown", jobUrl, successResult);

    return successResult;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[applicator] ════════════════════════════════════════════════`);
    console.error(`[applicator] APPLICATION FAILED for ${jobUrl}: ${errorMessage}`);
    console.error(`[applicator] ════════════════════════════════════════════════`);
    throw err;
  } finally {
    const hasActiveTask = !!taskId;
    if (hasActiveTask) {
      console.log(`[applicator] Stopping task ${taskId}...`);

      if (logDir) {
        await saveTaskLog(client, taskId!, logDir);
      }

      try {
        await client.tasks.stopTaskAndSession(taskId!);
        console.log("[applicator] Task and session stopped");
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[applicator] Failed to stop task: ${errorMessage}`);
      }
    }
  }
}
