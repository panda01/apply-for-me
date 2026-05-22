import { useEffect, useState, useCallback } from "react";
import {
  Container, Typography, CircularProgress, Alert, Box, Button, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton,
  Dialog, DialogTitle, DialogContent,
} from "@mui/material";
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from "@mui/icons-material";
import {
  listApplicationProfiles,
  createApplicationProfile,
  updateApplicationProfile,
  deleteApplicationProfile,
  type ApplicationProfileResponse,
  type ApplicationProfileInput,
} from "../services/applicationProfilesApi";
import ApplicationProfileForm from "../components/ApplicationProfileForm";

/**
 * Discriminated union describing which dialog (if any) is currently open.
 * Keeps the dialog open/closed state, the edit target, and the in-flight
 * submit error in a single source of truth so callers can't ever render the
 * dialog without a valid target.
 */
type DialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; target: ApplicationProfileResponse };

/**
 * Page that manages the user's ApplicationProfile rows. Lists profiles in a
 * table, opens an inline dialog for create/edit, and supports inline delete.
 * Used in conjunction with the apply dashboard's profile picker — each row
 * here corresponds to one selectable profile there.
 */
function ApplicationProfilesPage() {
  const [profiles, setProfiles] = useState<ApplicationProfileResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchProfiles = useCallback(async () => {
    try {
      const records = await listApplicationProfiles();
      setProfiles(records);
      setListError("");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load application profiles";
      setListError(errorText);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const openCreateDialog = () => {
    setSaveError("");
    setDialog({ mode: "create" });
  };

  const openEditDialog = (target: ApplicationProfileResponse) => {
    setSaveError("");
    setDialog({ mode: "edit", target });
  };

  const closeDialog = () => {
    setDialog({ mode: "closed" });
    setSaveError("");
  };

  const handleSubmit = async (input: ApplicationProfileInput) => {
    setIsSaving(true);
    setSaveError("");
    try {
      if (dialog.mode === "create") {
        await createApplicationProfile(input);
      } else if (dialog.mode === "edit") {
        await updateApplicationProfile(dialog.target.id, input);
      }
      await fetchProfiles();
      closeDialog();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to save application profile";
      setSaveError(errorText);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (profile: ApplicationProfileResponse) => {
    const isConfirmed = window.confirm(`Delete profile "${profile.name}"? This can't be undone.`);
    if (!isConfirmed) {
      return;
    }
    setDeletingId(profile.id);
    setListError("");
    try {
      await deleteApplicationProfile(profile.id);
      await fetchProfiles();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to delete application profile";
      setListError(errorText);
    } finally {
      setDeletingId(null);
    }
  };

  const hasProfiles = profiles.length > 0;
  const initialValues = dialog.mode === "edit" ? dialog.target : null;

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h3" component="h1">
          Application Profiles
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openCreateDialog}
        >
          New Profile
        </Button>
      </Box>

      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Bundles of personal info used to fill out job-application forms. Pick one on the Apply dashboard before kicking off an application.
      </Typography>

      {listError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setListError("")}>
          {listError}
        </Alert>
      )}

      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!isLoading && !hasProfiles && (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            No application profiles yet.
          </Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={openCreateDialog}>
            Create your first profile
          </Button>
        </Paper>
      )}

      {!isLoading && hasProfiles && (
        <TableContainer component={Paper}>
          <Table aria-label="application profiles table">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Identity</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {profiles.map((profile) => (
                <TableRow key={profile.id} data-testid={`profile-row-${String(profile.id)}`}>
                  <TableCell>{profile.name}</TableCell>
                  <TableCell>{`${profile.firstName} ${profile.lastName}`}</TableCell>
                  <TableCell>{profile.email}</TableCell>
                  <TableCell>{new Date(profile.created_date).toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      aria-label={`edit ${profile.name}`}
                      onClick={() => openEditDialog(profile)}
                    >
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      aria-label={`delete ${profile.name}`}
                      onClick={() => handleDelete(profile)}
                      disabled={deletingId === profile.id}
                    >
                      {deletingId === profile.id ? <CircularProgress size={20} /> : <DeleteIcon />}
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog
        open={dialog.mode !== "closed"}
        onClose={closeDialog}
        // Saving state guards the form's Cancel/submit buttons; the dialog's
        // backdrop-close behavior matches the rest of the app's dialogs.
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          {dialog.mode === "edit" ? `Edit profile: ${dialog.target.name}` : "New application profile"}
        </DialogTitle>
        <DialogContent>
          <ApplicationProfileForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            onCancel={closeDialog}
            isSaving={isSaving}
            submitError={saveError}
          />
        </DialogContent>
      </Dialog>
    </Container>
  );
}

export default ApplicationProfilesPage;
