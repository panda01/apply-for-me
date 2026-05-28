import Chip, { type ChipProps } from "@mui/material/Chip";
import { type ReactElement } from "react";

/**
 * Client-side mirror of the backend `WorkArrangement` enum (schema.prisma /
 * inboxTypes.ts `WorkArrangementValue`). Kept byte-identical so the wire values
 * round-trip. `null` (not a member) means "unknown" on the nullable columns.
 * Both inboxApi (DiscoveredJobResponse.workArrangement) and jobListingsApi
 * (JobListingResponse.work_arrangement) import this type so there is one
 * canonical definition on the frontend.
 */
export type WorkArrangement = "remote" | "on_site" | "hybrid";

/**
 * Human-readable label for each arrangement, shown inside the chip.
 */
const WORK_ARRANGEMENT_LABELS: Record<WorkArrangement, string> = {
  remote: "Remote",
  on_site: "On-Site",
  hybrid: "Hybrid",
};

/**
 * MUI Chip color variant per arrangement. Remote reads as a "good" green,
 * hybrid as informational blue, on-site as neutral grey.
 */
const WORK_ARRANGEMENT_CHIP_COLORS: Record<WorkArrangement, ChipProps["color"]> = {
  remote: "success",
  on_site: "default",
  hybrid: "info",
};

/**
 * Renders a small MUI Chip describing a job's work arrangement
 * (Remote / On-Site / Hybrid). Returns null when the arrangement is unknown so
 * callers can drop it inline without guarding the null case themselves.
 *
 * @param {object} props - The props object.
 * @param {WorkArrangement | null} props.value - The structured arrangement, or null when unknown.
 * @returns {ReactElement | null} The chip element, or null when `value` is null.
 */
function WorkArrangementChip({ value }: { value: WorkArrangement | null }): ReactElement | null {
  const isUnknownArrangement = value === null;
  if (isUnknownArrangement) {
    return null;
  }
  return (
    <Chip
      size="small"
      label={WORK_ARRANGEMENT_LABELS[value]}
      color={WORK_ARRANGEMENT_CHIP_COLORS[value]}
      variant="outlined"
    />
  );
}

export default WorkArrangementChip;
