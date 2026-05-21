import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  Container, Typography, Box, Paper, Chip, Divider,
  Accordion, AccordionSummary, AccordionDetails, CircularProgress,
} from "@mui/material";
import { ExpandMore as ExpandMoreIcon } from "@mui/icons-material";
import {
  getLiveUrlResolution,
  getJobListing,
  ApplicationUrlResolutionOutcome,
  StepStatus,
  type LiveProgress,
  type LiveStep,
  type JobListingResponse,
} from "../services/jobListingsApi";
import BackLink from "../components/BackLink";
import LoadingOrErrorPanel from "../components/LoadingOrErrorPanel";

/**
 * How often (ms) the page re-polls the live endpoint while the attempt is
 * still running. Kept tight (1 s) because admins are watching this live; the
 * server's endpoint just proxies a single HTTP read off the local container.
 */
const POLL_INTERVAL_MS = 1000;

/**
 * Maps a step's status to the MUI Chip color that best reflects it.
 *
 * @param {StepStatus} status - The step's terminal or running status
 * @returns {"default" | "info" | "success" | "warning" | "error"} A MUI palette key
 */
function colorForStepStatus(status: StepStatus): "default" | "info" | "success" | "warning" | "error" {
  switch (status) {
    case StepStatus.Running: return "info";
    case StepStatus.Succeeded: return "success";
    case StepStatus.Failed: return "error";
    case StepStatus.Skipped: return "default";
  }
}

/**
 * Maps the resolver's terminal outcome to the chip color shown in the
 * attempt-status banner. Null (still running, or crashed) is treated as
 * warning so it stands out from a clean success.
 *
 * @param {ApplicationUrlResolutionOutcome | null} outcome - Final outcome or null
 * @returns {"default" | "info" | "success" | "warning" | "error"} A MUI palette key
 */
function colorForFinalOutcome(outcome: ApplicationUrlResolutionOutcome | null): "default" | "info" | "success" | "warning" | "error" {
  if (outcome === null) return "warning";
  switch (outcome) {
    case ApplicationUrlResolutionOutcome.Direct: return "success";
    case ApplicationUrlResolutionOutcome.ResolvedViaRedirect: return "success";
    case ApplicationUrlResolutionOutcome.ResolvedViaSearch: return "success";
    case ApplicationUrlResolutionOutcome.ResolvedViaCareersPage: return "success";
    case ApplicationUrlResolutionOutcome.NotFound: return "warning";
  }
}

/**
 * Formats an ISO-string duration window into a "12.3s" style elapsed string.
 * Falls back to "—" when either endpoint is missing.
 *
 * @param {string} startedAt - ISO timestamp of start
 * @param {string | null} finishedAt - ISO timestamp of end (null while running)
 * @returns {string} Human-readable elapsed duration
 */
function formatElapsed(startedAt: string, finishedAt: string | null): string {
  const startMs = Date.parse(startedAt);
  const endMs = finishedAt === null ? Date.now() : Date.parse(finishedAt);
  const isInvalid = !Number.isFinite(startMs) || !Number.isFinite(endMs);
  if (isInvalid) return "—";
  const elapsedMs = Math.max(0, endMs - startMs);
  if (elapsedMs < 1000) return `${String(elapsedMs)}ms`;
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

/**
 * Renders one row in the steps timeline. The row collapses by default and
 * expands to show the raw JSON payload so admins can drill into the request /
 * response details the resolver pushed up.
 *
 * @param {{ step: LiveStep }} props - The step to render
 */
function StepRow({ step }: { step: LiveStep }) {
  const durationText = step.durationMs === null ? "—" : `${String(step.durationMs)}ms`;
  const payloadJson = JSON.stringify(step.payload, null, 2);

  return (
    <Accordion data-testid={`step-row-${String(step.stepIndex)}`} disableGutters sx={{ "&:before": { display: "none" } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: "100%" }}>
          <Typography variant="body2" sx={{ minWidth: 28, color: "text.secondary" }}>
            #{step.stepIndex}
          </Typography>
          <Chip size="small" label={step.phase} variant="outlined" />
          <Chip size="small" label={step.status} color={colorForStepStatus(step.status)} />
          <Typography variant="body2" sx={{ flexGrow: 1 }}>
            {step.message}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60, textAlign: "right" }}>
            {durationText}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: "action.hover", borderRadius: 1, overflowX: "auto", fontSize: "0.8rem", whiteSpace: "pre-wrap", wordBreak: "break-all" }} data-testid={`step-payload-${String(step.stepIndex)}`}>
          {payloadJson}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

/**
 * Admin-facing live trace page. Polls
 * `GET /api/job-listings/:id/url-resolution/live` every second while the
 * attempt is in progress and renders every step the resolver has pushed to
 * the container's progress map. Each step can be expanded to inspect the raw
 * payload (request URL, response body, timing) the server pushed up — this
 * is the "more logs the better" admin debug view.
 *
 * Once the attempt settles (or the container reports a crash), the page
 * stops polling and shows the final state in place.
 */
