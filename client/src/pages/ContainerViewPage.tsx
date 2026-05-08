import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Container, Typography, CircularProgress, Alert, Box, Paper, Button, Chip, Divider,
} from "@mui/material";
import {
  HealthAndSafety as HealthIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import {
  getManagedContainer,
  deleteManagedContainer,
  pingManagedContainerHealth,
  type ManagedContainerResponse,
  type ManagedContainerHealthResponse,
} from "../services/managedContainersApi";
import BackLink from "../components/BackLink";
import LoadingOrErrorPanel from "../components/LoadingOrErrorPanel";
import LabeledField from "../components/LabeledField";
import ScreenshotPanel from "../components/ScreenshotPanel";

/**
 * Page that displays a single managed container's details and provides:
 *  - A "Ping health" button that proxies a health check to the container
 *  - A "Delete" button that stops + removes the underlying Docker container
 */
function ContainerViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [container, setContainer] = useState<ManagedContainerResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPinging, setIsPinging] = useState(false);
  const [pingResult, setPingResult] = useState<ManagedContainerHealthResponse | null>(null);
  const [pingError, setPingError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  /**
   * Loads the managed container by the URL param id.
   * Sets loading and error state accordingly.
   */
  const fetchContainer = useCallback(async () => {
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
    if (isInvalidId) {
      setErrorMessage("Invalid container ID");
      setIsLoading(false);
      return;
    }

    try {
      const record = await getManagedContainer(parsedId);
      setContainer(record);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load managed container";
      setErrorMessage(errorText);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchContainer();
  }, [fetchContainer]);

  /**
   * Proxies a health-check request to the container through the backend
   * and renders the response (or an error) in the panel below.
   */
  const handlePingHealth = async () => {
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
    if (isInvalidId) return;

    setIsPinging(true);
    setPingError("");
    setPingResult(null);
    try {
      const result = await pingManagedContainerHealth(parsedId);
      setPingResult(result);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Health check failed";
      setPingError(errorText);
    } finally {
      setIsPinging(false);
    }
  };

  /**
   * Stops + removes the underlying Docker container, deletes the record,
   * and navigates back to the container list.
   */
  const handleDelete = async () => {
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
    if (isInvalidId) return;

    setIsDeleting(true);
    setErrorMessage("");
    try {
      await deleteManagedContainer(parsedId);
      navigate("/containers");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to delete managed container";
      setErrorMessage(errorText);
      setIsDeleting(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <BackLink to="/containers">Back to Containers</BackLink>

      <LoadingOrErrorPanel
        isLoading={isLoading}
        errorMessage={errorMessage}
        onClearError={() => setErrorMessage("")}
      />

      {container && (
        <>
          <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }} data-testid="container-name">
                {container.name}
              </Typography>
              <Chip color="success" label={container.status} />
            </Box>

            <Divider sx={{ mb: 2 }} />

            <LabeledField label="Docker ID" breakLongValues>{container.dockerId}</LabeledField>
            <LabeledField label="Host Port" valueTestId="container-host-port">{container.hostPort}</LabeledField>
            <LabeledField label="WireGuard Config" valueTestId="container-wg-config">
              {container.wgConfigName ?? "—"}
            </LabeledField>
            <LabeledField label="Created">{new Date(container.created_date).toLocaleString()}</LabeledField>

            <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
              <Button
                variant="contained"
                startIcon={isPinging ? <CircularProgress size={16} color="inherit" /> : <HealthIcon />}
                onClick={handlePingHealth}
                disabled={isPinging}
              >
                {isPinging ? "Pinging..." : "Ping health"}
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={isDeleting ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </Box>
          </Paper>

          <ScreenshotPanel containerId={container.id} />

          {pingResult && (
            <Paper elevation={1} sx={{ p: 3, mb: 2 }} data-testid="ping-success">
              <Typography variant="h6" sx={{ mb: 1 }}>Health Check Result</Typography>
              <Typography>
                <strong>Status:</strong> <span data-testid="ping-status">{pingResult.status}</span>
              </Typography>
              <Typography>
                <strong>Name:</strong> <span data-testid="ping-name">{pingResult.name}</span>
              </Typography>
            </Paper>
          )}

          {pingError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPingError("")} data-testid="ping-error">
              {pingError}
            </Alert>
          )}
        </>
      )}
    </Container>
  );
}

export default ContainerViewPage;
