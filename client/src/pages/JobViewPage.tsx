import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Snackbar,
  Typography,
} from "@mui/material";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import AccessTimeOutlinedIcon from "@mui/icons-material/AccessTimeOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import CheckOutlinedIcon from "@mui/icons-material/CheckOutlined";
import TimelineOutlinedIcon from "@mui/icons-material/TimelineOutlined";
import {
  getJobListing,
  fetchJobData,
  applyToJob,
  resolveApplicationUrl,
  getJobAttempts,
  deleteJobListing,
  ApplicationAttemptOutcome,
  type JobListingResponse,
  type ApplicationAttemptSummary,
} from "../services/jobListingsApi";
import LoadingOrErrorPanel from "../components/LoadingOrErrorPanel";
import LiveBrowserView from "../components/LiveBrowserView";
import LabeledField from "../components/LabeledField";
import ResolutionTracePanel from "../components/ResolutionTracePanel";
import FetchProgressPanel from "../components/FetchProgressPanel";
import StatusPill from "../components/StatusPill";
import { getStatusMeta } from "../lib/jobStatus";

/**
 * localStorage key under which the last-used ApplicationProfile id is
 * persisted. Mirrors ApplicationDashboardPage so Apply works from this page
 * without the user needing to re-select their profile.
 */
const SELECTED_PROFILE_STORAGE_KEY = "afm:selectedApplicationProfileId";

/**
 * One of the 4 tone classes the design exposes for attempt rows
 * (`.att-ok` / `.att-err` / `.att-warn` / `.att-mut`). Used by both the dot
 * on the timeline rail and the pill in the attempt-head.
 */
type AttemptToneClass = "att-ok" | "att-err" | "att-warn" | "att-mut";

interface AttemptPresentation {
  tone: AttemptToneClass;
  label: string;
  description: string;
  Icon: typeof CheckOutlinedIcon;
}

/**
 * Maps a server-side {@link ApplicationAttemptOutcome} enum value to the
 * design-system tone class, the user-facing label, the description shown
 * under the attempt head, and the MUI icon rendered inside the rail dot.
 * Keep this in lockstep with the server enum — adding a new outcome on the
 * server without an entry here will fall through to the neutral mut-style
 * default.
 * @param {ApplicationAttemptOutcome} outcome - The attempt outcome enum value
 * @returns {AttemptPresentation} Tone class, label, description, and icon
 */
function getAttemptPresentation(outcome: ApplicationAttemptOutcome): AttemptPresentation {
  switch (outcome) {
    case ApplicationAttemptOutcome.Applied:
      return {
        tone: "att-ok",
        label: "Applied",
        description: "Application submitted successfully",
        Icon: CheckOutlinedIcon,
      };
    case ApplicationAttemptOutcome.Failed:
      return {
        tone: "att-err",
        label: "Failed",
        description: "Application attempt failed",
        Icon: CloseOutlinedIcon,
      };
    case ApplicationAttemptOutcome.ClosedListing:
      return {
        tone: "att-mut",
        label: "Closed listing",
        description: "Listing was closed before the agent could submit",
        Icon: CloseOutlinedIcon,
      };
    case ApplicationAttemptOutcome.CaptchaBlocked:
      return {
        tone: "att-warn",
        label: "CAPTCHA blocked",
        description: "Hit a CAPTCHA that requires the user to solve manually",
        Icon: RefreshOutlinedIcon,
      };
    case ApplicationAttemptOutcome.Stuck:
      return {
        tone: "att-warn",
        label: "Stuck",
        description: "Agent got stuck before reaching the submit step",
        Icon: AccessTimeOutlinedIcon,
      };
  }
}

/**
 * Returns a single uppercase letter to render inside the `.company-logo`
 * placeholder div on the page header. Prefers the persisted `company` field
 * (populated by the inbox-discovery scanner and the scrape pipeline); falls
 * back to the URL hostname's first character for legacy rows where company
 * is null/empty. Returns "?" when neither yields a usable character.
 * @param {JobListingResponse | null} jobListing - The current job listing
 * @returns {string} A single character suitable for the logo placeholder
 */
