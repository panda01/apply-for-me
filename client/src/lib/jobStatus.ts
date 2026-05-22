/**
 * Single source of truth for mapping backend job status strings to display labels
 * and the design system's status pill variant. New backend statuses must be added
 * here, with a chosen `variant` from the design's 6 colorways.
 *
 * Variants (from globalStyles.tsx .pill[data-status='...']):
 *   - "saved"     neutral gray
 *   - "applied"   blue
 *   - "interview" purple
 *   - "offer"     green
 *   - "rejected"  red
 *   - "review"    amber
 */
export type StatusVariant = "saved" | "applied" | "interview" | "offer" | "rejected" | "review";

export interface StatusMeta {
  label: string;
  variant: StatusVariant;
}

/**
 * Maps every backend status string the server may ship to its user-facing label
 * and the design pill colorway it should render with. Keep this in sync with
 * the backend Prisma enums + server status strings — adding a new status on
 * the server without an entry here will fall through to {@link getStatusMeta}'s
 * neutral fallback.
 */
export const STATUS_META: Record<string, StatusMeta> = {
  init: { label: "Ready", variant: "saved" },
  applying: { label: "Applying", variant: "review" },
  applied: { label: "Applied", variant: "applied" },
  error_applying: { label: "Error", variant: "rejected" },
  closed: { label: "Closed", variant: "saved" },
  missing_form_url: { label: "No form URL", variant: "review" },
};

/**
 * Look up the design pill meta for a given backend status string.
 * Falls back to a neutral "saved" pill so unknown statuses still render.
 * @param {string} status - The raw backend status value (e.g. "init", "applying").
 * @returns {StatusMeta} The display label + pill colorway variant.
 */
export function getStatusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status, variant: "saved" };
}

/**
 * Ordered list of all known backend statuses (used by the Jobs page filter tabs).
 * The ordering here drives the tab order on JobsListPage.
 */
export const KNOWN_STATUSES: readonly string[] = [
  "init", "applying", "applied", "error_applying", "closed", "missing_form_url",
] as const;
