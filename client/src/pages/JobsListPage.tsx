import { useEffect, useState, useCallback, useRef } from "react";
import { Container, Typography, CircularProgress, Alert, Box } from "@mui/material";
import { getJobListings, type JobListingResponse } from "../services/jobListingsApi";
import JobList from "../components/JobList";

/**
 * Page that displays all job listings with automatic polling.
 * Fetches listings on mount and polls every 5 seconds while any listing is pending.
 */
function JobsListPage() {
  const [jobListings, setJobListings] = useState<JobListingResponse[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listErrorMessage, setListErrorMessage] = useState("");
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

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  useEffect(() => {
    const hasPendingListings = jobListings.some((listing) => listing.status === "pending");

    if (hasPendingListings) {
      const hasNoExistingPoll = !pollIntervalRef.current;
      if (hasNoExistingPoll) {
        pollIntervalRef.current = setInterval(fetchListings, 5000);
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
  }, [jobListings, fetchListings]);

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h3" component="h1" sx={{ mb: 3 }}>
        Job Listings
      </Typography>

      {isLoadingList && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {listErrorMessage && (
        <Alert severity="error" sx={{ mb: 2 }}>{listErrorMessage}</Alert>
      )}

      {!isLoadingList && (
        <JobList jobListings={jobListings} onJobDeleted={fetchListings} />
      )}
    </Container>
  );
}

export default JobsListPage;
