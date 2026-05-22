import { getStatusMeta } from "../lib/jobStatus";

/**
 * Renders the design's status pill (`.pill[data-status="..."]`) for a backend
 * status string. Looks up the display label + design colorway variant via
 * {@link getStatusMeta}; unknown statuses fall back to the neutral "saved" pill.
 * @param {object} props - The props object.
 * @param {string} props.status - Backend job status (init, applying, applied,
 *   error_applying, closed, missing_form_url).
 * @returns {JSX.Element} A `<span class="pill" data-status="...">` element.
 */
function StatusPill({ status }: { status: string }) {
  const meta = getStatusMeta(status);
  return (
    <span className="pill" data-status={meta.variant}>
      <span className="dot" />
      {meta.label}
    </span>
  );
}

export default StatusPill;
