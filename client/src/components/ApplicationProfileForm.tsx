import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  Box, TextField, Button, MenuItem, CircularProgress, Alert, InputAdornment,
  Stack, Divider, Typography, IconButton,
} from "@mui/material";
import {
  Download as DownloadIcon,
  Delete as DeleteIcon,
  UploadFile as UploadFileIcon,
  AutoFixHigh as AutoFixHighIcon,
} from "@mui/icons-material";
import {
  type ApplicationProfileInput,
  type ApplicationProfileResponse,
  type WorkAuthorization,
  type ProfileFileKind,
  WORK_AUTHORIZATION_LABELS,
  extractFromResume,
  uploadProfileFile,
  deleteProfileFile,
  getProfileFileUrl,
} from "../services/applicationProfilesApi";

/**
 * Initial form values. Either an existing profile (edit mode) or null
 * (create mode — fields start blank).
 */
type InitialValues = ApplicationProfileResponse | null;

interface ApplicationProfileFormProps {
  /** Existing profile when editing; null when creating */
  initialValues: InitialValues;
  /**
   * Called with the validated input when the user submits. MUST resolve to the
   * saved profile (created or updated) so the form can upload any staged
   * resume / cover-letter files against the resulting id.
   */
  onSubmit: (input: ApplicationProfileInput) => Promise<ApplicationProfileResponse>;
  /** Called when the user clicks Cancel */
  onCancel: () => void;
  /** Whether the parent is currently saving (disables inputs) */
  isSaving: boolean;
  /** Error message from the parent (e.g. server 409); cleared by re-submitting */
  submitError: string;
}

/**
 * Snapshot of the resume / cover-letter files currently attached to the
 * profile on the server. Mirrors the file-related fields on
 * ApplicationProfileResponse so the form can show "current file" UI and update
 * it locally after an upload / delete without forcing a parent refetch.
 */
interface ServerFileState {
  /** Storage key of the resume PDF, or null when none is attached */
  resumeStorageKey: string | null;
  /** Original filename of the resume PDF, or null when none is attached */
  resumeFileName: string | null;
  /** Storage key of the cover-letter PDF, or null when none is attached */
  coverLetterStorageKey: string | null;
  /** Original filename of the cover-letter PDF, or null when none is attached */
  coverLetterFileName: string | null;
}

/**
 * Form for creating or editing an ApplicationProfile. Handles the required +
 * optional field split, basic client-side URL/email/integer validation, and
 * surfaces the parent's saveError so unique-name conflicts and server-side
 * validation messages are visible.
 *
 * Resume and cover-letter PDFs are uploaded (not URLs). In edit mode the form
 * uploads/deletes against the existing profile id immediately; in create mode
 * the chosen files are staged in local state and uploaded after onSubmit
 * resolves with the new profile's id. The resume can also be parsed via
 * extractFromResume to pre-fill only the empty identity/link fields.
 *
 * Optional fields stored as empty strings in local form state are normalized
 * to null before calling onSubmit so the server gets a clean "field omitted"
 * value rather than empty-string noise.
 *
 * @param {ApplicationProfileFormProps} props
 * @param {InitialValues} props.initialValues - Existing profile (edit) or null (create)
 * @param {(input: ApplicationProfileInput) => Promise<ApplicationProfileResponse>} props.onSubmit - Submit callback that returns the saved profile
 * @param {() => void} props.onCancel - Cancel callback
 * @param {boolean} props.isSaving - Whether the parent is currently saving
 * @param {string} props.submitError - Error message from the most recent submit
 */
