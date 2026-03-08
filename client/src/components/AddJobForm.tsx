import { useState, type FormEvent } from "react";
import { Box, TextField, Button, CircularProgress, Alert } from "@mui/material";
import { createJobListing } from "../services/jobListingsApi";

interface AddJobFormProps {
  /** Callback invoked after a job listing is successfully submitted, receives the new listing ID */
  onJobAdded: (jobId: number) => void;
}

/**
 * Form component for adding a new job listing by URL.
 * Submits the URL to the backend for background scraping.
 * @param {AddJobFormProps} props
 * @param {(jobId: number) => void} props.onJobAdded - Called with the new listing ID when the job is successfully submitted
 */
function AddJobForm({ onJobAdded }: AddJobFormProps) {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsLoading(true);

    try {
      const createdListing = await createJobListing(url);
      setUrl("");
      setSuccessMessage("Scraping job details... This may take up to 30 seconds.");
      onJobAdded(createdListing.id);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "An unexpected error occurred";
      setErrorMessage(errorText);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 3 }}>
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
