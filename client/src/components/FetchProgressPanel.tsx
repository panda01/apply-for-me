import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, LinearProgress, Paper, Typography } from "@mui/material";
import { Refresh as RefreshIcon } from "@mui/icons-material";
import {
  getLiveUrlResolution,
  RESOLUTION_PHASE_LABELS,
  StepStatus,
  type LiveProgress,
  type LiveStep,
} from "../services/jobListingsApi";

interface FetchProgressPanelProps {
  /** The parsed job listing ID. NaN renders nothing (mirrors the JobViewPage invalid-id branch). */
  jobId: number;
  /** True while the page should be showing fetch progress (isFetchingData OR jobListing.resolution_in_progress). */
  isActive: boolean;
  /**
   * The latest resolution log id that existed BEFORE this fetch was initiated.
   * Any polled payload whose `logId` is ≤ this value is treated as stale and
   * ignored — the panel stays in "Starting…" until a new log row appears with
   * a higher id. This breaks the race where the user clicks Retry on a crashed
   * row, the panel remounts and polls immediately, and the server returns the
   * stale crashed terminal because the background scraper hasn't inserted the
   * new log row yet. Null disables the filter (used on the initial mount when
   * there is no prior log).
   */
  sinceLogId: number | null;
  /** Called when the user clicks "Retry Fetch Data" on the crashed-state Alert. */
  onRetry: () => void;
}

const POLL_INTERVAL_MS = 1500;
const TICK_INTERVAL_MS = 1000;

/**
 * Maps a {@link StepStatus} value to a MUI Chip color. Pure helper exported for
 * test reuse.
 *
 * @param {StepStatus} status - The status of the current live step
 * @returns {"default" | "info" | "success" | "error"} The Chip color
 */
export function colorForStepStatus(status: StepStatus): "default" | "info" | "success" | "error" {
  switch (status) {
    case StepStatus.Running: return "info";
    case StepStatus.Succeeded: return "success";
    case StepStatus.Failed: return "error";
    case StepStatus.Skipped: return "default";
  }
}

/**
 * Formats elapsed milliseconds as a zero-padded `MM:SS` string. Negative values
 * clamp to 0; very long runs (>= 100 minutes) render with their literal minute
 * count (no overflow handling needed for this UI's use case).
 *
 * @param {number} elapsedMs - Elapsed milliseconds since the panel mounted
 * @returns {string} `MM:SS` formatted text
 */
