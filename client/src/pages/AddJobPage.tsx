import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Container, Typography } from "@mui/material";
import AddJobForm from "../components/AddJobForm";

/**
 * Page for adding a new job listing by URL.
 * After a job is successfully submitted, navigates to the job view page
 * where the user can watch the scraping progress.
 */
function AddJobPage() {
  const navigate = useNavigate();

  const handleJobAdded = useCallback((jobId: number) => {
    navigate(`/jobs/${jobId}`);
  }, [navigate]);

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h3" component="h1" sx={{ mb: 3 }}>
        Add Job
      </Typography>
      <AddJobForm onJobAdded={handleJobAdded} />
    </Container>
  );
}

export default AddJobPage;
