import { Typography } from "@mui/material";
import type { ReactNode } from "react";

interface LabeledFieldProps {
  /** Label text shown above the value */
  label: string;
  /** The value content (string or any renderable node) */
  children: ReactNode;
  /** Whether to allow long values to break across word boundaries */
  breakLongValues?: boolean;
  /** Optional data-testid for the value Typography (used by tests) */
  valueTestId?: string;
  /** Whether the label uses gutterBottom styling (matches existing call sites) */
  gutterBottom?: boolean;
}

/**
 * Renders a small subtitle-style label above a value, used on detail pages
 * to display read-only field/value pairs (e.g., "Docker ID", "Host Port").
 * @param {LabeledFieldProps} props
 * @param {string} props.label - The label text
 * @param {ReactNode} props.children - The value content
 * @param {boolean | undefined} props.breakLongValues - If true, wrap on any character (for long IDs)
 * @param {string | undefined} props.valueTestId - Optional data-testid for the value
 * @param {boolean | undefined} props.gutterBottom - If true, label uses MUI gutterBottom
 */
function LabeledField({ label, children, breakLongValues, valueTestId, gutterBottom }: LabeledFieldProps) {
  return (
    <>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom={gutterBottom}>
        {label}
      </Typography>
      <Typography sx={{ mb: 2, ...(breakLongValues ? { wordBreak: "break-all" } : {}) }} data-testid={valueTestId}>
        {children}
      </Typography>
    </>
  );
}

export default LabeledField;
