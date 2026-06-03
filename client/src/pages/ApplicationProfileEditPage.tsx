import { useEffect, useState, useCallback } from "react";
import { useNavigate, useParams, Link as RouterLink } from "react-router-dom";
import {
  Box, Typography, CircularProgress, Alert, Button, Paper, Link,
} from "@mui/material";
import { ArrowBack as ArrowBackIcon, Delete as DeleteIcon } from "@mui/icons-material";
import ApplicationProfileForm from "../components/ApplicationProfileForm";
import {
  getApplicationProfile,
  createApplicationProfile,
  updateApplicationProfile,
  deleteApplicationProfile,
  type ApplicationProfileResponse,
  type ApplicationProfileInput,
} from "../services/applicationProfilesApi";

/**
 * Standalone create-or-edit page for an ApplicationProfile. Replaces the
 * MUI Dialog that used to live inside ApplicationProfilesPage. The same
 * component handles both modes and decides by inspecting the route param:
 *
 *   - Route `/profiles/new`        → useParams().id is undefined ⇒ CREATE
 *   - Route `/profiles/:id/edit`   → useParams().id is a string  ⇒ EDIT
 *
 * The form fields themselves are intentionally NOT duplicated here —
 * the existing `<ApplicationProfileForm />` is reused verbatim inside
 * the `.form-col`. The right `.form-preview-col` is a v1 placeholder
 * card; the design's fake resume/cover-letter previews can be filled in
 * later without changing the page's data wiring.
 *
 * Why fetch a single profile via getApplicationProfile (not the list
 * endpoint and search): `applicationProfilesApi.ts` already exposes a
 * single-record GET, so we use it for fewer wire bytes and a clean 404
 * on bad ids. If the id is missing or malformed we fall back to CREATE.
 */
function ApplicationProfileEditPage() {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const rawId = params.id;
  const parsedId = rawId === undefined ? null : Number(rawId);
  const isEditMode = parsedId !== null && Number.isInteger(parsedId) && parsedId > 0;
  const profileId = isEditMode ? parsedId : null;

  const [initialValues, setInitialValues] = useState<ApplicationProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(isEditMode);
  const [loadError, setLoadError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  /**
   * Fetches the profile being edited. Only invoked in EDIT mode (the create
   * route skips this entirely and the form starts blank).
   * @param {number} id - The profile id to load
   * @returns {Promise<void>}
   */
  const loadProfile = useCallback(async (id: number): Promise<void> => {
    setIsLoading(true);
    setLoadError("");
    try {
      const record = await getApplicationProfile(id);
      setInitialValues(record);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load application profile";
      setLoadError(errorText);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profileId === null) {
      return;
    }
    loadProfile(profileId);
  }, [profileId, loadProfile]);

  /**
   * Submits the form and returns the saved profile so the form can upload any
   * staged resume / cover-letter files against the new/updated id. In both
   * CREATE and EDIT mode the user is left on the page with a "Saved" indicator
   * — we intentionally do NOT navigate away here, because the form awaits its
   * file uploads after this promise resolves and navigating would unmount the
   * form mid-upload. After a create, the freshly returned record becomes the
   * page's initialValues, transitioning the page into edit mode.
   * @param {ApplicationProfileInput} input - The validated form payload
   * @returns {Promise<ApplicationProfileResponse>} The created or updated profile
   * @throws {Error} If the save fails (surfaced to the form via submitError)
   */
  const handleSubmit = async (input: ApplicationProfileInput): Promise<ApplicationProfileResponse> => {
    setIsSaving(true);
    setSubmitError("");
    try {
      const saved = isEditMode && profileId !== null
        ? await updateApplicationProfile(profileId, input)
        : await createApplicationProfile(input);
      setInitialValues(saved);
      setSaveStatus("Saved just now");
      return saved;
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to save application profile";
      setSubmitError(errorText);
      throw err instanceof Error ? err : new Error(errorText);
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Returns to the profiles list without saving.
   */
  const handleCancel = (): void => {
    navigate("/profiles");
  };

  /**
   * EDIT-mode only. Prompts for confirmation, deletes the profile, and
   * navigates back to the list. CREATE mode never renders the danger zone.
   * @returns {Promise<void>}
   */
  const handleDelete = async (): Promise<void> => {
    if (profileId === null || initialValues === null) {
      return;
    }
    const isConfirmed = window.confirm(`Delete profile "${initialValues.name}"? This can't be undone.`);
    if (!isConfirmed) {
      return;
    }
    setIsDeleting(true);
    setSubmitError("");
    try {
      await deleteApplicationProfile(profileId);
      navigate("/profiles");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to delete application profile";
      setSubmitError(errorText);
      setIsDeleting(false);
    }
  };

  const pageHeading = isEditMode
    ? (initialValues === null ? "Edit profile" : `Edit · ${initialValues.name}`)
    : "New application profile";
  const pageSubtitle = isEditMode
    ? "Update the personal info, documents, and preferences for this profile."
    : "Set up the personal info, documents, and preferences used when this profile is selected.";

  return (
    <Box>
      <Box className="page-head">
        <Box>
          <Link
            component={RouterLink}
            to="/profiles"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              mb: 1,
              fontSize: 12.5,
              color: "var(--text-muted)",
              textDecoration: "none",
            }}
          >
            <ArrowBackIcon sx={{ fontSize: 14 }} />
            Back to profiles
          </Link>
          <Typography component="h1" className="page-title">{pageHeading}</Typography>
          <Typography component="p" className="page-sub">{pageSubtitle}</Typography>
        </Box>
      </Box>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError("")}>
          {loadError}
        </Alert>
      )}

      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!isLoading && (!isEditMode || initialValues !== null) && (
        <Box className="form-split">
          <Box className="form-col">
            <ApplicationProfileForm
              initialValues={isEditMode ? initialValues : null}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              isSaving={isSaving}
              submitError={submitError}
            />

            {isEditMode && initialValues !== null && (
              <Box sx={{ mt: 4 }}>
                <Box className="section-head">
                  <h3 style={{ color: "oklch(0.5 0.15 25)" }}>Danger zone</h3>
                </Box>
                <Box className="danger-zone">
                  <Box>
                    <Box sx={{ fontWeight: 500 }}>Delete this profile</Box>
                    <Box sx={{ fontSize: 12, color: "var(--text-muted)", mt: "2px" }}>
                      Removes the profile from the picker. Applications already submitted with it are kept.
                    </Box>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon fontSize="small" />}
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? <CircularProgress size={16} /> : "Delete profile"}
                  </Button>
                </Box>
              </Box>
            )}

            {saveStatus !== "" && (
              <Box className="form-actions">
                <span className="save-status">{saveStatus}</span>
              </Box>
            )}
          </Box>

          <Paper variant="outlined" className="form-preview-col" sx={{ p: 2 }}>
            <Box sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)", fontWeight: 500 }}>
              Document previews
            </Box>
            <Box sx={{ fontSize: 12.5, color: "var(--text-muted)", mt: 1 }}>
              Resume and cover-letter previews coming soon. Once your documents are uploaded they'll render here as a side-by-side reference.
            </Box>
          </Paper>
        </Box>
      )}
    </Box>
  );
}

export default ApplicationProfileEditPage;