function UrlResolutionTracePage() {
  const { id } = useParams<{ id: string }>();
  const [jobListing, setJobListing] = useState<JobListingResponse | null>(null);
  const [progress, setProgress] = useState<LiveProgress | null>(null);
  const [hasNoAttempts, setHasNoAttempts] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetches the live progress snapshot. Updates state with the latest data
   * or flags the empty (404) state. Errors are surfaced to the page banner.
   */
  const fetchProgress = useCallback(async () => {
    const parsedId = Number.parseInt(id ?? "", 10);
    const isInvalidId = Number.isNaN(parsedId);
    if (isInvalidId) {
      setErrorMessage("Invalid job listing ID");
      setIsLoading(false);
      return;
    }
    try {
      const snapshot = await getLiveUrlResolution(parsedId);
      if (snapshot === null) {
        setHasNoAttempts(true);
        setProgress(null);
      } else {
        setHasNoAttempts(false);
        setProgress(snapshot);
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load live trace";
      setErrorMessage(errorText);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  /** Loads the parent job listing once for the header card (title, source URL). */
  const fetchJobListing = useCallback(async () => {
    const parsedId = Number.parseInt(id ?? "", 10);
    const isInvalidId = Number.isNaN(parsedId);
    if (isInvalidId) return;
    try {
      const listing = await getJobListing(parsedId);
      setJobListing(listing);
    } catch {
      // Silent — the trace data is the page's primary concern.
    }
  }, [id]);

  useEffect(() => {
    fetchJobListing();
    fetchProgress();
  }, [fetchJobListing, fetchProgress]);

  /** Poll while the attempt is still running; stop on terminal or 404. */
  useEffect(() => {
    const isFinishedOrEmpty = hasNoAttempts || (progress !== null && progress.isFinished);

    if (isFinishedOrEmpty) {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return undefined;
    }

    if (pollIntervalRef.current === null) {
      pollIntervalRef.current = setInterval(fetchProgress, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [progress, hasNoAttempts, fetchProgress]);

  const parsedId = Number.parseInt(id ?? "", 10);
  const isInvalidId = Number.isNaN(parsedId);
  const backDestination = isInvalidId ? "/jobs" : `/jobs/${String(parsedId)}`;
  const headerTitle = jobListing?.title ?? "Application URL Resolution";

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <BackLink to={backDestination}>Back to Job View</BackLink>

      <LoadingOrErrorPanel isLoading={isLoading} errorMessage={errorMessage} onClearError={() => setErrorMessage("")} />

      {hasNoAttempts && !isLoading && (
        <Paper elevation={1} sx={{ p: 3, textAlign: "center" }} data-testid="trace-empty-state">
          <Typography color="text.secondary">
            No resolution attempts yet for this job. Trigger Fetch Data or Retry from the job page.
          </Typography>
        </Paper>
      )}

      {progress !== null && (
        <>
          <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
                {headerTitle}
              </Typography>
              {!progress.isFinished && <CircularProgress size={24} data-testid="trace-in-progress-spinner" />}
              <Chip
                label={progress.isFinished ? (progress.finalOutcome ?? "crashed") : "running"}
                color={colorForFinalOutcome(progress.finalOutcome)}
                data-testid="trace-status-chip"
              />
            </Box>

            {jobListing && (
              <>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Source URL
                </Typography>
                <Typography
                  component="a"
                  href={jobListing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ display: "block", mb: 2, wordBreak: "break-all" }}
                >
                  {jobListing.url}
                </Typography>
              </>
            )}

            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3, mb: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Log ID</Typography>
                <Typography variant="body2" data-testid="trace-log-id">{progress.logId}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Elapsed</Typography>
                <Typography variant="body2" data-testid="trace-elapsed">
                  {formatElapsed(progress.startedAt, progress.finishedAt)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Steps</Typography>
                <Typography variant="body2" data-testid="trace-step-count">{progress.steps.length}</Typography>
              </Box>
            </Box>

            {progress.isFinished && progress.finalApplicationUrl !== null && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Resolved Application URL
                </Typography>
                <Typography
                  component="a"
                  href={progress.finalApplicationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ display: "block", wordBreak: "break-all" }}
                  data-testid="trace-final-url"
                >
                  {progress.finalApplicationUrl}
                </Typography>
              </>
            )}

            {progress.isFinished && progress.reason !== null && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Reason
                </Typography>
                <Typography variant="body2" data-testid="trace-reason">{progress.reason}</Typography>
              </>
            )}
          </Paper>

          <Paper elevation={1} sx={{ p: 1 }}>
            <Typography variant="h6" sx={{ p: 2, pb: 1 }}>
              Steps
            </Typography>
            {progress.steps.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No steps recorded yet.
              </Typography>
            )}
            {progress.steps.map((step) => <StepRow key={step.stepIndex} step={step} />)}
          </Paper>
        </>
      )}
    </Container>
  );
}

export default UrlResolutionTracePage;
