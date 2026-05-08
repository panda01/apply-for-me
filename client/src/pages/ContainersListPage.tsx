import { useEffect, useState, useCallback } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Container, Typography, CircularProgress, Alert, Box, Button, Link,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  IconButton,
} from "@mui/material";
import { Add as AddIcon, Visibility as ViewIcon, Delete as DeleteIcon } from "@mui/icons-material";
import {
  listManagedContainers,
  createManagedContainer,
  deleteManagedContainer,
  type ManagedContainerResponse,
} from "../services/managedContainersApi";

/**
 * Page that displays all managed Docker containers in a table with View and Delete actions,
 * and an inline "New Container" button that spawns a container without navigating away.
 */
function ContainersListPage() {
  const navigate = useNavigate();
  const [containers, setContainers] = useState<ManagedContainerResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  /**
   * Fetches the list of managed containers from the API.
   * Sets loading and error state accordingly.
   */
  const fetchContainers = useCallback(async () => {
    try {
      const records = await listManagedContainers();
      setContainers(records);
      setErrorMessage("");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load managed containers";
      setErrorMessage(errorText);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  /**
   * Spawns a new managed container in-place and refreshes the list once it returns.
   * Surfaces backend errors via the existing error alert.
   */
  const handleCreate = async () => {
    setIsCreating(true);
    setErrorMessage("");
    try {
      await createManagedContainer();
      await fetchContainers();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to create managed container";
      setErrorMessage(errorText);
    } finally {
      setIsCreating(false);
    }
  };

  /**
   * Deletes a managed container by id and refreshes the list on success.
   * @param {number} id - The id of the managed container to delete
   */
  const handleDelete = async (id: number) => {
    setDeletingId(id);
    setErrorMessage("");
    try {
      await deleteManagedContainer(id);
      await fetchContainers();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to delete managed container";
      setErrorMessage(errorText);
    } finally {
      setDeletingId(null);
    }
  };

  const hasContainers = containers.length > 0;

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h3" component="h1">
          Managed Containers
        </Typography>
        <Button
          variant="contained"
          startIcon={isCreating ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
          onClick={handleCreate}
          disabled={isCreating}
        >
          {isCreating ? "Creating..." : "New Container"}
        </Button>
      </Box>

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage("")}>
          {errorMessage}
        </Alert>
      )}

      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!isLoading && !hasContainers && (
        <Typography color="text.secondary" sx={{ textAlign: "center", mt: 4 }}>
          No containers yet. Click &quot;New Container&quot; to spin one up.
        </Typography>
      )}

      {!isLoading && hasContainers && (
        <TableContainer component={Paper}>
          <Table aria-label="managed containers table">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Host Port</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {containers.map((container) => (
                <TableRow key={container.id} data-testid={`container-row-${container.id}`}>
                  <TableCell>
                    <Link component={RouterLink} to={`/containers/${String(container.id)}`}>
                      {container.name}
                    </Link>
                  </TableCell>
                  <TableCell>{container.hostPort}</TableCell>
                  <TableCell>{container.status}</TableCell>
                  <TableCell>{new Date(container.created_date).toLocaleString()}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      aria-label={`view ${container.name}`}
                      onClick={() => navigate(`/containers/${String(container.id)}`)}
                    >
                      <ViewIcon />
                    </IconButton>
                    <IconButton
                      aria-label={`delete ${container.name}`}
                      onClick={() => handleDelete(container.id)}
                      disabled={deletingId === container.id}
                    >
                      {deletingId === container.id ? <CircularProgress size={20} /> : <DeleteIcon />}
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Container>
  );
}

export default ContainersListPage;
