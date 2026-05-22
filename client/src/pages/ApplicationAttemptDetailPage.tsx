import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Container,
  Divider,
  List,
  ListItem,
  Paper,
  Typography,
} from "@mui/material";
import BackLink from "../components/BackLink";
import {
  buildStepScreenshotUrl,
  buildSubmissionScreenshotUrl,
  getApplicationAttempt,
  ApplicationAttemptOutcome,
  type ApplicationAttemptDetail,
  type AttemptStepLog,
} from "../services/jobListingsApi";

/**
 * Maps the ApplicationAttemptOutcome enum value to a (color, label) pair
 * for the page-header Chip. Mirrors the same mapping used on the attempts
 * list so the visual language stays consistent.
 * @param {ApplicationAttemptOutcome} outcome - The enum value from the server
 * @returns {{ color: "success" | "error" | "warning" | "default"; label: string }} Chip color + label
 */
function getOutcomeChipConfig(outcome: ApplicationAttemptOutcome): {
  color: "success" | "error" | "warning" | "default";
  label: string;
} {
  switch (outcome) {
    case ApplicationAttemptOutcome.Applied:
      return { color: "success", label: "Applied" };
    case ApplicationAttemptOutcome.Failed:
      return { color: "error", label: "Failed" };
    case ApplicationAttemptOutcome.ClosedListing:
      return { color: "default", label: "Closed Listing" };
    case ApplicationAttemptOutcome.CaptchaBlocked:
      return { color: "warning", label: "Captcha Blocked" };
    case ApplicationAttemptOutcome.Stuck:
      return { color: "warning", label: "Stuck" };
  }
}

/**
 * Read-only per-attempt detail page. Renders the canonical submission
 * screenshot, the parsed step log, and an inline per-step screenshot for
 * every step the agent saved a PNG for. Apply is intentionally not available
 * here — this is a historical record of a single attempt.
 *
 * The route is /applications/:id, but the streaming endpoints are namespaced
 * under the parent job. The attempts list passes ?jobId=N when linking here;
 * the page reads that from the query string. Direct URL pastes without
 * ?jobId=N show a recoverable error.
 */
function ApplicationAttemptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const jobIdRaw = searchParams.get("jobId");

  const [detail, setDetail] = useState<ApplicationAttemptDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [screenshotFailedToLoad, setScreenshotFailedToLoad] = useState(false);

  const parsedAttemptId = parseInt(id ?? "", 10);
  const parsedJobId = jobIdRaw === null ? NaN : parseInt(jobIdRaw, 10);
  const isInvalidAttemptId = Number.isNaN(parsedAttemptId);
  const isInvalidJobId = Number.isNaN(parsedJobId);

  const fetchDetail = useCallback(async () => {
    if (isInvalidAttemptId) {
      setErrorMessage("Invalid attempt ID in the URL");
      setIsLoading(false);
      return;
    }
    if (isInvalidJobId) {
      setErrorMessage("Missing jobId query parameter. Open this attempt from the job's attempts list.");
      setIsLoading(false);
      return;
    }
    try {
      const data = await getApplicationAttempt(parsedJobId, parsedAttemptId);
      setDetail(data);
      setErrorMessage("");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load attempt";
      setErrorMessage(errorText);
    } finally {
      setIsLoading(false);
    }
  }, [parsedAttemptId, parsedJobId, isInvalidAttemptId, isInvalidJobId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <BackLink to={isInvalidJobId ? "/apply" : `/jobs/${String(parsedJobId)}/attempts`}>
        Back to Attempts
      </BackLink>

      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {errorMessage !== "" && (
        <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>
      )}

      {detail && (
        <>
          <Paper elevation={2} sx={{ p: 3, mb: 3 }} data-testid="attempt-detail-header">
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
                Attempt #{String(detail.id)}
              </Typography>
              <Chip
                color={getOutcomeChipConfig(detail.end_response).color}
                label={getOutcomeChipConfig(detail.end_response).label}
              />
            </Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {new Date(detail.created_date).toLocaleString()}
            </Typography>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
              Job
            </Typography>
            <Typography sx={{ wordBreak: "break-all" }}>
              {detail.job_listing.title !== "" ? detail.job_listing.title : detail.job_listing.url}
            </Typography>
          </Paper>

          <Paper elevation={1} sx={{ p: 2, mb: 3 }} data-testid="attempt-submission-screenshot-panel">
            <Typography variant="h6" sx={{ mb: 1 }}>Submission Screenshot</Typography>
            <Divider sx={{ mb: 2 }} />
            {detail.has_submission_screenshot && !screenshotFailedToLoad ? (
              <Box
                component="img"
                src={buildSubmissionScreenshotUrl(parsedJobId, detail.id)}
                alt={`Submission screenshot for attempt ${String(detail.id)}`}
                onError={() => setScreenshotFailedToLoad(true)}
                sx={{ maxWidth: "100%", border: "1px solid", borderColor: "divider", borderRadius: 1 }}
                data-testid="attempt-submission-screenshot"
              />
            ) : (
              <Typography color="text.secondary" data-testid="attempt-submission-screenshot-empty">
                No submission screenshot for this attempt.
              </Typography>
            )}
          </Paper>

          <Paper elevation={1} sx={{ p: 2 }} data-testid="attempt-step-log-panel">
            <Typography variant="h6" sx={{ mb: 1 }}>Step Log ({String(detail.step_logs.length)})</Typography>
            <Divider sx={{ mb: 1 }} />
            {detail.step_logs.length === 0 ? (
              <Typography color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
                No step log recorded for this attempt.
              </Typography>
            ) : (
              <List disablePadding>
                {detail.step_logs.map((step) => (
                  <StepRow
                    key={`${String(detail.id)}-${String(step.stepNumber)}`}
                    jobId={parsedJobId}
                    attemptId={detail.id}
                    step={step}
                  />
                ))}
              </List>
            )}
          </Paper>
        </>
      )}
    </Container>
  );
}

