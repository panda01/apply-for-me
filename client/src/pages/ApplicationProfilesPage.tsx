import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Typography, CircularProgress, Alert, Button, Paper, IconButton,
  Tooltip,
} from "@mui/material";
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from "@mui/icons-material";
import {
  listApplicationProfiles,
  deleteApplicationProfile,
  WORK_AUTHORIZATION_LABELS,
  type ApplicationProfileResponse,
} from "../services/applicationProfilesApi";

/**
 * Page that lists the user's ApplicationProfile rows. Presentation matches
 * the design package's `page-profiles.jsx` ProfileList: a `.page-head` heading
 * row over a `<Paper>` card whose body is a stack of `.profile-row` items.
 *
 * Create and edit no longer happen in a Dialog — instead the New / Edit
 * actions navigate to `/profiles/new` and `/profiles/:id/edit`. The data
 * flow (`listApplicationProfiles`, `deleteApplicationProfile`) is preserved
 * verbatim from the previous Dialog-based page.
 *
 * Default-profile UX: the backend has no `isDefault` field today, so the
 * "Set default" button is rendered for every row but disabled with a
 * tooltip explaining the feature is not yet wired up. We deliberately do
 * NOT auto-treat the first row as default — that would be a lie to the
 * user given there is no real default flag in the data.
 */
function ApplicationProfilesPage() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<ApplicationProfileResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  /**
   * Fetches the full list of application profiles. Wraps the API call so
   * the mount effect and post-delete refresh share the same error handling.
   * @returns {Promise<void>}
   */
  const fetchProfiles = useCallback(async (): Promise<void> => {
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

  /**
   * Navigates to the standalone "new profile" page.
   */
  const handleCreate = (): void => {
    navigate("/profiles/new");
  };

  /**
   * Navigates to the standalone "edit profile" page for the given id.
   * @param {number} id - The profile id to edit
   */
  const handleEdit = (id: number): void => {
    navigate(`/profiles/${String(id)}/edit`);
  };

  /**
   * Prompts for confirmation, then deletes a profile and refreshes the list.
   * @param {ApplicationProfileResponse} profile - The profile being deleted
   * @returns {Promise<void>}
   */
  const handleDelete = async (profile: ApplicationProfileResponse): Promise<void> => {
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

  const profileCount = profiles.length;
  const hasProfiles = profileCount > 0;
  const profileWord = profileCount === 1 ? "profile" : "profiles";

  return (
    <Box>
      <Box className="page-head">
        <Box>
          <Typography component="h1" className="page-title">Application profiles</Typography>
          <Typography component="p" className="page-sub">
            {profileCount} {profileWord} · the default is used unless you pick another at apply time
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="contained"
            startIcon={<AddIcon fontSize="small" />}
            onClick={handleCreate}
          >
            New profile
          </Button>
        </Box>
      </Box>

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

      {!isLoading && (
        <Paper variant="outlined">
          <Box className="card-head">
            <span className="card-title">All profiles</span>
            <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
              Personal info · resume · cover letter · work authorization
            </span>
          </Box>

          {!hasProfiles && (
            <Box sx={{ p: 5, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              <Box sx={{ fontWeight: 500, color: "var(--text)", mb: 0.75 }}>No profiles yet</Box>
              Create your first application profile to start auto-applying.
            </Box>
          )}

          {hasProfiles && profiles.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isDeleting={deletingId === profile.id}
            />
          ))}
        </Paper>
      )}
    </Box>
  );
}

/**
 * Computes the initials for a profile avatar. Falls back to "?" when no
 * letters can be extracted.
 * @param {ApplicationProfileResponse} profile - The profile to derive initials from
 * @returns {string} A 1–2 character uppercase string
 */
function getInitials(profile: ApplicationProfileResponse): string {
  const firstInitial = profile.firstName.charAt(0);
  const lastInitial = profile.lastName.charAt(0);
  const combined = `${firstInitial}${lastInitial}`.toUpperCase();
  if (combined.length === 0) {
    return "?";
  }
  return combined;
}

interface ProfileRowProps {
  /** The profile this row represents */
  profile: ApplicationProfileResponse;
  /** Called with the profile id when the user clicks Edit */
  onEdit: (id: number) => void;
  /** Called with the profile when the user clicks the delete icon */
  onDelete: (profile: ApplicationProfileResponse) => void;
  /** Whether this row is currently being deleted (disables the delete button) */
  isDeleting: boolean;
}

/**
 * Renders a single `.profile-row` (avatar · meta · stat · actions). Stateless;
 * delegates all data changes to its parent via the onEdit/onDelete callbacks.
 *
 * The "applications" stat column shows an em-dash until the backend exposes a
 * usage count (the design's `p.used` field has no equivalent on the server).
 *
 * @param {ProfileRowProps} props
 * @returns {JSX.Element} The rendered row
 */
function ProfileRow({ profile, onEdit, onDelete, isDeleting }: ProfileRowProps) {
  const fullName = [profile.firstName, profile.middleName, profile.lastName]
    .filter((part) => part !== null && part !== "")
    .join(" ");
  const workAuthLabel = profile.workAuthorization === null
    ? "Work auth not set"
    : WORK_AUTHORIZATION_LABELS[profile.workAuthorization];
  const minSalaryLabel = profile.desiredSalaryMin === null
    ? "Min salary —"
    : `Min $${String(profile.desiredSalaryMin)}`;
  const resumeLabel = profile.resumeUrl === null || profile.resumeUrl === ""
    ? <span style={{ color: "var(--text-faint)" }}>No resume</span>
    : <span>Resume</span>;
  const coverLetterLabel = profile.coverLetterUrl === null || profile.coverLetterUrl === ""
    ? <span style={{ color: "var(--text-faint)" }}>No cover letter</span>
    : <span>Cover letter</span>;

  return (
    <Box className="profile-row" data-testid={`profile-row-${String(profile.id)}`}>
      <Box className="profile-row-avatar">{getInitials(profile)}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          <span className="profile-row-label">{profile.name}</span>
        </Box>
        <Box className="profile-row-meta">
          {fullName} · {profile.email} · {profile.phone}
        </Box>
        <Box className="profile-row-meta" sx={{ mt: "2px" }}>
          {resumeLabel}
          <span style={{ margin: "0 8px", color: "var(--text-faint)" }}>·</span>
          {coverLetterLabel}
          <span style={{ margin: "0 8px", color: "var(--text-faint)" }}>·</span>
          <span>{workAuthLabel}</span>
          <span style={{ margin: "0 8px", color: "var(--text-faint)" }}>·</span>
          <span>{minSalaryLabel}</span>
        </Box>
      </Box>
      <Box className="profile-row-stat">
        <strong>—</strong><br />
        <span style={{ fontSize: 11 }}>applications</span>
      </Box>
      <Box className="profile-row-actions">
        <Tooltip title="Default profiles not yet wired up" arrow>
          <span>
            <Button size="small" variant="outlined" disabled>Set default</Button>
          </span>
        </Tooltip>
        <Button
          size="small"
          variant="outlined"
          startIcon={<EditIcon fontSize="small" />}
          onClick={() => onEdit(profile.id)}
          aria-label={`edit ${profile.name}`}
        >
          Edit
        </Button>
        <IconButton
          aria-label={`delete ${profile.name}`}
          onClick={() => onDelete(profile)}
          disabled={isDeleting}
          size="small"
        >
          {isDeleting ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
        </IconButton>
      </Box>
    </Box>
  );
}

export default ApplicationProfilesPage;