function deriveCompanyLogoLetter(jobListing: JobListingResponse | null): string {
  if (jobListing === null) return "?";
  const persistedCompany = jobListing.company;
  if (typeof persistedCompany === "string" && persistedCompany.trim().length > 0) {
    const firstChar = persistedCompany.trim().charAt(0);
    return firstChar.toUpperCase();
  }
  const sourceUrl = jobListing.url;
  if (typeof sourceUrl !== "string" || sourceUrl === "") return "?";
  try {
    const parsedUrl = new URL(sourceUrl);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");
    const firstChar = hostname.charAt(0);
    return firstChar === "" ? "?" : firstChar.toUpperCase();
  } catch {
    return "?";
  }
}

/**
 * Returns the company name for the Details meta-list. Prefers the persisted
 * `company` field; falls back to the URL hostname (with `www.` stripped) for
 * legacy rows where company is null/empty. Returns "—" when neither yields
 * a usable value.
 * @param {JobListingResponse | null} jobListing - The current job listing
 * @returns {string} The persisted company name, the URL hostname fallback,
 *   or the em-dash for missing data
 */
function deriveCompanyLabel(jobListing: JobListingResponse | null): string {
  if (jobListing === null) return "—";
  const persistedCompany = jobListing.company;
  if (typeof persistedCompany === "string" && persistedCompany.trim().length > 0) {
    return persistedCompany.trim();
  }
  const sourceUrl = jobListing.url;
  if (typeof sourceUrl !== "string" || sourceUrl === "") return "—";
  try {
    const parsedUrl = new URL(sourceUrl);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");
    return hostname === "" ? "—" : hostname;
  } catch {
    return "—";
  }
}

/**
 * Returns the displayable page title for a job listing. The backend leaves
 * `title` empty until Fetch Data has run; the design header should still show
 * something useful in that case (the hostname of the saved URL).
 * @param {JobListingResponse | null} jobListing - The current job listing
 * @returns {string} The job's title when scraped, else the URL hostname,
 *   else "Untitled"
 */
function deriveDisplayTitle(jobListing: JobListingResponse | null): string {
  if (jobListing === null) return "Untitled";
  const persistedTitle = jobListing.title;
  if (typeof persistedTitle === "string" && persistedTitle !== "") return persistedTitle;
  try {
    const parsedUrl = new URL(jobListing.url);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");
    return hostname === "" ? "Untitled" : hostname;
  } catch {
    return "Untitled";
  }
}

/**
 * Formats a duration in milliseconds into a compact "Ns" / "Nm Ss" string
 * for the attempt-stats row. Returns "—" for missing or sub-second values
 * to match the design's reference implementation.
 * @param {number | null} totalMs - Duration in milliseconds, or null
 * @returns {string} Compact human-readable duration
 */
