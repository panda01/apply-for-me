import { Box, CircularProgress, type SxProps, type Theme } from "@mui/material";
import {
  CheckCircle as CheckCircleIcon,
  ErrorOutline as ErrorOutlineIcon,
  MailOutline as MailOutlineIcon,
  Search as SearchIcon,
  SaveAlt as SaveAltIcon,
} from "@mui/icons-material";
import type { ReactElement } from "react";
import type { SyncStep, SyncSessionStatus } from "../services/inboxApi";

/**
 * Display configuration for one of the three sync steps. The `id` field
 * matches the server's GmailSyncStep enum value; `label` is the human-
 * readable chip text the user sees on the inbox page.
 */
interface StepDescriptor {
  id: SyncStep;
  label: string;
}

/**
 * Ordered step descriptors used to render the three-chip indicator. Order
 * matters — the rendered chips appear in this order left-to-right and the
 * "done" state is derived by index comparison against the current step.
 */
const STEP_DESCRIPTORS: readonly StepDescriptor[] = [
  { id: "fetching_emails", label: "Fetching emails" },
  { id: "finding_jobs", label: "Finding jobs in emails" },
  { id: "saving_jobs", label: "Saving jobs" },
];

/**
 * Per-step display state used to pick the right icon, color, and label
 * styling on each chip.
 */
type StepDisplayState = "pending" | "active" | "done" | "failed";

/**
 * Props for {@link SyncStepIndicator}. `currentStep` is null until the
 * worker emits its first transition (in which case `status === "running"`
 * still — show the first step as active). When `status` is `succeeded` or
 * `failed`, all three chips show their terminal state.
 */
export interface SyncStepIndicatorProps {
  /** The session's current step, or null when not yet transitioned. */
  currentStep: SyncStep | null;
  /** The session's lifecycle status. */
  status: SyncSessionStatus;
  /** Optional sx override for the outer container. */
  sx?: SxProps<Theme>;
}

/**
 * Resolves the display state for one step descriptor given the current
 * session step + status. Logic:
 *   - succeeded → every step is "done"
 *   - failed    → the step at currentStep (or first step if null) is "failed",
 *                 prior steps are "done", later steps stay "pending"
 *   - running   → currentStep is "active", prior steps are "done",
 *                 later steps stay "pending". When currentStep is null,
 *                 the first step is "active" (worker spinning up).
 *
 * @param {StepDescriptor} descriptor - The step to classify
 * @param {SyncStep | null} currentStep - The session's currentStep value
 * @param {SyncSessionStatus} status - The session's overall status
 * @returns {StepDisplayState} The display state for this chip
 */
function resolveStepDisplayState(
  descriptor: StepDescriptor,
  currentStep: SyncStep | null,
  status: SyncSessionStatus
): StepDisplayState {
  const descriptorIndex = STEP_DESCRIPTORS.findIndex((entry) => entry.id === descriptor.id);
  // Treat null currentStep as "first step" so a session that's just been
  // created but hasn't transitioned yet still shows progress visually.
  const effectiveCurrentStepId: SyncStep = currentStep ?? STEP_DESCRIPTORS[0]!.id;
  const currentStepIndex = STEP_DESCRIPTORS.findIndex(
    (entry) => entry.id === effectiveCurrentStepId
  );

  if (status === "succeeded") {
    return "done";
  }
  if (status === "failed") {
    if (descriptorIndex === currentStepIndex) {
      return "failed";
    }
    return descriptorIndex < currentStepIndex ? "done" : "pending";
  }
  if (descriptorIndex < currentStepIndex) {
    return "done";
  }
  if (descriptorIndex === currentStepIndex) {
    return "active";
  }
  return "pending";
}

/**
 * Per-state visual config: the icon to render, an aria-friendly label, and
 * a Material color hint. Kept in one map so adding a new state (e.g.
 * "skipped") is a one-line change.
 */
const STATE_VISUALS: Record<
  StepDisplayState,
  { color: string; opacity: number; ariaSuffix: string }
> = {
  pending: { color: "var(--text-muted)", opacity: 0.55, ariaSuffix: "pending" },
  active: { color: "var(--accent)", opacity: 1, ariaSuffix: "in progress" },
  done: { color: "var(--success, #2e7d32)", opacity: 1, ariaSuffix: "done" },
  failed: { color: "var(--error, #c62828)", opacity: 1, ariaSuffix: "failed" },
};

/**
 * Renders the step-icon for one chip. Active steps show a spinner; done
 * steps show a checkmark; failed steps show an error icon; pending steps
 * show the step's domain icon dimmed.
 *
 * @param {object} args - Render inputs
 * @param {SyncStep} args.stepId - The step id (drives the domain icon)
 * @param {StepDisplayState} args.displayState - The step's resolved display state
 * @returns {ReactElement} The icon element
 */
function renderStepIcon(args: {
  stepId: SyncStep;
  displayState: StepDisplayState;
}): ReactElement {
  const { stepId, displayState } = args;
  if (displayState === "active") {
    return <CircularProgress size={14} thickness={5} />;
  }
  if (displayState === "done") {
    return <CheckCircleIcon sx={{ fontSize: 16 }} />;
  }
  if (displayState === "failed") {
    return <ErrorOutlineIcon sx={{ fontSize: 16 }} />;
  }
  // Pending — show the step's domain icon dimmed.
  if (stepId === "fetching_emails") {
    return <MailOutlineIcon sx={{ fontSize: 16 }} />;
  }
  if (stepId === "finding_jobs") {
    return <SearchIcon sx={{ fontSize: 16 }} />;
  }
  return <SaveAltIcon sx={{ fontSize: 16 }} />;
}

/**
 * Three-chip step indicator rendered next to the "Syncing…" button on the
 * inbox page while a Gmail sync session is in flight. Shows the user where
 * the worker currently is so a slow scan doesn't look indistinguishable
 * from a stuck scan.
 *
 * @param {SyncStepIndicatorProps} props
 * @returns {ReactElement} The rendered indicator
 */
export function SyncStepIndicator(props: SyncStepIndicatorProps): ReactElement {
  const { currentStep, status, sx } = props;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        ...(sx ?? {}),
      }}
      role="status"
      aria-live="polite"
      data-testid="sync-step-indicator"
    >
      {STEP_DESCRIPTORS.map((descriptor, descriptorIndex) => {
        const displayState = resolveStepDisplayState(descriptor, currentStep, status);
        const visuals = STATE_VISUALS[displayState];
        const isLastDescriptor = descriptorIndex === STEP_DESCRIPTORS.length - 1;
        return (
          <Box
            key={descriptor.id}
            sx={{ display: "flex", alignItems: "center", gap: 1.25 }}
          >
            <Box
              data-testid={`sync-step-${descriptor.id}`}
              data-state={displayState}
              aria-label={`${descriptor.label} — ${visuals.ariaSuffix}`}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                color: visuals.color,
                opacity: visuals.opacity,
                fontSize: 12,
                fontWeight: displayState === "active" ? 600 : 500,
                whiteSpace: "nowrap",
              }}
            >
              {renderStepIcon({ stepId: descriptor.id, displayState })}
              <span>{descriptor.label}</span>
            </Box>
            {!isLastDescriptor && (
              <Box
                aria-hidden
                sx={{
                  width: 16,
                  height: 1,
                  background: "var(--text-muted)",
                  opacity: 0.4,
                }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export default SyncStepIndicator;
