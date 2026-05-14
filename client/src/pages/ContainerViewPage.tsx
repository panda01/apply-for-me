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
import AnalyzePanel from "../components/AnalyzePanel";

/**
 * The visual props the status Chip will render for the current ping state.
 * Pulled out as a discrete type so the small selector function that builds
 * it is easier to test and reason about than an inline render expression.
 */
interface StatusChipProps {
  color: "success" | "error" | "default";
  label: string;
  withSpinner: boolean;
}

/**
 * Page that displays a single managed container's details and provides:
 *  - A "Ping health" button that proxies a health check to the container
 *  - A "Delete" button that stops + removes the underlying Docker container
 *
 * On mount (after the container record loads), the page also fires an
 * automatic health ping so the visible status reflects the container's
 * actual liveness — not just the persisted DB status field. The status Chip
 * shows a spinner + "Checking..." while a ping is in flight, then turns
 * green/red based on the ping outcome. Failures during the auto-ping are
 * silent (red chip only); user-triggered ping failures additionally show
 * the existing error Alert below.
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
  const [hasUserPingedManually, setHasUserPingedManually] = useState(false);
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
   * Runs the actual health ping against the loaded container. Shared by both
   * the auto-ping effect (which runs on mount once the container is loaded)
   * and the manual "Ping health" button. The caller signals which path
   * triggered it; auto-ping failures stay silent in the Alert area and only
   * surface via the red status Chip, while manual failures additionally
   * render the existing error Alert below.
   *
   * @param {number} containerId - The managed container's database id to ping
   * @param {boolean} triggeredByUser - True when called from the button click; false from the auto-ping effect
   * @returns {Promise<void>} Resolves once the ping result (or error) is set
   */
  const runHealthPing = useCallback(async (containerId: number, triggeredByUser: boolean): Promise<void> => {
    setIsPinging(true);
    setPingError("");
    setPingResult(null);
    if (triggeredByUser) {
      setHasUserPingedManually(true);
    }
    try {
      const result = await pingManagedContainerHealth(containerId);
      setPingResult(result);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Health check failed";
      setPingError(errorText);
    } finally {
      setIsPinging(false);
    }
  }, []);

  /**
   * Fires the automatic health ping once the container record has loaded.
   * The container id from the URL is the source of truth — we re-fire if the
   * loaded record's id changes so navigating between containers stays in
   * sync. The ping is treated as not-user-triggered, so failures stay silent
   * in the Alert area.
   */
  useEffect(() => {
    const hasContainerLoaded = container !== null;
    if (!hasContainerLoaded) {
      return;
    }
    void runHealthPing(container.id, false);
  }, [container, runHealthPing]);

  /**
   * Click handler for the "Ping health" button. Delegates to the shared
   * runHealthPing helper, marking the call as user-triggered so failures
   * also surface as a visible Alert.
   */
  const handlePingHealth = async () => {
    const parsedId = parseInt(id ?? "", 10);
    const isInvalidId = isNaN(parsedId);
    if (isInvalidId) return;
    await runHealthPing(parsedId, true);
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

  /**
   * Derives the Chip props for the current ping state. Loading wins over
   * everything else; otherwise an error shows red "unhealthy", a success
   * shows the green ping status string, and the absence of any ping data
   * falls back to the persisted DB status (which only flashes briefly
   * before the auto-ping resolves).
   *
   * @param {object} state - The relevant ping/container state for the selector
   * @returns {StatusChipProps} The visual props the Chip should render with
   */
  function deriveStatusChipProps(state: {
    isPinging: boolean;
    pingError: string;
    pingResult: ManagedContainerHealthResponse | null;
    fallbackStatus: string;
  }): StatusChipProps {
    if (state.isPinging) {
      return { color: "default", label: "Checking...", withSpinner: true };
    }
    if (state.pingError.length > 0) {
      return { color: "error", label: "unhealthy", withSpinner: false };
    }
    if (state.pingResult !== null) {
      return { color: "success", label: state.pingResult.status, withSpinner: false };
    }
    return { color: "default", label: state.fallbackStatus, withSpinner: false };
  }

  const statusChipProps = container !== null
    ? deriveStatusChipProps({
      isPinging,
      pingError,
      pingResult,
      fallbackStatus: container.status,
    })
    : null;

  const shouldShowPingErrorAlert = hasUserPingedManually && pingError.length > 0;

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <BackLink to="/containers">Back to Containers</BackLink>

      <LoadingOrErrorPanel
        isLoading={isLoading}
        errorMessage={errorMessage}
        onClearError={() => setErrorMessage("")}
      />

      {container && statusChipProps && (
        <>
          <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }} data-testid="container-name">
                {container.name}
              </Typography>
              <Chip
                color={statusChipProps.color}
                label={statusChipProps.label}
                data-testid="container-status-chip"
                icon={statusChipProps.withSpinner
                  ? <CircularProgress size={12} color="inherit" data-testid="container-status-spinner" />
                  : undefined}
              />
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

          <AnalyzePanel containerId={container.id} />

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

          {shouldShowPingErrorAlert && (
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