interface StepRowProps {
  /** Parent job listing id (needed for the per-step streaming URL) */
  jobId: number;
  /** Attempt id (needed for the per-step streaming URL) */
  attemptId: number;
  /** The step record */
  step: AttemptStepLog;
}

/**
 * Renders one step entry in the per-attempt step log. Shows a phase chip, the
 * agent's nextGoal, the URL it was on, actions, and an inline screenshot when
 * the step's screenshotSaved flag is true. The `<img>` has an onError fallback
 * because the file may have been cleaned up off-disk even though the DB row
 * thinks it exists.
 * @param {StepRowProps} props
 * @param {number} props.jobId - The parent job listing id
 * @param {number} props.attemptId - The attempt id
 * @param {AttemptStepLog} props.step - The step to render
 */
function StepRow({ jobId, attemptId, step }: StepRowProps) {
  const [screenshotFailed, setScreenshotFailed] = useState(false);
  const shouldShowScreenshot = step.screenshotSaved && !screenshotFailed;

  return (
    <ListItem
      key={step.stepNumber}
      disablePadding
      sx={{ flexDirection: "column", alignItems: "stretch", mb: 1, p: 1, borderBottom: "1px solid", borderColor: "divider" }}
      data-testid={`attempt-step-${String(step.stepNumber)}`}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="subtitle2">Step {String(step.stepNumber)}</Typography>
        <Chip size="small" color="default" label={`Phase ${String(step.phase)} — ${step.phaseLabel}`} />
        {step.captchaDetected && <Chip size="small" color="warning" label="CAPTCHA" />}
        {step.stuckDetected && <Chip size="small" color="warning" label="Stuck" />}
      </Box>
      <Typography sx={{ mt: 0.5 }}>{step.nextGoal}</Typography>
      <Typography
        component="a"
        href={step.url}
        target="_blank"
        rel="noopener noreferrer"
        variant="body2"
        color="primary"
        sx={{ wordBreak: "break-all" }}
      >
        {step.url}
      </Typography>
      {step.actions.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Actions: {step.actions.join(", ")}
        </Typography>
      )}
      {shouldShowScreenshot && (
        <Box
          component="img"
          src={buildStepScreenshotUrl(jobId, attemptId, step.stepNumber)}
          alt={`Step ${String(step.stepNumber)} screenshot`}
          onError={() => setScreenshotFailed(true)}
          sx={{ mt: 1, maxWidth: "100%", border: "1px solid", borderColor: "divider", borderRadius: 1 }}
          data-testid={`attempt-step-${String(step.stepNumber)}-screenshot`}
        />
      )}
    </ListItem>
  );
}

export default ApplicationAttemptDetailPage;
