import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  Container, Typography, CircularProgress, Alert, Box,
  Paper, Chip, Button, Divider,
} from "@mui/material";
import { ArrowBack as ArrowBackIcon } from "@mui/icons-material";
import { getJobListing, type JobListingResponse } from "../services/jobListingsApi";

/**
 * Page that displays the full details of a single job listing.
 * When the listing is pending, shows a live browser view iframe and polls for updates.
 * When completed or failed, shows the final job details.
 */
function JobViewPage() {
  const { id } = useParams<{ id: string }>();
  const [jobListing, setJobListing] = useState<JobListingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    const isPending = jobListing?.status === "pending";

    if (isPending) {
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
  }, [jobListing, fetchJobListing]);

  const getStatusChip = (status: string) => {
    const statusConfig: Record<string, { color: "warning" | "success" | "error"; label: string }> = {
      pending: { color: "warning", label: "Pending" },
      completed: { color: "success", label: "Completed" },
      failed: { color: "error", label: "Failed" },
    };
    const config = statusConfig[status] ?? { color: "warning" as const, label: status };
    return <Chip color={config.color} label={config.label} />;
  };

  const isPending = jobListing?.status === "pending";
  const hasLiveUrl = !!jobListing?.live_url;

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

      {jobListing && isPending && (
        <Paper elevation={2} sx={{ p: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
            <CircularProgress size={24} />
            <Typography variant="h5" component="h1">
              Scraping Job Details...
            </Typography>
            {getStatusChip(jobListing.status)}
          </Box>

          <Typography color="text.secondary" sx={{ mb: 2 }}>
            The browser agent is extracting job details from the posted URL. This may take up to a minute.
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

      {jobListing && !isPending && (
        <Paper elevation={2} sx={{ p: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
            <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
              {jobListing.title || "Untitled"}
            </Typography>
            {getStatusChip(jobListing.status)}
          </Box>

          <Divider sx={{ mb: 2 }} />

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

          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Post Date
          </Typography>
          <Typography sx={{ mb: 2 }}>
            {new Date(jobListing.post_date).toLocaleDateString()}
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
    </Container>
  );
}

export default JobViewPage;