export function formatElapsedMmSs(elapsedMs: number): string {
  const clampedMs = elapsedMs < 0 ? 0 : elapsedMs;
  const totalSeconds = Math.floor(clampedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");
  return `${paddedMinutes}:${paddedSeconds}`;
}

/**
 * Returns the most recent step from a {@link LiveProgress} payload, or null
 * when the payload is null or the steps array is empty. Used by the live-render
 * branch to pick the "current step" the user sees.
 *
 * @param {LiveProgress | null} progress - The live progress payload (or null)
 * @returns {LiveStep | null} The last step, or null when not available
 */
export function deriveCurrentStep(progress: LiveProgress | null): LiveStep | null {
  if (progress === null) return null;
  const hasNoSteps = progress.steps.length === 0;
  if (hasNoSteps) return null;
  return progress.steps[progress.steps.length - 1];
}

/**
 * Detects the server-synthesized "crashed terminal" payload. The
 * /url-resolution/live endpoint returns `isFinished: true, finalOutcome: null`
 * when the container hosting the resolver progress map could not be reached,
 * with `reason` carrying a human-readable explanation.
 *
 * @param {LiveProgress | null} progress - The live progress payload
 * @returns {boolean} True iff this payload represents a crashed terminal
 */
export function isCrashedTerminal(progress: LiveProgress | null): boolean {
  if (progress === null) return false;
  return progress.isFinished === true && progress.finalOutcome === null;
}

/**
 * Inline progress panel rendered on JobViewPage while the Fetch Data flow is
 * running (or the page is loaded mid-fetch). Polls `/url-resolution/live`
 * every {@link POLL_INTERVAL_MS} ms and updates an elapsed-time counter every
 * {@link TICK_INTERVAL_MS} ms. Four render branches:
 *
 *   1. Inactive (isActive=false OR jobId NaN) — renders nothing.
 *   2. Starting — progress is null or has no steps; shows "Starting…" plus a spinner.
 *   3. Live — at least one step; shows phase Chip + message + step counter + LinearProgress.
 *   4. Crashed — server reports isFinished=true with finalOutcome=null; shows an Alert with the reason and a Retry button.
 *
 * Non-404 fetch errors are silently swallowed so a transient blip keeps the
 * last successful payload on screen rather than flashing an Alert.
 *
 * @param {FetchProgressPanelProps} props - Component props
 * @returns {JSX.Element | null} The rendered panel, or null when inactive
 */
function FetchProgressPanel({ jobId, isActive, sinceLogId, onRetry }: FetchProgressPanelProps) {
  const [progress, setProgress] = useState<LiveProgress | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isInvalidJobId = Number.isNaN(jobId);

  /**
   * Fetches the live progress payload once. Silently keeps the prior progress
   * state on any non-404 error so transient network blips don't flash an Alert
   * over the last good frame. A 404-equivalent response surfaces as
   * `getLiveUrlResolution` returning null (no log row yet — show "Starting…").
   *
   * Drops payloads whose `logId` is ≤ {@link sinceLogId} as stale (used to
   * filter out the prior crashed log on Retry before the new background
   * scraper has inserted its log row).
   */
  const fetchProgress = useCallback(async () => {
    try {
      const data = await getLiveUrlResolution(jobId);
      const isStaleLog = data !== null && sinceLogId !== null && data.logId <= sinceLogId;
      if (isStaleLog) {
        // Keep progress as-is (null on the first poll → renders "Starting…").
        // Do NOT set the stale payload, do NOT stop polling — wait for the
        // new log row to appear.
        return;
      }
      setProgress(data);
    } catch {
      // Silent swallow — the next poll will likely succeed and overwrite.
    }
  }, [jobId, sinceLogId]);

  /**
   * Tears down both intervals if they are running. Used by every cleanup path:
   * unmount, isActive flip to false, and reaching a terminal payload.
   */
  const stopAllIntervals = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (tickIntervalRef.current !== null) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    const shouldRunPolling = isActive && !isInvalidJobId;
    if (!shouldRunPolling) {
      stopAllIntervals();
      setProgress(null);
      return;
    }

    setStartedAtMs(Date.now());
    setNowMs(Date.now());
    fetchProgress();
    pollIntervalRef.current = setInterval(() => { void fetchProgress(); }, POLL_INTERVAL_MS);
    tickIntervalRef.current = setInterval(() => { setNowMs(Date.now()); }, TICK_INTERVAL_MS);

    return () => {
      stopAllIntervals();
    };
  }, [isActive, isInvalidJobId, fetchProgress, stopAllIntervals]);

  // Stop polling on a terminal payload — the parent will flip isActive shortly,
  // but the in-flight interval would otherwise keep hitting the endpoint until
  // the parent's poll detects the title and tears the panel down.
  useEffect(() => {
    if (progress === null) return;
    if (progress.isFinished === false) return;
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, [progress]);

  if (!isActive || isInvalidJobId) {
    return null;
  }

  const isCrashed = isCrashedTerminal(progress);
  const currentStep = deriveCurrentStep(progress);
  const isStarting = currentStep === null && !isCrashed;
  const elapsedText = formatElapsedMmSs(nowMs - startedAtMs);
  const isRunStillFinishing = progress === null || progress.isFinished === false;

  return (
    <Paper elevation={1} sx={{ p: 2, mb: 3 }} data-testid="fetch-progress-panel">
      {isCrashed && progress !== null && (
        <Box data-testid="fetch-progress-crashed">
          <Alert severity="error" sx={{ mb: 1 }}>
            {progress.reason !== null && progress.reason.length > 0
              ? progress.reason
              : "The resolver attempt did not finish."}
          </Alert>
          <Button
            variant="contained"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={onRetry}
            data-testid="fetch-progress-retry-button"
          >
            Retry Fetch Data
          </Button>
        </Box>
      )}

      {isStarting && (
        <Box data-testid="fetch-progress-starting" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2">Starting…</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }} data-testid="fetch-progress-elapsed">
              {elapsedText}
            </Typography>
          </Box>
          <LinearProgress data-testid="fetch-progress-bar" />
        </Box>
      )}

      {currentStep !== null && !isCrashed && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Chip
              size="small"
              color={colorForStepStatus(currentStep.status)}
              label={RESOLUTION_PHASE_LABELS[currentStep.phase]}
              data-testid="fetch-progress-phase-chip"
            />
            <Typography variant="caption" color="text.secondary" data-testid="fetch-progress-step-counter">
              Step {String(currentStep.stepIndex + 1)} of {String(progress?.steps.length ?? 0)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }} data-testid="fetch-progress-elapsed">
              {elapsedText}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" data-testid="fetch-progress-message">
            {currentStep.message}
          </Typography>
          {isRunStillFinishing && <LinearProgress data-testid="fetch-progress-bar" />}
        </Box>
      )}
    </Paper>
  );
}

export default FetchProgressPanel;
