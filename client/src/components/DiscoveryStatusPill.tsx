import { type ReactElement } from "react";
import { ContentCopy as ContentCopyIcon } from "@mui/icons-material";
import type {
  DiscoveredJobReference,
  DiscoveredJobStatus,
} from "../services/inboxApi";

interface DiscoveryStatusPillProps {
  /** The DiscoveredJob row's lifecycle status. */
  status: DiscoveredJobStatus;
  /**
   * Reference to the JobListing this discovery was scan-detected as a
   * duplicate of, when applicable. Powers the "Duplicate · <status>" link
   * inside the pill.
   */
  duplicateOf: DiscoveredJobReference | null;
  /**
   * Reference to the JobListing this discovery was imported as, when
   * applicable. Powers the "Imported · <status>" link inside the pill.
   */
  importedAs: DiscoveredJobReference | null;
  /**
   * Called with the referenced JobListing id when the user clicks one of the
   * pill's inner links (Duplicate · <status> or Imported · <status>).
   */
  onViewExisting: (jobListingId: number) => void;
}

/**
 * Renders exactly one lifecycle pill for a DiscoveredJob row based on its
 * status + relationship FKs. Precedence (matches the InboxPage's filter
 * logic):
 *   dismissed → Dismissed pill (gray)
 *   imported  → Imported pill (green) with optional link into the JobListing
 *   duplicateOf set → Duplicate pill (amber) with optional link to the listing
 *   otherwise → New pill (blue)
 *
 * Stateless and presentation-only; the caller wires up the click handler.
 *
 * @param {DiscoveryStatusPillProps} props
 * @returns {ReactElement} The rendered pill
 */
function DiscoveryStatusPill({
  status,
  duplicateOf,
  importedAs,
  onViewExisting,
}: DiscoveryStatusPillProps): ReactElement {
  if (status === "dismissed") {
    return (
      <span className="pill disc-pill-dismissed">
        <span className="dot" /> Dismissed
      </span>
    );
  }
  if (status === "imported") {
    return (
      <span className="pill disc-pill-imported">
        <ContentCopyIcon className="ico" sx={{ fontSize: 11 }} />
        Imported
        {importedAs !== null && (
          <button
            type="button"
            className="disc-pill-link"
            onClick={(e) => {
              e.stopPropagation();
              onViewExisting(importedAs.jobListingId);
            }}
          >
            · {importedAs.status}
          </button>
        )}
      </span>
    );
  }
  if (duplicateOf !== null) {
    return (
      <span className="pill disc-pill-dup">
        <ContentCopyIcon className="ico" sx={{ fontSize: 11 }} />
        Duplicate
        <button
          type="button"
          className="disc-pill-link"
          onClick={(e) => {
            e.stopPropagation();
            onViewExisting(duplicateOf.jobListingId);
          }}
        >
          · {duplicateOf.status}
        </button>
      </span>
    );
  }
  return (
    <span className="pill disc-pill-new">
      <span className="dot" /> New
    </span>
  );
}

export default DiscoveryStatusPill;
