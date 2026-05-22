import { useState, useEffect, type FormEvent } from "react";
import {
  Box, TextField, Button, MenuItem, CircularProgress, Alert, InputAdornment,
  Stack, Divider, Typography,
} from "@mui/material";
import {
  type ApplicationProfileInput,
  type ApplicationProfileResponse,
  type WorkAuthorization,
  WORK_AUTHORIZATION_LABELS,
} from "../services/applicationProfilesApi";

/**
 * Initial form values. Either an existing profile (edit mode) or null
 * (create mode — fields start blank).
 */
type InitialValues = ApplicationProfileResponse | null;

interface ApplicationProfileFormProps {
  /** Existing profile when editing; null when creating */
  initialValues: InitialValues;
  /** Called with the validated input when the user submits */
  onSubmit: (input: ApplicationProfileInput) => Promise<void>;
  /** Called when the user clicks Cancel */
  onCancel: () => void;
  /** Whether the parent is currently saving (disables inputs) */
  isSaving: boolean;
  /** Error message from the parent (e.g. server 409); cleared by re-submitting */
  submitError: string;
}

/**
 * Form for creating or editing an ApplicationProfile. Handles the required +
 * optional field split, basic client-side URL/email/integer validation, and
 * surfaces the parent's saveError so unique-name conflicts and server-side
 * validation messages are visible.
 *
 * Optional fields stored as empty strings in local form state are normalized
 * to null before calling onSubmit so the server gets a clean "field omitted"
 * value rather than empty-string noise.
 *
 * @param {ApplicationProfileFormProps} props
 * @param {InitialValues} props.initialValues - Existing profile (edit) or null (create)
 * @param {(input: ApplicationProfileInput) => Promise<void>} props.onSubmit - Submit callback
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
  const [resumeUrl, setResumeUrl] = useState("");
  const [coverLetterUrl, setCoverLetterUrl] = useState("");
  const [workAuthorization, setWorkAuthorization] = useState<WorkAuthorization | "">("");
  const [desiredSalaryMin, setDesiredSalaryMin] = useState("");
  const [clientErrors, setClientErrors] = useState<string[]>([]);

  // When initialValues change (e.g. user clicks Edit on a different row),
  // hydrate the form fields. Empty strings represent unset optional fields.
  useEffect(() => {
    const isEditing = initialValues !== null;
    if (!isEditing) {
      setName(""); setFirstName(""); setMiddleName(""); setLastName("");
      setEmail(""); setPhone(""); setGithub(""); setLinkedin("");
      setWebsite(""); setResumeUrl(""); setCoverLetterUrl("");
      setWorkAuthorization(""); setDesiredSalaryMin("");
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
    setResumeUrl(initialValues.resumeUrl ?? "");
    setCoverLetterUrl(initialValues.coverLetterUrl ?? "");
    setWorkAuthorization(initialValues.workAuthorization ?? "");
    setDesiredSalaryMin(
      initialValues.desiredSalaryMin === null ? "" : String(initialValues.desiredSalaryMin)
    );
  }, [initialValues]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const validationErrors = validateFormState({
      name, firstName, lastName, email, phone,
      github, linkedin, website, resumeUrl, coverLetterUrl,
      desiredSalaryMin,
    });
    if (validationErrors.length > 0) {
      setClientErrors(validationErrors);
      return;
    }
    setClientErrors([]);

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
      resumeUrl: emptyToNull(resumeUrl),
      coverLetterUrl: emptyToNull(coverLetterUrl),
      workAuthorization: workAuthorization === "" ? null : workAuthorization,
      desiredSalaryMin: desiredSalaryMin.trim() === "" ? null : parseInt(desiredSalaryMin, 10),
    };
    await onSubmit(input);
  };

  const allErrors = [...clientErrors, ...(submitError ? [submitError] : [])];

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="subtitle2" color="text.secondary">Profile label</Typography>
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        helperText='User-facing label for this profile, e.g. "Default", "Tech roles".'
        disabled={isSaving}
      />

      <Divider sx={{ mt: 1 }} />
      <Typography variant="subtitle2" color="text.secondary">Identity</Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required fullWidth disabled={isSaving} />
        <TextField label="Middle name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} fullWidth disabled={isSaving} />
        <TextField label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required fullWidth disabled={isSaving} />
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required fullWidth disabled={isSaving} />
        <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} required fullWidth disabled={isSaving} />
      </Stack>

      <Divider sx={{ mt: 1 }} />
      <Typography variant="subtitle2" color="text.secondary">Links (optional)</Typography>
      <TextField label="LinkedIn" type="url" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} fullWidth disabled={isSaving} />
      <TextField label="GitHub" type="url" value={github} onChange={(e) => setGithub(e.target.value)} fullWidth disabled={isSaving} />
      <TextField label="Website / Portfolio" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} fullWidth disabled={isSaving} />
      <TextField label="Resume URL" type="url" value={resumeUrl} onChange={(e) => setResumeUrl(e.target.value)} fullWidth disabled={isSaving} />
      <TextField label="Cover letter URL" type="url" value={coverLetterUrl} onChange={(e) => setCoverLetterUrl(e.target.value)} fullWidth disabled={isSaving} helperText="Link to a hosted cover letter (Google Doc / PDF). The agent will open it for cover-letter prompts." />

      <Divider sx={{ mt: 1 }} />
      <Typography variant="subtitle2" color="text.secondary">Job-application details (optional, US-only)</Typography>
      <TextField
        select
        label="Work authorization"
        value={workAuthorization}
        onChange={(e) => setWorkAuthorization(e.target.value as WorkAuthorization | "")}
        fullWidth
        disabled={isSaving}
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
        disabled={isSaving}
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
        <Button type="submit" variant="contained" disabled={isSaving}>
          {isSaving ? <CircularProgress size={20} /> : initialValues === null ? "Create profile" : "Save changes"}
        </Button>
        <Button type="button" variant="outlined" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </Stack>
    </Box>
  );
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
  resumeUrl: string;
  coverLetterUrl: string;
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
    { key: "resumeUrl", label: "Resume URL" },
    { key: "coverLetterUrl", label: "Cover letter URL" },
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
