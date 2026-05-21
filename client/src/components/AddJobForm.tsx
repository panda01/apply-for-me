import { useState, useEffect, type FormEvent } from "react";
import { Box, TextField, Button, CircularProgress, Alert } from "@mui/material";
import { createJobListing } from "../services/jobListingsApi";
import { listManagedContainers } from "../services/managedContainersApi";

interface AddJobFormProps {
  /** Callback invoked after a job listing is successfully submitted, receives the new listing ID */
  onJobAdded: (jobId: number) => void;
}

/**
 * Form component for adding a new job listing by URL.
 * Saves the URL to the database without triggering any scraping.
 *
 * Surfaces a soft warning when no managed container is running so the user
 * knows the smart-proxy scrape will fail until they spawn one on the
 * /containers page. The form still allows submission — the row is created
 * with just the URL and the user can Fetch Data later once a container is up.
 *
 * @param {AddJobFormProps} props
 * @param {(jobId: number) => void} props.onJobAdded - Called with the new listing ID when the job is successfully saved
 */
function AddJobForm({ onJobAdded }: AddJobFormProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [hasRunningContainer, setHasRunningContainer] = useState<boolean | null>(null);

  // On mount, check whether at least one managed container is running so we
  // can warn the user that Fetch Data won't work yet. Failures here are
  // intentionally silent — the worst case is the warning doesn't show.
  useEffect(() => {
    listManagedContainers()
      .then((containers) => {
        const isAnyRunning = containers.some((c) => c.status === "running");
        setHasRunningContainer(isAnyRunning);
      })
      .catch(() => {
        setHasRunningContainer(null);
      });
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsLoading(true);

    try {
      const createdListing = await createJobListing(url);
      setUrl("");
      setSuccessMessage("Job saved successfully!");
      onJobAdded(createdListing.id);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "An unexpected error occurred";
      setErrorMessage(errorText);
    } finally {
      setIsLoading(false);
    }
  };

  const shouldShowNoContainerWarning = hasRunningContainer === false;

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 3 }}>
      {shouldShowNoContainerWarning && (
        <Alert severity="info" data-testid="no-container-warning">
          No managed container is running yet. Fetch Data will spin one up automatically the first time it runs (this may add ~30s on the first request).
        </Alert>
      )}
      <TextField
        label="Job Listing URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://linkedin.com/jobs/view/..."
        fullWidth
        required
        disabled={isLoading}
      />
      <Button
        type="submit"
        variant="contained"
        disabled={isLoading || !url.trim()}
      >
        {isLoading ? <CircularProgress size={24} /> : "Add Job"}
      </Button>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {successMessage && <Alert severity="info">{successMessage}</Alert>}
    </Box>
  );
}

export default AddJobForm;