function ApplicationProfileForm({
  initialValues,
  onSubmit,
  onCancel,
  isSaving,
  submitError,
}: ApplicationProfileFormProps) {
  const [name, setName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [github, setGithub] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");
  const [workAuthorization, setWorkAuthorization] = useState<WorkAuthorization | "">("");
  const [desiredSalaryMin, setDesiredSalaryMin] = useState("");
  const [clientErrors, setClientErrors] = useState<string[]>([]);

  // Files the server already has attached to this profile (edit mode). Tracked
  // locally so uploads/deletes can update the displayed filename immediately.
  const [serverFiles, setServerFiles] = useState<ServerFileState>({
    resumeStorageKey: null,
    resumeFileName: null,
    coverLetterStorageKey: null,
    coverLetterFileName: null,
  });

  // Files the user has chosen but not yet uploaded. In create mode these are
  // uploaded after the profile is saved; in edit mode they are uploaded
  // immediately on selection so staging here is transient.
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [coverLetterFile, setCoverLetterFile] = useState<File | null>(null);

  // Upload / delete in flight (separate from the parent's isSaving so file
  // actions can disable controls without claiming the whole form is saving).
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Resume parsing state for the "Import from resume" action.
  const [isImporting, setIsImporting] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [importError, setImportError] = useState("");

  const profileId = initialValues?.id ?? null;

  // When initialValues change (e.g. user clicks Edit on a different row),
  // hydrate the form fields. Empty strings represent unset optional fields.
  useEffect(() => {
    const isEditing = initialValues !== null;
    if (!isEditing) {
      setName(""); setFirstName(""); setMiddleName(""); setLastName("");
      setEmail(""); setPhone(""); setGithub(""); setLinkedin("");
      setWebsite(""); setWorkAuthorization(""); setDesiredSalaryMin("");
      setServerFiles({
        resumeStorageKey: null,
        resumeFileName: null,
        coverLetterStorageKey: null,
        coverLetterFileName: null,
      });
      setResumeFile(null);
      setCoverLetterFile(null);
      setImportNotice(""); setImportError(""); setUploadError("");
      return;
    }
    setName(initialValues.name);
    setFirstName(initialValues.firstName);
    setMiddleName(initialValues.middleName ?? "");
    setLastName(initialValues.lastName);
    setEmail(initialValues.email);
    setPhone(initialValues.phone);
    setGithub(initialValues.github ?? "");
    setLinkedin(initialValues.linkedin ?? "");
    setWebsite(initialValues.website ?? "");
    setWorkAuthorization(initialValues.workAuthorization ?? "");
    setDesiredSalaryMin(
      initialValues.desiredSalaryMin === null ? "" : String(initialValues.desiredSalaryMin)
    );
    setServerFiles({
      resumeStorageKey: initialValues.resumeStorageKey,
      resumeFileName: initialValues.resumeFileName,
      coverLetterStorageKey: initialValues.coverLetterStorageKey,
      coverLetterFileName: initialValues.coverLetterFileName,
    });
    setResumeFile(null);
    setCoverLetterFile(null);
    setImportNotice(""); setImportError(""); setUploadError("");
  }, [initialValues]);

  /**
   * Updates the local server-file snapshot from a fresh profile response.
   * Called after an upload or delete so the displayed filename reflects the
   * server without a parent refetch.
   * @param {ApplicationProfileResponse} profile - The latest profile record
   * @returns {void}
   */
  const syncServerFilesFromProfile = (profile: ApplicationProfileResponse): void => {
    setServerFiles({
      resumeStorageKey: profile.resumeStorageKey,
      resumeFileName: profile.resumeFileName,
      coverLetterStorageKey: profile.coverLetterStorageKey,
      coverLetterFileName: profile.coverLetterFileName,
    });
  };

  /**
   * Stages a chosen PDF for the given kind. In edit mode (an existing profile
   * id is present) the file is uploaded immediately and the server snapshot is
   * refreshed; in create mode it is held in local state until the profile is
   * saved by handleSubmit.
   * @param {ProfileFileKind} kind - Which document slot the file belongs to
   * @param {File | null} file - The chosen PDF, or null if the picker was cleared
   * @returns {Promise<void>}
   */
  const handleFileChosen = async (kind: ProfileFileKind, file: File | null): Promise<void> => {
    if (file === null) {
      return;
    }
    setUploadError("");
    if (kind === "resume") {
      setImportNotice(""); setImportError("");
    }
    // Create mode: no id yet, so just stage the file for post-save upload.
    if (profileId === null) {
      if (kind === "resume") {
        setResumeFile(file);
      } else {
        setCoverLetterFile(file);
      }
      return;
    }
    // Edit mode: upload immediately against the existing profile id.
    setIsUploading(true);
    try {
      const updated = await uploadProfileFile(profileId, kind, file);
      syncServerFilesFromProfile(updated);
      if (kind === "resume") {
        setResumeFile(file);
      } else {
        setCoverLetterFile(file);
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : `Failed to upload ${kind === "resume" ? "resume" : "cover letter"}`;
      setUploadError(errorText);
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Removes a document. If the server already holds a file for this kind it is
   * deleted server-side and the snapshot refreshed; otherwise only the staged
   * (not-yet-uploaded) file is cleared.
   * @param {ProfileFileKind} kind - Which document slot to clear
   * @returns {Promise<void>}
   */
  const handleFileRemove = async (kind: ProfileFileKind): Promise<void> => {
    setUploadError("");
    const hasServerFile = kind === "resume"
      ? serverFiles.resumeStorageKey !== null
      : serverFiles.coverLetterStorageKey !== null;

    if (profileId !== null && hasServerFile) {
      setIsUploading(true);
      try {
        const updated = await deleteProfileFile(profileId, kind);
        syncServerFilesFromProfile(updated);
        if (kind === "resume") {
          setResumeFile(null);
        } else {
          setCoverLetterFile(null);
        }
      } catch (err) {
        const errorText = err instanceof Error ? err.message : `Failed to remove ${kind === "resume" ? "resume" : "cover letter"}`;
        setUploadError(errorText);
      } finally {
        setIsUploading(false);
      }
      return;
    }
    // Only a staged file exists — clear it locally.
    if (kind === "resume") {
      setResumeFile(null);
    } else {
      setCoverLetterFile(null);
    }
  };

  /**
   * Downloads the stored file for the given kind by fetching a signed URL and
   * opening it in a new tab. Edit mode only (requires a server file).
   * @param {ProfileFileKind} kind - Which document to download
   * @returns {Promise<void>}
   */
  const handleFileDownload = async (kind: ProfileFileKind): Promise<void> => {
    if (profileId === null) {
      return;
    }
    setUploadError("");
    try {
      const url = await getProfileFileUrl(profileId, kind);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to open document";
      setUploadError(errorText);
    }
  };

  /**
   * Parses the staged resume PDF and fills ONLY the currently-empty identity
   * and link fields. Never overwrites values the user has already entered, and
   * never auto-saves — the user reviews and submits manually.
   * @returns {Promise<void>}
   */
  const handleImportFromResume = async (): Promise<void> => {
    if (resumeFile === null) {
      return;
    }
    setIsImporting(true);
    setImportNotice("");
    setImportError("");
    try {
      const fields = await extractFromResume(resumeFile);
      // Only fill fields the user has left blank.
      fillIfEmpty(firstName, fields.firstName, setFirstName);
      fillIfEmpty(middleName, fields.middleName, setMiddleName);
      fillIfEmpty(lastName, fields.lastName, setLastName);
      fillIfEmpty(email, fields.email, setEmail);
      fillIfEmpty(phone, fields.phone, setPhone);
      fillIfEmpty(github, fields.github, setGithub);
      fillIfEmpty(linkedin, fields.linkedin, setLinkedin);
      fillIfEmpty(website, fields.website, setWebsite);
      setImportNotice("Imported from resume — review the fields below");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to read the resume";
      setImportError(errorText);
    } finally {
      setIsImporting(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const validationErrors = validateFormState({
      name, firstName, lastName, email, phone,
      github, linkedin, website,
      desiredSalaryMin,
    });
    if (validationErrors.length > 0) {
      setClientErrors(validationErrors);
      return;
    }
    setClientErrors([]);
    setUploadError("");

    const input: ApplicationProfileInput = {
      name: name.trim(),
      firstName: firstName.trim(),
      middleName: emptyToNull(middleName),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      github: emptyToNull(github),
      linkedin: emptyToNull(linkedin),
      website: emptyToNull(website),
      workAuthorization: workAuthorization === "" ? null : workAuthorization,
      desiredSalaryMin: desiredSalaryMin.trim() === "" ? null : parseInt(desiredSalaryMin, 10),
    };

    // Save the profile first so we have an id to attach staged files to. The
    // parent surfaces save failures via the submitError prop and rethrows; we
    // catch here so a rejected save never becomes an unhandled rejection, and so
    // we skip the file-upload step when the save itself failed.
    let saved: ApplicationProfileResponse;
    try {
      saved = await onSubmit(input);
    } catch {
      return;
    }

    // In edit mode files were already uploaded on selection, so only create
    // mode (or any still-staged files) needs uploading here. Determine which
    // staged files still need to be persisted against the saved id.
    const stagedUploads: { kind: ProfileFileKind; file: File }[] = [];
    if (resumeFile !== null && saved.resumeStorageKey === null) {
      stagedUploads.push({ kind: "resume", file: resumeFile });
    }
    if (coverLetterFile !== null && saved.coverLetterStorageKey === null) {
      stagedUploads.push({ kind: "coverLetter", file: coverLetterFile });
    }

    if (stagedUploads.length === 0) {
      return;
    }

    setIsUploading(true);
    try {
      let latest = saved;
      for (const { kind, file } of stagedUploads) {
        latest = await uploadProfileFile(saved.id, kind, file);
      }
      syncServerFilesFromProfile(latest);
      setResumeFile(null);
      setCoverLetterFile(null);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Profile saved, but uploading a document failed";
      setUploadError(errorText);
    } finally {
      setIsUploading(false);
    }
  };

  const allErrors = [
    ...clientErrors,
    ...(submitError ? [submitError] : []),
    ...(uploadError ? [uploadError] : []),
  ];

  const controlsDisabled = isSaving || isUploading;

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="subtitle2" color="text.secondary">Resume</Typography>
      <DocumentUploadControl
        kind="resume"
        label="resume"
        serverFileName={serverFiles.resumeFileName}
        hasServerFile={serverFiles.resumeStorageKey !== null}
        stagedFile={resumeFile}
        disabled={controlsDisabled}
        onFileChosen={(file) => handleFileChosen("resume", file)}
        onRemove={() => handleFileRemove("resume")}
        onDownload={() => handleFileDownload("resume")}
      />
      <Box>
        <Button
          type="button"
          variant="outlined"
          size="small"
          startIcon={isImporting ? <CircularProgress size={16} /> : <AutoFixHighIcon fontSize="small" />}
          onClick={handleImportFromResume}
          disabled={controlsDisabled || isImporting || resumeFile === null}
        >
          Import from resume
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          Reads a staged resume PDF and fills only the empty fields below. Nothing you've typed is overwritten, and nothing is saved automatically.
        </Typography>
      </Box>
      {importNotice !== "" && (
        <Alert severity="info" onClose={() => setImportNotice("")}>{importNotice}</Alert>
      )}
      {importError !== "" && (
        <Alert severity="error" onClose={() => setImportError("")}>{importError}</Alert>
      )}

      <Divider sx={{ mt: 1 }} />
      <Typography variant="subtitle2" color="text.secondary">Cover letter</Typography>
      <DocumentUploadControl
        kind="coverLetter"
        label="cover letter"
        serverFileName={serverFiles.coverLetterFileName}
        hasServerFile={serverFiles.coverLetterStorageKey !== null}
        stagedFile={coverLetterFile}
        disabled={controlsDisabled}
        onFileChosen={(file) => handleFileChosen("coverLetter", file)}
        onRemove={() => handleFileRemove("coverLetter")}
        onDownload={() => handleFileDownload("coverLetter")}
      />

      <Divider sx={{ mt: 1 }} />
      <Typography variant="subtitle2" color="text.secondary">Profile label</Typography>
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        helperText='User-facing label for this profile, e.g. "Default", "Tech roles".'
        disabled={controlsDisabled}
      />

      <Divider sx={{ mt: 1 }} />
      <Typography variant="subtitle2" color="text.secondary">Identity</Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required fullWidth disabled={controlsDisabled} />
        <TextField label="Middle name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} fullWidth disabled={controlsDisabled} />
        <TextField label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required fullWidth disabled={controlsDisabled} />
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth disabled={controlsDisabled} />
        <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} required fullWidth disabled={controlsDisabled} />
      </Stack>

      <Divider sx={{ mt: 1 }} />
      <Typography variant="subtitle2" color="text.secondary">Links (optional)</Typography>
      <TextField label="LinkedIn" type="url" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} fullWidth disabled={controlsDisabled} />
      <TextField label="GitHub" type="url" value={github} onChange={(e) => setGithub(e.target.value)} fullWidth disabled={controlsDisabled} />
      <TextField label="Website / Portfolio" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} fullWidth disabled={controlsDisabled} />

      <Divider sx={{ mt: 1 }} />
      <Typography variant="subtitle2" color="text.secondary">Job-application details (optional, US-only)</Typography>
      <TextField
        select
        label="Work authorization"
        value={workAuthorization}
        onChange={(e) => setWorkAuthorization(e.target.value as WorkAuthorization | "")}
        fullWidth
        disabled={controlsDisabled}
        slotProps={{ select: { displayEmpty: true } }}
      >
        <MenuItem value=""><em>Not specified</em></MenuItem>
        {(Object.keys(WORK_AUTHORIZATION_LABELS) as WorkAuthorization[]).map((value) => (
          <MenuItem key={value} value={value}>{WORK_AUTHORIZATION_LABELS[value]}</MenuItem>
        ))}
      </TextField>
      <TextField
        label="Minimum desired salary"
        type="number"
        value={desiredSalaryMin}
        onChange={(e) => setDesiredSalaryMin(e.target.value)}
        slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> } }}
        fullWidth
        disabled={controlsDisabled}
        helperText="Whole USD. Leave blank if you'd rather not specify."
      />

      {allErrors.length > 0 && (
        <Alert severity="error">
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {allErrors.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
        <Button type="submit" variant="contained" disabled={controlsDisabled}>
          {isSaving || isUploading ? <CircularProgress size={20} /> : initialValues === null ? "Create profile" : "Save changes"}
        </Button>
        <Button type="button" variant="outlined" onClick={onCancel} disabled={controlsDisabled}>
          Cancel
        </Button>
      </Stack>
    </Box>
  );
}

interface DocumentUploadControlProps {
  /** Which document slot this control manages */
  kind: ProfileFileKind;
  /** Lowercase human label used in button text / aria labels (e.g. "resume") */
  label: string;
  /** Filename of the file currently stored on the server, or null */
  serverFileName: string | null;
  /** Whether the server currently holds a file for this kind */
  hasServerFile: boolean;
  /** A file chosen but not yet uploaded (create mode), or null */
  stagedFile: File | null;
  /** Whether the control should be disabled (saving / uploading) */
  disabled: boolean;
  /** Called with the chosen PDF when the user picks a file */
  onFileChosen: (file: File | null) => void;
  /** Called when the user removes the current/staged file */
  onRemove: () => void;
  /** Called when the user downloads the stored file (server file only) */
  onDownload: () => void;
}

/**
 * Reusable upload/replace/remove control for a single PDF document. Renders the
 * current server filename (with Download) when present, the staged filename
 * when a file is chosen but not yet uploaded, and a hidden PDF-only file input
 * triggered by an MUI Button. The "Import from resume" action lives in the
 * parent because it is resume-specific.
 *
 * @param {DocumentUploadControlProps} props
 * @param {ProfileFileKind} props.kind - Which document slot this manages
 * @param {string} props.label - Lowercase human label for button/aria text
 * @param {string | null} props.serverFileName - Stored filename, or null
 * @param {boolean} props.hasServerFile - Whether a server file exists
 * @param {File | null} props.stagedFile - Not-yet-uploaded file, or null
 * @param {boolean} props.disabled - Whether controls are disabled
 * @param {(file: File | null) => void} props.onFileChosen - File-picked callback
 * @param {() => void} props.onRemove - Remove callback
 * @param {() => void} props.onDownload - Download callback
 * @returns {JSX.Element} The document upload control
 */
function DocumentUploadControl({
  kind,
  label,
  serverFileName,
  hasServerFile,
  stagedFile,
  disabled,
  onFileChosen,
  onRemove,
  onDownload,
}: DocumentUploadControlProps) {
  // Reset the native input value after each pick so choosing the same file
  // twice still fires onChange.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = `profile-file-input-${kind}`;

  const hasStagedFile = stagedFile !== null;
  const showCurrent = hasServerFile && serverFileName !== null;

  return (
    <Stack spacing={1}>
      {showCurrent && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="body2" sx={{ wordBreak: "break-all" }}>{serverFileName}</Typography>
          <IconButton
            size="small"
            aria-label={`Download ${label}`}
            onClick={onDownload}
            disabled={disabled}
          >
            <DownloadIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
            disabled={disabled}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      )}

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Button
          component="label"
          htmlFor={inputId}
          variant="outlined"
          size="small"
          startIcon={<UploadFileIcon fontSize="small" />}
          disabled={disabled}
        >
          {showCurrent ? `Replace ${label}` : `Upload ${label}`}
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              onFileChosen(file);
              if (inputRef.current) {
                inputRef.current.value = "";
              }
            }}
          />
        </Button>
        {hasStagedFile && !showCurrent && (
          <>
            <Typography variant="body2" sx={{ wordBreak: "break-all" }}>{stagedFile.name}</Typography>
            <IconButton
              size="small"
              color="error"
              aria-label={`Remove staged ${label}`}
              onClick={onRemove}
              disabled={disabled}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary">PDF only.</Typography>
    </Stack>
  );
}

/**
 * Sets a form field via its setter only when the field is currently empty and
 * the imported value is non-empty. Used by the resume import so it never
 * overwrites values the user has already typed.
 * @param {string} currentValue - The current value of the form field
 * @param {string | null} importedValue - The value parsed from the resume
 * @param {(value: string) => void} setValue - The field's state setter
 * @returns {void}
 */
function fillIfEmpty(
  currentValue: string,
  importedValue: string | null,
  setValue: (value: string) => void
): void {
  const isFieldEmpty = currentValue.trim().length === 0;
  const hasImportedValue = importedValue !== null && importedValue.trim().length > 0;
  if (isFieldEmpty && hasImportedValue) {
    setValue(importedValue.trim());
  }
}

/**
 * Converts an empty/whitespace string to null. Used so optional form inputs
 * don't send empty strings to the server.
 * @param {string} value - The raw form input
 * @returns {string | null} The trimmed string, or null when empty
 */
function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

/**
 * Local form state shape passed to validateFormState. Only the strings the
 * validator looks at — keeps the validator a pure function.
 */
interface FormStateForValidation {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  github: string;
  linkedin: string;
  website: string;
  desiredSalaryMin: string;
}

/**
 * Client-side validation that mirrors the server-side rules in
 * applicationProfiles.ts. Catches obvious mistakes before a round-trip and
 * gives the user a single Alert with every problem at once.
 * @param {FormStateForValidation} state - The current form state
 * @returns {string[]} Array of human-readable error messages (empty when valid)
 */
function validateFormState(state: FormStateForValidation): string[] {
  const errors: string[] = [];

  if (state.name.trim().length === 0) errors.push("Name is required");
  if (state.firstName.trim().length === 0) errors.push("First name is required");
  if (state.lastName.trim().length === 0) errors.push("Last name is required");
  if (state.phone.trim().length === 0) errors.push("Phone is required");

  const trimmedEmail = state.email.trim();
  const hasEmail = trimmedEmail.length > 0;
  const isValidEmail = hasEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  if (!hasEmail) {
    errors.push("Email is required");
  } else if (!isValidEmail) {
    errors.push("Email must look like an email address");
  }

  const optionalUrlFields: { key: keyof FormStateForValidation; label: string }[] = [
    { key: "github", label: "GitHub" },
    { key: "linkedin", label: "LinkedIn" },
    { key: "website", label: "Website" },
  ];
  for (const { key, label } of optionalUrlFields) {
    const raw = state[key].trim();
    const isEmpty = raw.length === 0;
    if (isEmpty) continue;
    const isHttpUrl = /^https?:\/\//i.test(raw) && URL.canParse(raw);
    if (!isHttpUrl) {
      errors.push(`${label} must be a valid http(s) URL`);
    }
  }

  const rawSalary = state.desiredSalaryMin.trim();
  const hasSalary = rawSalary.length > 0;
  if (hasSalary) {
    const parsed = Number(rawSalary);
    const isPositiveInteger = Number.isInteger(parsed) && parsed > 0;
    if (!isPositiveInteger) {
      errors.push("Minimum salary must be a positive whole number");
    }
  }

  return errors;
}

export default ApplicationProfileForm;
