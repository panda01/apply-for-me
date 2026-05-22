import { useCallback, useEffect, useState } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Typography,
} from "@mui/material";
import { PlayArrow as PlayArrowIcon } from "@mui/icons-material";
import BackLink from "../components/BackLink";
import LabeledField from "../components/LabeledField";
import {
  applyToJob,
  buildSubmissionScreenshotUrl,
  getJobAttempts,
  ApplicationAttemptOutcome,
  type ApplicationAttemptSummary,
  type JobAttemptsResponse,
} from "../services/jobListingsApi";

/**
 * localStorage key under which the last-used ApplicationProfile id is
 * persisted. Mirrors ApplicationDashboardPage so Apply works from this page
 * without needing the user to repeat their profile pick.
 */
const SELECTED_PROFILE_STORAGE_KEY = "afm:selectedApplicationProfileId";

/**
 * Maps the ApplicationAttemptOutcome enum value to a (color, human-readable label)
 * pair for the Chip rendering on each attempt row.
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
 * Maps a JobListing status string to its dashboard-equivalent Chip config so
 * the page header surfaces the same Ready / Applied / Closed / Error / etc.
 * indicator the rest of the app uses.
 * @param {string} status - The JobListing.status enum value
 * @returns {{ color: "default" | "warning" | "success" | "error" | "info"; label: string }} Chip color + label
 */
function getJobStatusChipConfig(status: string): {
  color: "default" | "warning" | "success" | "error" | "info";
  label: string;
} {
  const statusConfig: Record<
    string,
    { color: "default" | "warning" | "success" | "error" | "info"; label: string }
  > = {
    init: { color: "default", label: "Ready" },
    applying: { color: "info", label: "Applying" },
    applied: { color: "success", label: "Applied" },
    error_applying: { color: "error", label: "Error" },
    closed: { color: "default", label: "Closed" },
    missing_form_url: { color: "warning", label: "No form URL" },
  };
  return statusConfig[status] ?? { color: "default", label: status };
}

/**
 * Page that shows a job listing's attempt history. Header carries the job
 * metadata + an Apply button (gated by the same disabled logic as the
 * dashboard). The list renders newest-first; each entry shows an outcome
 * Chip, a timestamp, a thumbnail of the canonical submission screenshot
 * (when present), and click-through to the per-attempt detail page.
 */
function JobAttemptsPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<JobAttemptsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [isStartingApply, setIsStartingApply] = useState(false);

  const parsedId = parseInt(id ?? "", 10);
  const isInvalidId = Number.isNaN(parsedId);

  const fetchDetail = useCallback(async () => {
    if (isInvalidId) {
      setErrorMessage("Invalid job listing ID");
      setIsLoading(false);
      return;
    }
    try {
      const data = await getJobAttempts(parsedId);
      setDetail(data);
      setErrorMessage("");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load job attempts";
      setErrorMessage(errorText);
    } finally {
      setIsLoading(false);
    }
  }, [parsedId, isInvalidId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  /**
   * Starts an application for the current job using the localStorage-persisted
   * ApplicationProfile id, then refreshes the attempts list so the in-progress
   * status is visible.
   */
  const handleApply = async () => {
    if (isInvalidId) return;
    const storedRaw = window.localStorage.getItem(SELECTED_PROFILE_STORAGE_KEY);
    const storedProfileId = storedRaw === null ? NaN : parseInt(storedRaw, 10);
    const hasNoStoredProfile = Number.isNaN(storedProfileId);
    if (hasNoStoredProfile) {
      setActionErrorMessage("Pick an application profile on the Apply dashboard before applying.");
      return;
    }
    setIsStartingApply(true);
    setActionErrorMessage("");
    try {
      await applyToJob(parsedId, storedProfileId);
      await fetchDetail();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to start application";
      setActionErrorMessage(errorText);
    } finally {
      setIsStartingApply(false);
    }
  };

  const hasApplicationUrl = detail?.application_url !== null && detail?.application_url !== undefined;
  const canApply =
    detail !== null &&
    (detail.status === "init" || detail.status === "error_applying") &&
    hasApplicationUrl;

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <BackLink to="/apply">Back to Apply Dashboard</BackLink>

      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {errorMessage !== "" && (
        <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>
      )}

      {actionErrorMessage !== "" && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionErrorMessage("")}>
          {actionErrorMessage}
        </Alert>
      )}

      {detail && (
        <>
          <Paper elevation={2} sx={{ p: 3, mb: 3 }} data-testid="job-attempts-header">
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
                {detail.title !== "" ? detail.title : "Untitled"}
              </Typography>
              <Chip
                color={getJobStatusChipConfig(detail.status).color}
                label={getJobStatusChipConfig(detail.status).label}
              />
            </Box>

            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Source URL
            </Typography>
            <Typography
              component="a"
              href={detail.url}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ display: "block", mb: 2, wordBreak: "break-all" }}
            >
              {detail.url}
            </Typography>

            {detail.salary !== null && (
              <LabeledField label="Salary" gutterBottom>{detail.salary}</LabeledField>
            )}
            <LabeledField label="Post Date" gutterBottom>
              {detail.post_date ? new Date(detail.post_date).toLocaleDateString() : "Unknown"}
            </LabeledField>

            <Box sx={{ display: "flex", gap: 2, mt: 2, flexWrap: "wrap" }}>
              {canApply && (
                <Button
                  variant="contained"
                  startIcon={isStartingApply ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                  onClick={handleApply}
                  disabled={isStartingApply}
                  data-testid="job-attempts-apply-button"
                >
                  {isStartingApply ? "Starting..." : "Apply"}
                </Button>
              )}
              <Button variant="outlined" component={RouterLink} to={`/jobs/${String(detail.id)}`}>
                View Full Job Details
              </Button>
            </Box>
          </Paper>

          <Paper elevation={1} sx={{ p: 2 }} data-testid="job-attempts-list">
            <Typography variant="h6" sx={{ mb: 1 }}>
              Attempts ({detail.attempts.length})
            </Typography>
            <Divider sx={{ mb: 1 }} />

            {detail.attempts.length === 0 ? (
              <Typography color="text.secondary" sx={{ textAlign: "center", py: 3 }}>
                No attempts yet for this job.
              </Typography>
            ) : (
              <List disablePadding>
                {detail.attempts.map((attempt) => (
                  <AttemptListRow key={attempt.id} jobId={detail.id} attempt={attempt} />
                ))}
              </List>
            )}
          </Paper>
        </>
      )}
    </Container>
  );
}

interface AttemptListRowProps {
  /** Parent job listing ID — needed to build the per-attempt route */
  jobId: number;
  /** The attempt summary to render */
  attempt: ApplicationAttemptSummary;
}

/**
 * Renders one attempt entry in the attempts list. Click-through navigates to
 * the per-attempt detail page. Shows the outcome Chip, formatted timestamp,
 * step count, and a thumbnail of the submission screenshot when present.
 * @param {AttemptListRowProps} props
 * @param {number} props.jobId - The parent job listing id
 * @param {ApplicationAttemptSummary} props.attempt - The attempt summary to render
 */
function AttemptListRow({ jobId, attempt }: AttemptListRowProps) {
  const outcomeConfig = getOutcomeChipConfig(attempt.end_response);
  const timestamp = new Date(attempt.created_date).toLocaleString();
  const stepCount = attempt.step_logs.length;

  return (
    <ListItem
      key={attempt.id}
      disablePadding
      sx={{ mb: 0.5 }}
      data-testid={`attempt-row-${String(attempt.id)}`}
    >
      <ListItemButton
        component={RouterLink}
        to={`/applications/${String(attempt.id)}?jobId=${String(jobId)}`}
        sx={{ display: "flex", alignItems: "center", gap: 2, py: 1.5 }}
      >
        {attempt.has_submission_screenshot && (
          <Box
            component="img"
            src={buildSubmissionScreenshotUrl(jobId, attempt.id)}
            alt={`Submission screenshot for attempt ${String(attempt.id)}`}
            sx={{ width: 120, height: 80, objectFit: "cover", borderRadius: 1, flexShrink: 0 }}
            data-testid={`attempt-thumbnail-${String(attempt.id)}`}
          />
        )}
        <ListItemText
          primary={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip size="small" color={outcomeConfig.color} label={outcomeConfig.label} />
              <Typography variant="body2" color="text.secondary">
                {timestamp}
              </Typography>
            </Box>
          }
          secondary={
            <Typography variant="body2" color="text.secondary">
              {String(stepCount)} step{stepCount === 1 ? "" : "s"}
              {attempt.has_submission_screenshot ? " · screenshot saved" : ""}
            </Typography>
          }
        />
      </ListItemButton>
    </ListItem>
  );
}

export default JobAttemptsPage;
