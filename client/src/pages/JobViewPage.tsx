import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  Container, Typography, CircularProgress, Alert, Box,
  Paper, Chip, Button, Divider,
} from "@mui/material";
import {
  ArrowBack as ArrowBackIcon,
  PlayArrow as PlayArrowIcon,
  Download as DownloadIcon,
} from "@mui/icons-material";
import { getJobListing, fetchJobData, applyToJob, type JobListingResponse } from "../services/jobListingsApi";

/**
 * Page that displays the full details of a single job listing.
 * Shows the saved URL with action buttons to fetch data or apply.
 * When applying, shows a live browser view iframe and polls for updates.
 * When data has been fetched, shows the full job details including salary.
 */
function JobViewPage() {
  const { id } = useParams<{ id: string }>();
  const [jobListing, setJobListing] = useState<JobListingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [isStartingApply, setIsStartingApply] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState("");
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

  useEffect(() => {
    fetchJobListing();
  }, [fetchJobListing]);

  /** Poll every 3 seconds while the job is applying or while data is being fetched */
  useEffect(() => {
    const isApplying = jobListing?.status === "applying";
    const shouldPoll = isApplying || isFetchingData;

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
  }, [jobListing, isFetchingData, fetchJobListing]);

  /** Stop the fetch-data polling once title has been populated */
  useEffect(() => {
    const hasTitle = !!jobListing?.title;
    if (hasTitle && isFetchingData) {
      setIsFetchingData(false);
    }
  }, [jobListing?.title, isFetchingData]);

  /**
   * Triggers background scraping for this job listing.
   * Starts polling to show updated data once scraping completes.
   */
  const handleFetchData = async () => {
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
   * Starts the application process for this job listing.
   * Transitions the page to show the live browser iframe.
   */
  const handleApply = async () => {
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
    if (isInvalidId) return;

    setIsStartingApply(true);
    setActionErrorMessage("");
    try {
      await applyToJob(parsedId);
      await fetchJobListing();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to start application";
      setActionErrorMessage(errorText);
    } finally {
      setIsStartingApply(false);
    }
  };

  /**
   * Returns a colored Chip component for the given job status string.
   * @param {string} status - The job listing status value
   * @returns {JSX.Element} A MUI Chip with appropriate color and label
   */
  const getStatusChip = (status: string) => {
    const statusConfig: Record<string, { color: "default" | "warning" | "success" | "error" | "info"; label: string }> = {
      init: { color: "default", label: "Ready" },
      applying: { color: "info", label: "Applying" },
      applied: { color: "success", label: "Applied" },
      error_applying: { color: "error", label: "Error" },
      closed: { color: "default", label: "Closed" },
    };
    const config = statusConfig[status] ?? { color: "warning" as const, label: status };
    return <Chip color={config.color} label={config.label} />;
  };

  const isApplying = jobListing?.status === "applying";
  const hasLiveUrl = !!jobListing?.live_url;
  const hasJobDetails = !!jobListing?.title;
  const canApply = jobListing?.status === "init" || jobListing?.status === "error_applying";

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Button
        component={RouterLink}
        to="/jobs"
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 2 }}
      >
        Back to Jobs List
      </Button>

      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>
      )}

      {actionErrorMessage && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionErrorMessage("")}>
          {actionErrorMessage}
        </Alert>
      )}

      {jobListing && (
        <>
          {/* Header with URL and status */}
          <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
                {hasJobDetails ? jobListing.title : "Untitled"}
              </Typography>
              {getStatusChip(jobListing.status)}
            </Box>

            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              URL
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

            {/* Action buttons */}
            <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
              <Button
                variant="outlined"
                startIcon={isFetchingData ? <CircularProgress size={16} /> : <DownloadIcon />}
                onClick={handleFetchData}
                disabled={isFetchingData}
              >
                {isFetchingData ? "Fetching Data..." : "Fetch Data"}
              </Button>

              {canApply && (
                <Button
                  variant="contained"
                  startIcon={isStartingApply ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                  onClick={handleApply}
                  disabled={isStartingApply || isApplying}
                >
                  {isStartingApply ? "Starting..." : "Apply"}
                </Button>
              )}
            </Box>
          </Paper>

          {/* Live Application View — shown when applying */}
          {isApplying && (
            <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                <CircularProgress size={24} />
                <Typography variant="h5" component="h2">
                  Applying to Job...
                </Typography>
              </Box>

              <Typography color="text.secondary" sx={{ mb: 2 }}>
                The browser agent is applying to this job. This may take a few minutes.
              </Typography>

              {hasLiveUrl && (
                <Box
                  component="iframe"
                  src={jobListing.live_url!}
                  title="Browser Use Live View"
                  sx={{
                    width: "100%",
                    height: 500,
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                  }}
                  sandbox="allow-scripts allow-same-origin"
                />
              )}

              {!hasLiveUrl && (
                <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300, bgcolor: "grey.100", borderRadius: 1 }}>
                  <Box sx={{ textAlign: "center" }}>
                    <CircularProgress size={32} sx={{ mb: 1 }} />
                    <Typography color="text.secondary">
                      Waiting for browser session to start...
                    </Typography>
                  </Box>
                </Box>
              )}
            </Paper>
          )}

          {/* Job Details — shown when data has been fetched */}
          {hasJobDetails && !isApplying && (
            <Paper elevation={2} sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Job Details
              </Typography>

              <Divider sx={{ mb: 2 }} />

              {jobListing.salary && (
                <>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Salary
                  </Typography>
                  <Typography sx={{ mb: 2 }}>
                    {jobListing.salary}
                  </Typography>
                </>
              )}

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Post Date
              </Typography>
              <Typography sx={{ mb: 2 }}>
                {jobListing.post_date ? new Date(jobListing.post_date).toLocaleDateString() : "Unknown"}
              </Typography>

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Added On
              </Typography>
              <Typography sx={{ mb: 2 }}>
                {new Date(jobListing.created_date).toLocaleDateString()}
              </Typography>

              <Divider sx={{ mb: 2 }} />

              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Description
              </Typography>
              <Typography sx={{ whiteSpace: "pre-wrap" }}>
                {jobListing.description || "No description available."}
              </Typography>
            </Paper>
          )}

          {/* No data yet message — shown when data hasn't been fetched */}
          {!hasJobDetails && !isApplying && (
            <Paper elevation={1} sx={{ p: 3, textAlign: "center" }}>
              <Typography color="text.secondary">
                No job details yet. Click &quot;Fetch Data&quot; to scrape the job listing for title, description, salary, and post date.
              </Typography>
            </Paper>
          )}
        </>
      )}
    </Container>
  );
}

export default JobViewPage;
