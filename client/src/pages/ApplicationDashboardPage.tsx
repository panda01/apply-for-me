import { useEffect, useState, useCallback, useRef } from "react";
import {
  Container, Typography, CircularProgress, Alert, Box,
  Paper, Chip, Button, List,
  Divider, LinearProgress,
} from "@mui/material";
import {
  PlaylistPlay as PlaylistPlayIcon,
} from "@mui/icons-material";
import {
  getJobListings, applyToJob, startBatchApply, getBatchApplyStatus,
  type JobListingResponse, type BatchApplyStatusResponse,
} from "../services/jobListingsApi";
import JobRow from "../components/JobRow";
import JobSection from "../components/JobSection";
import LiveBrowserView from "../components/LiveBrowserView";

/**
 * Dashboard page for managing and monitoring job applications.
 * Shows jobs grouped by status, with Apply/Apply All buttons,
 * a live iframe during application, and polling for status updates.
 */
function ApplicationDashboardPage() {
  const [jobListings, setJobListings] = useState<JobListingResponse[]>([]);
  const [batchStatus, setBatchStatus] = useState<BatchApplyStatusResponse | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listErrorMessage, setListErrorMessage] = useState("");
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [isStartingBatch, setIsStartingBatch] = useState(false);
  const [applyingJobId, setApplyingJobId] = useState<number | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchListings = useCallback(async () => {
    try {
      const listings = await getJobListings();
      setJobListings(listings);
      setListErrorMessage("");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load job listings";
      setListErrorMessage(errorText);
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  const fetchBatchStatus = useCallback(async () => {
    try {
      const status = await getBatchApplyStatus();
      setBatchStatus(status);
    } catch {
      // Silently ignore batch status fetch errors
    }
  }, []);

  useEffect(() => {
    fetchListings();
    fetchBatchStatus();
  }, [fetchListings, fetchBatchStatus]);

  useEffect(() => {
    const hasActiveApplication = jobListings.some((listing) => listing.status === "applying");

    if (hasActiveApplication) {
      const hasNoExistingPoll = !pollIntervalRef.current;
      if (hasNoExistingPoll) {
        pollIntervalRef.current = setInterval(() => {
          fetchListings();
          fetchBatchStatus();
        }, 3000);
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
  }, [jobListings, fetchListings, fetchBatchStatus]);

  const handleApplyToJob = async (jobId: number) => {
    setApplyingJobId(jobId);
    setActionErrorMessage("");
    try {
      await applyToJob(jobId);
      await fetchListings();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to start application";
      setActionErrorMessage(errorText);
    } finally {
      setApplyingJobId(null);
    }
  };

  const handleStartBatchApply = async () => {
    setIsStartingBatch(true);
    setActionErrorMessage("");
    try {
      await startBatchApply();
      await fetchListings();
      await fetchBatchStatus();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to start batch application";
      setActionErrorMessage(errorText);
    } finally {
      setIsStartingBatch(false);
    }
  };

  const initJobs = jobListings.filter((listing) => listing.status === "init");
  const applyingJobs = jobListings.filter((listing) => listing.status === "applying");
  const appliedJobs = jobListings.filter((listing) => listing.status === "applied");
  const errorJobs = jobListings.filter((listing) => listing.status === "error_applying");
  const closedJobs = jobListings.filter((listing) => listing.status === "closed");

  const currentlyApplyingJob = applyingJobs.length > 0 ? applyingJobs[0] : null;

  const getStatusChip = (status: string) => {
    const statusConfig: Record<string, { color: "default" | "warning" | "success" | "error" | "info"; label: string }> = {
      init: { color: "default", label: "Ready" },
      applying: { color: "info", label: "Applying" },
      applied: { color: "success", label: "Applied" },
      error_applying: { color: "error", label: "Error" },
      closed: { color: "default", label: "Closed" },
    };
    const config = statusConfig[status] ?? { color: "default" as const, label: status };
    return <Chip size="small" color={config.color} label={config.label} />;
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h3" component="h1" sx={{ mb: 3 }}>
        Application Dashboard
      </Typography>

      {isLoadingList && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {listErrorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>{listErrorMessage}</Alert>
      )}

      {actionErrorMessage && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionErrorMessage("")}>
          {actionErrorMessage}
        </Alert>
      )}

      {!isLoadingList && (
        <>
          {/* Live Application View */}
          {currentlyApplyingJob && (
            <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                <CircularProgress size={24} />
                <Typography variant="h5" component="h2">
                  Applying to: {currentlyApplyingJob.title || currentlyApplyingJob.url}
                </Typography>
                {getStatusChip("applying")}
              </Box>

              <LiveBrowserView liveUrl={currentlyApplyingJob.live_url} />
            </Paper>
          )}

          {/* Batch Progress */}
          {batchStatus && batchStatus.isRunning && (
            <Paper elevation={1} sx={{ p: 2, mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                Batch Progress: {batchStatus.completed.length + batchStatus.errors.length} / {batchStatus.totalJobs}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={batchStatus.totalJobs > 0
                  ? ((batchStatus.completed.length + batchStatus.errors.length) / batchStatus.totalJobs) * 100
                  : 0}
                sx={{ mb: 1 }}
              />
              <Typography variant="body2" color="text.secondary">
                {batchStatus.remaining} remaining
                {batchStatus.errors.length > 0 && ` · ${batchStatus.errors.length} errors`}
              </Typography>
            </Paper>
          )}

          {/* Ready to Apply Section */}
          <Paper elevation={1} sx={{ p: 2, mb: 3 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
              <Typography variant="h6">
                Ready to Apply ({initJobs.length})
              </Typography>
              <Button
                variant="contained"
                startIcon={isStartingBatch ? <CircularProgress size={16} color="inherit" /> : <PlaylistPlayIcon />}
                onClick={handleStartBatchApply}
                disabled={isStartingBatch || initJobs.length === 0 || applyingJobs.length > 0}
              >
                Apply to All
              </Button>
            </Box>

            {initJobs.length === 0 && (
              <Typography color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
                No jobs ready to apply to.
              </Typography>
            )}

            <List disablePadding>
              {initJobs.map((listing) => (
                <JobRow
                  key={listing.id}
                  listing={listing}
                  action={{
                    label: "Apply",
                    onClick: handleApplyToJob,
                    disabled: applyingJobId !== null || applyingJobs.length > 0,
                    isLoading: applyingJobId === listing.id,
                  }}
                />
              ))}
            </List>
          </Paper>

          {/* Applied Section */}
          {appliedJobs.length > 0 && (
            <JobSection title="Applied" count={appliedJobs.length}>
              {appliedJobs.map((listing) => (
                <JobRow key={listing.id} listing={listing} statusChip={getStatusChip(listing.status)} />
              ))}
            </JobSection>
          )}

          {/* Closed Section */}
          {closedJobs.length > 0 && (
            <JobSection title="Closed" count={closedJobs.length}>
              {closedJobs.map((listing) => (
                <JobRow key={listing.id} listing={listing} statusChip={getStatusChip(listing.status)} />
              ))}
            </JobSection>
          )}

          {/* Error Section */}
          {errorJobs.length > 0 && (
            <JobSection title="Errors" count={errorJobs.length}>
              {errorJobs.map((listing) => (
                <JobRow
                  key={listing.id}
                  listing={listing}
                  statusChip={getStatusChip(listing.status)}
                  action={{
                    label: "Retry",
                    color: "warning",
                    onClick: handleApplyToJob,
                    disabled: applyingJobId !== null || applyingJobs.length > 0,
                    isLoading: applyingJobId === listing.id,
                  }}
                />
              ))}
            </JobSection>
          )}

          <Divider sx={{ my: 2 }} />

          {/* Summary */}
          <Box sx={{ display: "flex", gap: 2, justifyContent: "center" }}>
            <Chip label={`${initJobs.length} Ready`} color="default" />
            <Chip label={`${applyingJobs.length} In Progress`} color="info" />
            <Chip label={`${appliedJobs.length} Applied`} color="success" />
            <Chip label={`${errorJobs.length} Errors`} color="error" />
            <Chip label={`${closedJobs.length} Closed`} color="default" />
          </Box>
        </>
      )}
    </Container>
  );
}

export default ApplicationDashboardPage;