function formatAttemptDuration(totalMs: number | null): string {
  if (totalMs === null || totalMs < 1000) return "—";
  const totalSeconds = Math.round(totalMs / 1000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${String(minutes)}m ${String(remainingSeconds)}s`;
}

/**
 * Returns the duration in milliseconds between the first and last step in an
 * attempt's step_logs array, or null when there are fewer than two steps.
 * @param {ApplicationAttemptSummary} attempt - The attempt to measure
 * @returns {number | null} Duration in milliseconds, or null when undefined
 */
function deriveAttemptDurationMs(attempt: ApplicationAttemptSummary): number | null {
  const stepLogs = attempt.step_logs;
  const hasFewerThanTwoSteps = stepLogs.length < 2;
  if (hasFewerThanTwoSteps) return null;
  const firstStep = stepLogs[0];
  const lastStep = stepLogs[stepLogs.length - 1];
  const firstTime = new Date(firstStep.timestamp).getTime();
  const lastTime = new Date(lastStep.timestamp).getTime();
  if (Number.isNaN(firstTime) || Number.isNaN(lastTime)) return null;
  return Math.max(0, lastTime - firstTime);
}

interface AttemptRowProps {
  /** The attempt summary to render */
  attempt: ApplicationAttemptSummary;
  /** True when this is the very last attempt in the timeline — controls
   *  whether the connecting `.attempt-line` segment is rendered. */
  isLast: boolean;
}

/**
 * Renders one row of the application-attempts timeline. Mirrors the design's
 * `AttemptRow` JSX: rail (dot + optional connecting line) + body (head row
 * with pill / timestamp / stats and a description paragraph).
 * @param {AttemptRowProps} props - The attempt + isLast flag
 * @returns {JSX.Element} A `.attempt-row` element
 */
function AttemptRow({ attempt, isLast }: AttemptRowProps) {
  const presentation = getAttemptPresentation(attempt.end_response);
  const whenLabel = new Date(attempt.created_date).toLocaleString();
  const fieldCount = attempt.step_logs.length;
  const durationLabel = formatAttemptDuration(deriveAttemptDurationMs(attempt));
  const IconForDot = presentation.Icon;

  return (
    <div className="attempt-row" data-testid={`attempt-row-${String(attempt.id)}`}>
      <div className="attempt-rail">
        <div className={`attempt-dot ${presentation.tone}`}>
          <IconForDot sx={{ fontSize: 14 }} />
        </div>
        {!isLast && <div className="attempt-line" />}
      </div>
      <div className="attempt-body">
        <div className="attempt-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className={`attempt-pill ${presentation.tone}`}>
              <span className="dot" /> {presentation.label}
            </span>
            <span className="attempt-time">{whenLabel}</span>
          </div>
          <div className="attempt-stats">
            <span title="Application profile used">
              <PersonOutlineOutlinedIcon sx={{ fontSize: 12 }} /> Profile
            </span>
            {fieldCount > 0 && (
              <span title="Fields auto-filled">
                <EditOutlinedIcon sx={{ fontSize: 12 }} /> {String(fieldCount)} steps
              </span>
            )}
            <span title="Time spent">
              <AccessTimeOutlinedIcon sx={{ fontSize: 12 }} /> {durationLabel}
            </span>
          </div>
        </div>
        <div className="attempt-desc">{presentation.description}</div>
      </div>
    </div>
  );
}

/**
 * Page that displays the full details of a single job listing in the new
 * two-column design: a main column with the description card, inline fetch
 * progress / live-browser panels, and the application-attempts timeline; a
 * sticky side column with the Details meta-list and the Manage actions.
 *
 * Status handling is read-only here — `StatusPill` projects whatever status
 * the backend reports onto the design's six pill colorways via
 * {@link getStatusMeta}. No status-flip endpoints are invented; the Manage
 * row buttons currently surface a Snackbar explaining the action isn't wired
 * up yet (except for Delete, which uses the real `deleteJobListing` route).
 *
 * Preserves every behavior of the previous implementation: id parsing, the
 * fetch + apply + retry-resolve handlers, the 3-second polling loop while
 * any long-running operation is in flight, the FetchProgressPanel /
 * LiveBrowserView / ResolutionTracePanel mounts, and the missing-form-url
 * Alert with its Retry button.
 */
function JobViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [jobListing, setJobListing] = useState<JobListingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [isStartingApply, setIsStartingApply] = useState(false);
  const [isRetryingResolve, setIsRetryingResolve] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [traceRefreshToken, setTraceRefreshToken] = useState(0);
  // Incremented on every Fetch Data invocation. Passed as `key` to
  // FetchProgressPanel so the panel fully remounts on retry — necessary
  // because `isActive` can be permanently true (e.g. when `resolution_in_progress`
  // is still set on a crashed row) and would otherwise prevent the panel's
  // mount-time `useEffect` from resetting `progress` and restarting the poll.
  const [fetchRetryKey, setFetchRetryKey] = useState(0);
  // Snapshot of the latest resolution log id at the moment of the most recent
  // Fetch Data click. Passed to FetchProgressPanel as `sinceLogId` so it
  // ignores stale terminal payloads (the crashed log) until the background
  // scraper inserts a fresh log row with a higher id.
  const [fetchSinceLogId, setFetchSinceLogId] = useState<number | null>(null);
  // Attempts list for this job, fetched lazily once the job loads. Render an
  // empty-state timeline when this is null or empty.
  const [attempts, setAttempts] = useState<ApplicationAttemptSummary[] | null>(null);
  // Snackbar wired to the not-yet-implemented Manage actions.
  const [snackbarMessage, setSnackbarMessage] = useState<string>("");
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetches the latest job listing data from the API by the URL param ID.
   * Sets loading and error state accordingly.
   */
  const fetchJobListing = useCallback(async () => {
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
    if (isInvalidId) {
      setErrorMessage("Invalid job listing ID");
      setIsLoading(false);
      return;
    }

    try {
      const listing = await getJobListing(parsedId);
      setJobListing(listing);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load job listing";
      setErrorMessage(errorText);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  /**
   * Fetches the attempts history for this job (best-effort). Silently leaves
   * `attempts` as null when the request fails — the timeline card falls back
   * to its empty state in that case.
   */
  const fetchAttempts = useCallback(async () => {
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
    if (isInvalidId) return;
    try {
      const detail = await getJobAttempts(parsedId);
      setAttempts(detail.attempts);
    } catch {
      // Non-fatal — attempts card renders its empty state.
    }
  }, [id]);

  useEffect(() => {
    fetchJobListing();
  }, [fetchJobListing]);

  useEffect(() => {
    fetchAttempts();
  }, [fetchAttempts]);

  /**
   * Poll every 3 seconds while the job is applying, while data is being
   * fetched, while a resolver retry is in flight, OR while the cached row
   * still reports `resolution_in_progress=true`. The last case matters when
   * the user lands on a page mid-fetch (without clicking Fetch Data
   * themselves) — without it the FetchProgressPanel stays mounted forever
   * because nothing ever re-fetches the row to observe the server flipping
   * `resolution_in_progress` to false.
   */
  useEffect(() => {
    const isApplying = jobListing?.status === "applying";
    const isResolutionStillInProgress = jobListing?.resolution_in_progress === true;
    const shouldPoll = isApplying || isFetchingData || isRetryingResolve || isResolutionStillInProgress;

    if (shouldPoll) {
      const hasNoExistingPoll = !pollIntervalRef.current;
      if (hasNoExistingPoll) {
        pollIntervalRef.current = setInterval(fetchJobListing, 3000);
      }
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [jobListing, isFetchingData, isRetryingResolve, fetchJobListing]);

  /** Stop the fetch-data polling once title has been populated */
  useEffect(() => {
    const hasTitle = !!jobListing?.title;
    if (hasTitle && isFetchingData) {
      setIsFetchingData(false);
    }
  }, [jobListing?.title, isFetchingData]);

  /** Stop the retry-resolve polling once the row settles (application_url filled in or status flipped back to missing_form_url) */
  useEffect(() => {
    const isResolverDone =
      (jobListing?.application_url !== null && jobListing?.application_url !== undefined) ||
      jobListing?.status === "missing_form_url";
    if (isResolverDone && isRetryingResolve) {
      setIsRetryingResolve(false);
      // Bumping the token re-fetches the resolution-log panel so it reflects the latest attempt.
      setTraceRefreshToken((token) => token + 1);
    }
  }, [jobListing?.application_url, jobListing?.status, isRetryingResolve]);

  /** Refresh the trace panel after the initial Fetch Data resolver completes (detected by title flipping non-empty). */
  useEffect(() => {
    const hasTitle = !!jobListing?.title;
    if (hasTitle && isFetchingData === false) {
      // The fetch flow runs scrape + resolver back-to-back; once the title
      // shows up the trace panel should pick up the freshly persisted log.
      setTraceRefreshToken((token) => token + 1);
    }
  }, [jobListing?.title, isFetchingData]);

  /**
   * Triggers background scraping for this job listing. Starts polling to show
   * updated data once scraping completes. Bumps `fetchRetryKey` so the
   * FetchProgressPanel fully remounts — guarantees a fresh poll cycle even
   * when its `isActive` prop was already true (e.g. coming off a crashed
   * resolution that left `resolution_in_progress=true`).
   */
  const handleFetchData = async () => {
    // Snapshot the prior log id BEFORE bumping the retry key. The panel reads
    // this snapshot on its remount-time first poll and ignores any payload
    // whose logId ≤ this value (stale crashed log).
    setFetchSinceLogId(jobListing?.latest_resolution_log_id ?? null);
    setFetchRetryKey((token) => token + 1);
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
    if (isInvalidId) return;

    setIsFetchingData(true);
    setActionErrorMessage("");
    try {
      await fetchJobData(parsedId);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to fetch job data";
      setActionErrorMessage(errorText);
      setIsFetchingData(false);
    }
  };

  /**
   * Re-runs the application-URL resolver against the already-scraped fields
   * for this listing and navigates to the admin live-trace page so the user
   * can watch the steps as they happen. Used when the initial fetch resulted
   * in missing_form_url and the user wants another attempt without
   * re-scraping.
   */
  const handleRetryResolveApplicationUrl = async () => {
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
    if (isInvalidId) return;

    setIsRetryingResolve(true);
    setActionErrorMessage("");
    try {
      await resolveApplicationUrl(parsedId);
      navigate(`/jobs/${String(parsedId)}/url-resolution`);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to retry application URL resolution";
      setActionErrorMessage(errorText);
      setIsRetryingResolve(false);
    }
  };

  /**
   * Starts the application process for this job listing.
   * Reads the most-recently-selected ApplicationProfile id from localStorage
   * (set on the apply dashboard). If none is selected the user is told to
   * pick one on the apply dashboard first.
   * Transitions the page to show the live browser iframe.
   */
  const handleApply = async () => {
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
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
      await fetchJobListing();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to start application";
      setActionErrorMessage(errorText);
    } finally {
      setIsStartingApply(false);
    }
  };

  /**
   * Manage-row handler for actions the backend doesn't expose yet. Surfaces
   * a Snackbar telling the user the action isn't wired up so the design's
   * Manage list still renders correctly without inventing fake statuses.
   * @param {string} actionLabel - Human-readable label of the unwired action
   */
  const handleUnwiredManageAction = (actionLabel: string) => {
    setSnackbarMessage(`${actionLabel}: status changes are not yet wired up`);
  };

  /**
   * Deletes the current job listing via the real API and navigates back to
   * the jobs list on success. Surfaces failures via the Snackbar.
   */
  const handleDeleteJob = async () => {
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
    if (isInvalidId) return;
    try {
      await deleteJobListing(parsedId);
      navigate("/jobs");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to delete job";
      setSnackbarMessage(errorText);
    }
  };

  const isApplying = jobListing?.status === "applying";
  const isMissingFormUrl = jobListing?.status === "missing_form_url";
  const isResolutionInProgress = jobListing?.resolution_in_progress === true;
  const hasJobDetails = !!jobListing?.title;
  const hasApplicationUrl = !!jobListing?.application_url;
  // Auto-apply requires a resolved application_url (the off-platform form). When
  // the row is in missing_form_url state, or application_url is still null
  // (e.g. fetch hasn't run yet), the Apply button is hidden.
  const canApply = (jobListing?.status === "init" || jobListing?.status === "error_applying") && hasApplicationUrl;
  const isAlreadyApplied = jobListing?.status === "applied";

  const totalAttempts = attempts === null ? 0 : attempts.length;
  const successfulAttempts = attempts === null
    ? 0
    : attempts.filter((entry) => entry.end_response === ApplicationAttemptOutcome.Applied).length;
  const failedOrBlockedAttempts = totalAttempts - successfulAttempts;
  const latestAttempt = attempts !== null && attempts.length > 0 ? attempts[0] : null;
  const lastAttemptLabel = latestAttempt === null
    ? "—"
    : new Date(latestAttempt.created_date).toLocaleString();

  const displayTitle = deriveDisplayTitle(jobListing);
  const companyLogoLetter = deriveCompanyLogoLetter(jobListing);
  const companyLabel = deriveCompanyLabel(jobListing);
  // Location is normalized on write (trim + collapse whitespace, empty → null)
  // by the inbox-discovery import path, which is the only writer of this column.
  // So `null` means unknown; otherwise the value is display-ready.
  const locationLabel = jobListing?.location ?? "—";
  const salaryLabel = jobListing?.salary ?? "—";
  const postedLabel = jobListing?.post_date && jobListing.post_date !== ""
    ? new Date(jobListing.post_date).toLocaleDateString()
    : "—";
  const savedLabel = jobListing
    ? new Date(jobListing.created_date).toLocaleDateString()
    : "—";
  const statusMeta = jobListing ? getStatusMeta(jobListing.status) : null;

  return (
    <>
      <LoadingOrErrorPanel isLoading={isLoading} errorMessage={errorMessage} />

      {actionErrorMessage !== "" && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionErrorMessage("")}>
          {actionErrorMessage}
        </Alert>
      )}

      {jobListing && (
        <>
          {/* ============ Full-width page header ============ */}
          <div
            className="page-head"
            style={{ alignItems: "flex-start" }}
            data-testid="job-view-header"
          >
            <div style={{ minWidth: 0 }}>
              <Button
                onClick={() => navigate("/jobs")}
                size="small"
                startIcon={<ArrowBackOutlinedIcon sx={{ fontSize: 16 }} />}
                sx={{
                  paddingLeft: 0,
                  marginBottom: "10px",
                  textTransform: "none",
                  color: "var(--text-muted)",
                  fontSize: 12.5,
                  "&:hover": { background: "transparent", color: "var(--text)" },
                }}
                data-testid="back-to-jobs-button"
              >
                Back to jobs
              </Button>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  className="company-logo"
                  style={{ width: 48, height: 48, fontSize: 18, borderRadius: 10 }}
                  data-testid="company-logo"
                >
                  {companyLogoLetter}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h1
                    className="page-title"
                    style={{ marginBottom: 2 }}
                    data-testid="job-title"
                  >
                    {displayTitle}
                  </h1>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      color: "var(--text-muted)",
                      fontSize: 13,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontWeight: 500, color: "var(--text)" }}>{companyLabel}</span>
                    <span>·</span>
                    <span>{"—"}</span>
                    <span>·</span>
                    <span className="mono">{salaryLabel}</span>
                  </div>
                </div>
              </div>
            </div>

            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!hasJobDetails && (
                <Button
                  variant="outlined"
                  startIcon={isFetchingData ? <CircularProgress size={14} /> : <DownloadOutlinedIcon sx={{ fontSize: 16 }} />}
                  onClick={handleFetchData}
                  disabled={isFetchingData}
                  data-testid="fetch-data-button"
                >
                  {isFetchingData ? "Fetching..." : "Fetch Data"}
                </Button>
              )}

              {hasApplicationUrl && (
                <Button
                  variant="outlined"
                  endIcon={<OpenInNewOutlinedIcon sx={{ fontSize: 16 }} />}
                  component="a"
                  href={jobListing.application_url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="open-application-button"
                >
                  Open posting
                </Button>
              )}

              {!hasApplicationUrl && jobListing.url !== "" && (
                <Button
                  variant="outlined"
                  endIcon={<OpenInNewOutlinedIcon sx={{ fontSize: 16 }} />}
                  component="a"
                  href={jobListing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="open-posting-source-link"
                >
                  Open posting
                </Button>
              )}

              {canApply && (
                <Button
                  variant="contained"
                  startIcon={isStartingApply
                    ? <CircularProgress size={14} color="inherit" />
                    : <AutoAwesomeOutlinedIcon sx={{ fontSize: 16 }} />}
                  onClick={handleApply}
                  disabled={isStartingApply || isApplying}
                  data-testid="apply-button"
                >
                  {isStartingApply ? "Starting..." : "Auto-apply"}
                </Button>
              )}

              {isAlreadyApplied && (
                <Button
                  variant="outlined"
                  startIcon={<RefreshOutlinedIcon sx={{ fontSize: 16 }} />}
                  onClick={handleApply}
                  disabled={isStartingApply}
                  data-testid="re-apply-button"
                >
                  Re-apply
                </Button>
              )}

              {!isResolutionInProgress && jobListing.latest_resolution_log_id !== null && (
                <Button
                  variant="text"
                  component={RouterLink}
                  to={`/jobs/${String(jobListing.id)}/url-resolution`}
                  startIcon={<TimelineOutlinedIcon sx={{ fontSize: 16 }} />}
                  data-testid="view-resolution-trace-link"
                >
                  Trace
                </Button>
              )}

              {isResolutionInProgress && (
                <Button
                  variant="outlined"
                  color="info"
                  component={RouterLink}
                  to={`/jobs/${String(jobListing.id)}/url-resolution`}
                  startIcon={<CircularProgress size={14} />}
                  data-testid="view-resolution-progress-link"
                >
                  View progress
                </Button>
              )}
            </Box>
          </div>

          {/* Missing-form-url callout — sits between the header and the grid so
              both columns see it and the Retry button stays prominent. */}
          {isMissingFormUrl && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              data-testid="missing-form-url-alert"
              action={
                <Button
                  color="warning"
                  size="small"
                  startIcon={isRetryingResolve ? <CircularProgress size={14} /> : <RefreshOutlinedIcon sx={{ fontSize: 16 }} />}
                  onClick={handleRetryResolveApplicationUrl}
                  disabled={isRetryingResolve}
                  data-testid="retry-resolve-button"
                >
                  {isRetryingResolve ? "Retrying..." : "Retry"}
                </Button>
              }
            >
              Could not find an off-platform application form for this job. The auto-apply flow is blocked. Retry resolution, or open the source posting to apply manually.
            </Alert>
          )}

          {/* ============ Two-column grid ============ */}
          <div className="job-detail-grid">
            <div className="job-detail-main">
              {/* Card 1 — Job description */}
              <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: "var(--radius)" }}>
                <div className="card-head">
                  <span className="card-title">Job description</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {statusMeta && <span className="tag">{statusMeta.label}</span>}
                    {jobListing.salary && <span className="tag">{jobListing.salary}</span>}
                  </div>
                </div>
                <div
                  className="card-body"
                  style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--text)" }}
                >
                  {jobListing.description !== "" ? (
                    <Typography sx={{ whiteSpace: "pre-wrap", margin: 0 }}>
                      {jobListing.description}
                    </Typography>
                  ) : (
                    <Typography color="text.secondary" sx={{ margin: 0 }}>
                      No description yet. Click Fetch Data to scrape the listing.
                    </Typography>
                  )}
                </div>
              </Paper>

              {/* Inline Fetch Data progress — visible while the resolver is running OR the page is loaded mid-fetch */}
              <Paper variant="outlined" sx={{ mt: 2, p: 2, display: (isFetchingData || isResolutionInProgress) ? "block" : "none" }}>
                <FetchProgressPanel
                  key={fetchRetryKey}
                  jobId={parseInt(id ?? "", 10)}
                  isActive={isFetchingData || isResolutionInProgress}
                  sinceLogId={fetchSinceLogId}
                  onRetry={handleFetchData}
                />
              </Paper>

              {/* Live Application View — shown when applying */}
              {isApplying && (
                <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                    <CircularProgress size={20} />
                    <Typography variant="h6" component="h2">
                      Applying to job...
                    </Typography>
                  </Box>
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    The browser agent is applying to this job. This may take a few minutes.
                  </Typography>
                  <LiveBrowserView liveUrl={jobListing.live_url} />
                </Paper>
              )}

              {/* Job Details sub-section — shown alongside description so salary / post_date / created_date are visible */}
              {hasJobDetails && !isApplying && (
                <Paper variant="outlined" sx={{ mt: 2, p: 2 }} data-testid="job-detail-extra">
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 600 }}>
                    Job Details
                  </Typography>
                  {jobListing.salary && (
                    <LabeledField label="Salary" gutterBottom>{jobListing.salary}</LabeledField>
                  )}
                  <LabeledField label="Post Date" gutterBottom>
                    {jobListing.post_date ? new Date(jobListing.post_date).toLocaleDateString() : "Unknown"}
                  </LabeledField>
                  <LabeledField label="Added On" gutterBottom>
                    {new Date(jobListing.created_date).toLocaleDateString()}
                  </LabeledField>
                </Paper>
              )}

              {/* Card 2 — Application attempts */}
              <Paper variant="outlined" sx={{ mt: 2, overflow: "hidden", borderRadius: "var(--radius)" }}>
                <div className="card-head">
                  <span className="card-title">
                    Application attempts{" "}
                    <span style={{ color: "var(--text-faint)", fontWeight: 400, marginLeft: 6 }}>
                      · {String(totalAttempts)}
                    </span>
                  </span>
                  {totalAttempts > 0 && (
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                      {String(successfulAttempts)} successful · {String(failedOrBlockedAttempts)} failed or blocked
                    </div>
                  )}
                </div>
                {totalAttempts === 0 ? (
                  <div
                    style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}
                    data-testid="attempts-empty-state"
                  >
                    <div style={{ fontWeight: 500, color: "var(--text)", marginBottom: 6 }}>
                      No attempts yet
                    </div>
                    {canApply
                      ? "Click Auto-apply to start the application."
                      : "We'll log every application attempt here, with the result and any blockers."}
                  </div>
                ) : (
                  <div className="attempts-list">
                    {attempts !== null && attempts.map((attempt, index) => (
                      <AttemptRow
                        key={attempt.id}
                        attempt={attempt}
                        isLast={index === attempts.length - 1}
                      />
                    ))}
                  </div>
                )}
              </Paper>

              {/* Resolver trace — always available, collapsed by default. */}
              <Box sx={{ mt: 2 }}>
                <ResolutionTracePanel jobListingId={jobListing.id} refreshToken={traceRefreshToken} />
              </Box>
            </div>

            {/* ============ Side column ============ */}
            <aside className="job-detail-side">
              <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: "var(--radius)" }}>
                <div className="card-head">
                  <span className="card-title">Details</span>
                </div>
                <div className="meta-list">
                  <div className="meta-item">
                    <span className="meta-key">Status</span>
                    <span className="meta-val">
                      <StatusPill status={jobListing.status} />
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key">Company</span>
                    <span className="meta-val">{companyLabel}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key">Location</span>
                    <span className="meta-val">{locationLabel}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key">Salary</span>
                    <span className="meta-val mono">{salaryLabel}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key">Posted</span>
                    <span className="meta-val">{postedLabel}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key">Saved</span>
                    <span className="meta-val">{savedLabel}</span>
                  </div>
                  <div className="meta-item" style={{ alignItems: "flex-start" }}>
                    <span className="meta-key">URL</span>
                    <a
                      href={jobListing.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="meta-val mono"
                      style={{
                        color: "var(--text)",
                        borderBottom: "1px dotted var(--border-strong)",
                        wordBreak: "break-all",
                        textDecoration: "none",
                      }}
                      data-testid="source-url-link"
                    >
                      {jobListing.url}
                    </a>
                  </div>
                  <div className="meta-item">
                    <span className="meta-key">Last attempt</span>
                    <span className="meta-val">{lastAttemptLabel}</span>
                  </div>
                </div>
              </Paper>

              <Paper variant="outlined" sx={{ mt: 2, overflow: "hidden", borderRadius: "var(--radius)" }}>
                <div className="card-head">
                  <span className="card-title">Manage</span>
                </div>
                <div className="manage-list">
                  <button
                    type="button"
                    className="manage-row"
                    onClick={() => { handleUnwiredManageAction("Move to Saved"); }}
                    data-testid="manage-move-saved"
                  >
                    <MoveToInboxOutlinedIcon className="ico" sx={{ fontSize: 14 }} /> Move to Saved
                  </button>
                  <button
                    type="button"
                    className="manage-row"
                    onClick={() => { handleUnwiredManageAction("Mark as Interview"); }}
                    data-testid="manage-mark-interview"
                  >
                    <CalendarMonthOutlinedIcon className="ico" sx={{ fontSize: 14 }} /> Mark as Interview
                  </button>
                  <button
                    type="button"
                    className="manage-row"
                    onClick={() => { handleUnwiredManageAction("Mark as Rejected"); }}
                    data-testid="manage-mark-rejected"
                  >
                    <CloseOutlinedIcon className="ico" sx={{ fontSize: 14 }} /> Mark as Rejected
                  </button>
                  <button
                    type="button"
                    className="manage-row danger"
                    onClick={() => { handleDeleteJob(); }}
                    data-testid="manage-delete-job"
                  >
                    <DeleteOutlineOutlinedIcon className="ico" sx={{ fontSize: 14 }} /> Delete job
                  </button>
                </div>
              </Paper>
            </aside>
          </div>
        </>
      )}

      <Snackbar
        open={snackbarMessage !== ""}
        autoHideDuration={4000}
        onClose={() => setSnackbarMessage("")}
        message={snackbarMessage}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
}

export default JobViewPage;
