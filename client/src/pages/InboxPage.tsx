import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Paper,
  Snackbar,
  Typography,
} from "@mui/material";
import {
  Refresh as RefreshIcon,
  Mail as MailIcon,
  OpenInNew as OpenInNewIcon,
  Download as DownloadIcon,
  Inbox as InboxIcon,
  Close as CloseIcon,
  Undo as UndoIcon,
  Link as LinkChainIcon,
} from "@mui/icons-material";
import {
  listInboxDiscoveries,
  scanInbox,
  importInboxDiscoveries,
  dismissInboxDiscovery,
  restoreInboxDiscovery,
  type DiscoveredJobResponse,
  type DiscoveredJobEmail,
} from "../services/inboxApi";
import { listGmailConnections, type GmailConnectionResponse } from "../services/gmailApi";
import DiscoveryStatusPill from "../components/DiscoveryStatusPill";

/**
 * Fixed list of "show jobs from the last N days" presets surfaced in the
 * `.period-bar` segmented control. Ids match the design's PERIODS so any
 * shared state (e.g. URL ?period= in a future PR) stays cross-compatible.
 */
const PERIODS: { id: string; label: string; days: number }[] = [
  { id: "1d", label: "Last day", days: 1 },
  { id: "1w", label: "Last week", days: 7 },
  { id: "2w", label: "Last 2 weeks", days: 14 },
  { id: "1m", label: "Last month", days: 30 },
];

/**
 * Filter tabs above the grouped discovery list. Counts on each tab are
 * derived from the in-period discoveries — see the `counts` memo below.
 */
const FILTERS: { id: "all" | "new" | "duplicates" | "imported" | "dismissed"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "duplicates", label: "Duplicates" },
  { id: "imported", label: "Imported" },
  { id: "dismissed", label: "Dismissed" },
];

type FilterId = (typeof FILTERS)[number]["id"];

interface SnackbarPayload {
  severity: "success" | "error" | "warning" | "info";
  text: string;
}

interface EmailTagProps {
  /** Email metadata to render as a deep-link tag */
  email: DiscoveredJobEmail;
  /** Compact mode hides the subject and keeps just the sender label */
  compact?: boolean;
}

/**
 * Compact `.email-tag` link that deep-links into the user's Gmail at the
 * source message. Stops click propagation so clicking the tag inside a
 * `.disc-row` doesn't also trigger the row's own selection handlers.
 *
 * @param {EmailTagProps} props
 * @returns {ReactElement} The rendered tag
 */
function EmailTag({ email, compact = false }: EmailTagProps): ReactElement {
  const tooltipText = `${email.fromName} — ${email.subject}`;
  const dotStyle = email.labelColor !== null ? { background: email.labelColor } : undefined;
  return (
    <a
      className="email-tag"
      href={email.gmailUrl}
      target="_blank"
      rel="noreferrer"
      title={tooltipText}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="email-tag-dot" style={dotStyle} />
      <MailIcon className="ico" sx={{ fontSize: 12 }} />
      {compact ? (
        <span className="email-tag-from">{email.fromName}</span>
      ) : (
        <>
          <span className="email-tag-from">{email.fromName}</span>
          <span className="email-tag-sep">·</span>
          <span className="email-tag-subject">{email.subject}</span>
        </>
      )}
      <OpenInNewIcon className="ico" sx={{ fontSize: 10 }} />
    </a>
  );
}

interface DiscoveredRowProps {
  /** The discovery row to render */
  item: DiscoveredJobResponse;
  /** Whether this row's checkbox is selected */
  selected: boolean;
  /** Toggle handler for the row's checkbox */
  onToggle: (id: number) => void;
  /** Dismiss handler — fired when the user clicks the "Dismiss" action */
  onDismiss: (id: number) => void;
  /** Restore handler — fired when the user clicks the "Restore" action on a dismissed row */
  onRestore: (id: number) => void;
  /** Called with the JobListing id when the user clicks a "View existing" link */
  onViewExisting: (jobListingId: number) => void;
}

/**
 * Builds the two-letter logo initials shown in the row's `.disc-logo` square.
 * Falls back to "?" when no letters can be extracted from the company name.
 *
 * @param {string} company - The company name to derive initials from
 * @returns {string} A 1–2 character uppercase string
 */
function getCompanyInitials(company: string): string {
  const trimmed = company.trim();
  if (trimmed.length === 0) {
    return "?";
  }
  const parts = trimmed.split(/\s+/);
  const firstChar = parts[0]?.charAt(0) ?? "";
  const secondChar = parts[1]?.charAt(0) ?? parts[0]?.charAt(1) ?? "";
  const initials = `${firstChar}${secondChar}`.toUpperCase();
  return initials.length === 0 ? "?" : initials;
}

/**
 * Renders a single `.disc-row` (checkbox · logo · main content · actions).
 * Stateless; delegates all data changes to its parent via the on* callbacks.
 *
 * @param {DiscoveredRowProps} props
 * @returns {ReactElement} The rendered row
 */
function DiscoveredRow({
  item,
  selected,
  onToggle,
  onDismiss,
  onRestore,
  onViewExisting,
}: DiscoveredRowProps): ReactElement {
  const isDuplicate = item.duplicateOf !== null;
  const isImported = item.status === "imported";
  const isDismissed = item.status === "dismissed";
  // Imported rows can't be re-imported, duplicates point at an already-saved
  // listing, and dismissed rows are explicitly excluded by the user. Only
  // `pending` rows are eligible for selection.
  const canSelect = !isDuplicate && !isImported && !isDismissed;
  const dataState = isDismissed
    ? "dismissed"
    : isImported
      ? "imported"
      : isDuplicate
        ? "duplicate"
        : "new";
  const duplicateRef = item.duplicateOf;
  const importedRef = item.importedAs;

  return (
    <Box
      className="disc-row"
      data-state={dataState}
      data-selected={selected}
      data-testid={`disc-row-${String(item.id)}`}
    >
      <Box className="disc-cbx">
        <Checkbox
          className="cbx"
          size="small"
          checked={selected}
          disabled={!canSelect}
          onChange={() => onToggle(item.id)}
          inputProps={{ "aria-label": `Select ${item.title}` }}
        />
      </Box>

      <Box className="company-logo disc-logo">{getCompanyInitials(item.company)}</Box>

      <Box className="disc-main">
        <Box className="disc-titlerow">
          <span className="disc-title">{item.title}</span>
          <DiscoveryStatusPill
            status={item.status}
            duplicateOf={duplicateRef}
            importedAs={importedRef}
            onViewExisting={onViewExisting}
          />
        </Box>
        <Box className="disc-meta">
          <span style={{ fontWeight: 500, color: "var(--text)" }}>{item.company}</span>
          {item.location !== null && (
            <>
              <span className="dotsep">·</span>
              <span>{item.location}</span>
            </>
          )}
          {item.salary !== null && (
            <>
              <span className="dotsep">·</span>
              <span className="mono">{item.salary}</span>
            </>
          )}
        </Box>
        <Box className="disc-source">
          <EmailTag email={item.email} compact />
          {importedRef !== null && (
            <button
              type="button"
              className="disc-source-link"
              onClick={(e) => {
                e.stopPropagation();
                onViewExisting(importedRef.jobListingId);
              }}
            >
              <LinkChainIcon className="ico" sx={{ fontSize: 11 }} /> Imported as &quot;{importedRef.title}&quot;
            </button>
          )}
          {duplicateRef !== null && importedRef === null && (
            <button
              type="button"
              className="disc-source-link"
              onClick={(e) => {
                e.stopPropagation();
                onViewExisting(duplicateRef.jobListingId);
              }}
            >
              <LinkChainIcon className="ico" sx={{ fontSize: 11 }} /> Already saved as &quot;{duplicateRef.title}&quot;
            </button>
          )}
        </Box>
      </Box>

      <Box className="disc-actions">
        <Button
          component="a"
          href={item.jobUrl}
          target="_blank"
          rel="noreferrer"
          size="small"
          variant="text"
          startIcon={<OpenInNewIcon fontSize="small" />}
          onClick={(e) => e.stopPropagation()}
        >
          Posting
        </Button>
        {isDismissed && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<UndoIcon fontSize="small" />}
            onClick={() => onRestore(item.id)}
          >
            Restore
          </Button>
        )}
        {!isDismissed && !isImported && (
          <Button
            size="small"
            variant="text"
            startIcon={<CloseIcon fontSize="small" />}
            onClick={() => onDismiss(item.id)}
            title="Dismiss this discovery"
            aria-label={`dismiss ${item.title}`}
          >
            Dismiss
          </Button>
        )}
      </Box>
    </Box>
  );
}

/**
 * Page that lists DiscoveredJob rows surfaced from the user's connected
 * Gmail inboxes, grouped by source email. Top-level shape mirrors the design
 * package's `page-inbox.jsx`:
 *
 *   - `.page-head` with title + Re-scan button
 *   - `.period-bar` segmented control (1d / 1w / 2w / 1m)
 *   - `.tabs` filter (All / New / Duplicates / Dismissed)
 *   - `.select-bar` bulk-selection toggle + Import button
 *   - Grouped list of `.disc-group` cards, each containing one or more
 *     `.disc-row` items
 *
 * Network behavior:
 *   - On mount + on period change: `listInboxDiscoveries(periodDays)` and
 *     `listGmailConnections()` are fetched in parallel.
 *   - After fetching, pending non-duplicate items are auto-selected so the
 *     user can hit Import without manually checking every row.
 *
 * @returns {ReactElement} The rendered inbox page
 */
function InboxPage(): ReactElement {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<string>("2w");
  const [filter, setFilter] = useState<FilterId>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [discoveries, setDiscoveries] = useState<DiscoveredJobResponse[]>([]);
  const [connections, setConnections] = useState<GmailConnectionResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [snackbarMessage, setSnackbarMessage] = useState<SnackbarPayload | null>(null);
  const [hasScannedThisSession, setHasScannedThisSession] = useState(false);

  const periodDays = PERIODS.find((p) => p.id === period)?.days ?? 14;

  /**
   * Fetches the current discoveries from the server and auto-selects every
   * pending non-duplicate row. Pulled out as a named callback so the mount
   * effect, period-change effect, and post-action refetches all share the
   * same code path.
   *
   * @returns {Promise<void>}
   */
  const fetchDiscoveries = useCallback(async (): Promise<void> => {
    try {
      const records = await listInboxDiscoveries(periodDays);
      setDiscoveries(records);
      // Port of the design's lines 148–155: auto-select all pending
      // non-duplicate items so the user just deselects what they don't want.
      const eligibleIds = records
        .filter((row) => row.status === "pending" && row.duplicateOf === null)
        .map((row) => row.id);
      setSelected(new Set(eligibleIds));
      setListError("");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load inbox discoveries";
      setListError(errorText);
    } finally {
      setIsLoading(false);
    }
  }, [periodDays]);

  /**
   * Fetches the list of connected Gmail accounts for the subhead. Failures
   * here are swallowed silently — the page still loads with an empty
   * connection list (which falls back to the "Connect Gmail" CTA).
   *
   * @returns {Promise<void>}
   */
  const fetchConnections = useCallback(async (): Promise<void> => {
    try {
      const rows = await listGmailConnections();
      setConnections(rows);
    } catch {
      // Subhead is non-blocking — leave the connection list empty.
      setConnections([]);
    }
  }, []);

  useEffect(() => {
    fetchDiscoveries();
  }, [fetchDiscoveries]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  /**
   * Triggers a synchronous inbox scan, then refetches discoveries so any new
   * rows show up immediately. Shows a snackbar with the newDiscoveries count.
   *
   * @returns {Promise<void>}
   */
  const handleRescan = async (): Promise<void> => {
    setScanning(true);
    setListError("");
    try {
      const scanResult = await scanInbox(periodDays);
      setHasScannedThisSession(true);
      await fetchDiscoveries();
      if (scanResult.newDiscoveries > 0) {
        setSnackbarMessage({
          severity: "success",
          text: `Found ${String(scanResult.newDiscoveries)} new`,
        });
      } else {
        setSnackbarMessage({ severity: "info", text: "No new jobs found" });
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to scan inbox";
      setListError(errorText);
    } finally {
      setScanning(false);
    }
  };

  /**
   * Imports the currently-selected discovery ids as real JobListing rows.
   * Surfaces a warning snackbar when the server reports failures or
   * duplicates; otherwise shows a success snackbar with the imported count.
   *
   * @returns {Promise<void>}
   */
  const handleImport = async (): Promise<void> => {
    const idsToImport = Array.from(selected);
    if (idsToImport.length === 0) {
      return;
    }
    setImporting(true);
    setListError("");
    try {
      const result = await importInboxDiscoveries(idsToImport);
      const importedCount = result.imported.length;
      const failedCount = result.failed.length;
      const duplicateCount = result.duplicates.length;
      if (failedCount > 0 || duplicateCount > 0) {
        setSnackbarMessage({
          severity: "warning",
          text: `Imported ${String(importedCount)} · ${String(failedCount)} failed · ${String(duplicateCount)} duplicate`,
        });
      } else {
        setSnackbarMessage({
          severity: "success",
          text: `Imported ${String(importedCount)} job${importedCount === 1 ? "" : "s"}`,
        });
      }
      await fetchDiscoveries();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to import discoveries";
      setListError(errorText);
    } finally {
      setImporting(false);
    }
  };

  /**
   * Dismisses a single discovery and refetches the list. Errors surface in
   * the page-level error alert.
   *
   * @param {number} id - The DiscoveredJob id to dismiss
   * @returns {Promise<void>}
   */
  const handleDismiss = async (id: number): Promise<void> => {
    setListError("");
    try {
      await dismissInboxDiscovery(id);
      await fetchDiscoveries();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to dismiss discovery";
      setListError(errorText);
    }
  };

  /**
   * Restores a dismissed discovery back to pending and refetches the list.
   *
   * @param {number} id - The DiscoveredJob id to restore
   * @returns {Promise<void>}
   */
  const handleRestore = async (id: number): Promise<void> => {
    setListError("");
    try {
      await restoreInboxDiscovery(id);
      await fetchDiscoveries();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to restore discovery";
      setListError(errorText);
    }
  };

  /**
   * Navigates to the existing JobListing detail page for a duplicate row's
   * "Already saved as …" link.
   *
   * @param {number} jobListingId - The existing JobListing id to view
   */
  const handleViewExisting = (jobListingId: number): void => {
    navigate(`/jobs/${String(jobListingId)}`);
  };

  /**
   * Toggles a single discovery in/out of the selection set.
   *
   * @param {number} id - The DiscoveredJob id to toggle
   */
  const toggleOne = (id: number): void => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  /**
   * Empties the selection set.
   */
  const clearSelection = (): void => {
    setSelected(new Set());
  };

  // Counters drive the filter-tab badges and the period-summary text. Each
  // row falls into exactly one bucket so the counts sum back to `all`. The
  // precedence is: dismissed > imported > duplicate > new (pending). Note
  // that `duplicate` here means "has a duplicate_of_job_id" — the new
  // `status="duplicate"` rows always satisfy that, but so do any legacy
  // `status="pending"` rows whose FK was set by the original scan code path.
  const counts = useMemo(() => {
    const tally = {
      all: discoveries.length,
      new: 0,
      duplicates: 0,
      imported: 0,
      dismissed: 0,
    };
    discoveries.forEach((row) => {
      if (row.status === "dismissed") {
        tally.dismissed += 1;
      } else if (row.status === "imported") {
        tally.imported += 1;
      } else if (row.duplicateOf !== null) {
        tally.duplicates += 1;
      } else {
        tally.new += 1;
      }
    });
    return tally;
  }, [discoveries]);

  // Apply the active filter to the in-period discoveries. Each tab maps to
  // the same precedence as `counts`: `new` is pending-only (no imported, no
  // duplicate-flagged), `duplicates` is duplicate-flagged-and-not-imported,
  // `imported` is status=imported, `dismissed` is status=dismissed.
  const filtered = useMemo(() => {
    return discoveries.filter((row) => {
      if (filter === "all") {
        return true;
      }
      if (filter === "dismissed") {
        return row.status === "dismissed";
      }
      if (row.status === "dismissed") {
        return false;
      }
      if (filter === "imported") {
        return row.status === "imported";
      }
      if (row.status === "imported") {
        return false;
      }
      if (filter === "duplicates") {
        return row.duplicateOf !== null;
      }
      if (filter === "new") {
        return row.duplicateOf === null;
      }
      return true;
    });
  }, [discoveries, filter]);

  // Group filtered items by their source email (message id), sorted by the
  // group's most recent email first.
  const groups = useMemo(() => {
    const map = new Map<string, { email: DiscoveredJobEmail; items: DiscoveredJobResponse[] }>();
    filtered.forEach((row) => {
      const existing = map.get(row.email.messageId);
      if (existing === undefined) {
        map.set(row.email.messageId, { email: row.email, items: [row] });
      } else {
        existing.items.push(row);
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      const aReceivedAt = new Date(a.email.receivedAt).getTime();
      const bReceivedAt = new Date(b.email.receivedAt).getTime();
      return bReceivedAt - aReceivedAt;
    });
  }, [filtered]);

  /**
   * Selects every visible row that is actually importable. Only pending rows
   * with no `duplicateOf` qualify — imported/duplicate/dismissed rows cannot
   * be imported (the server rejects any status other than pending).
   */
  const selectAllVisible = (): void => {
    const next = new Set<number>();
    filtered.forEach((row) => {
      if (row.status === "pending" && row.duplicateOf === null) {
        next.add(row.id);
      }
    });
    setSelected(next);
  };

  const eligibleCount = filtered.filter(
    (row) => row.status === "pending" && row.duplicateOf === null
  ).length;
  const isAllSelected = eligibleCount > 0 && selected.size === eligibleCount;

  const hasConnections = connections.length > 0;
  const firstConnectionEmail = connections[0]?.google_email ?? "";
  const hasMultipleConnections = connections.length > 1;

  /**
   * Formats a Date as a short relative time-ago string. Used for the
   * `.disc-group-time` and `.disc-source-time` mono labels.
   *
   * @param {string} isoTimestamp - The ISO timestamp to format
   * @returns {string} A short label like "2h ago" or "3d ago"
   */
  const formatRelativeTime = (isoTimestamp: string): string => {
    const then = new Date(isoTimestamp).getTime();
    if (Number.isNaN(then)) {
      return "";
    }
    const deltaMs = Date.now() - then;
    const minutes = Math.floor(deltaMs / 60000);
    if (minutes < 1) {
      return "just now";
    }
    if (minutes < 60) {
      return `${String(minutes)}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${String(hours)}h ago`;
    }
    const days = Math.floor(hours / 24);
    return `${String(days)}d ago`;
  };

  return (
    <Box>
      <Box className="page-head">
        <Box>
          <Typography component="h1" className="page-title">
            Email inbox
          </Typography>
          <Typography component="p" className="page-sub">
            {hasConnections ? (
              <>
                Scanning <span className="mono">{firstConnectionEmail}</span>
                {hasScannedThisSession ? " · last synced just now" : ""}
              </>
            ) : (
              <>
                Connect Gmail at{" "}
                <RouterLink to="/integrations" style={{ color: "var(--accent)" }}>
                  /integrations
                </RouterLink>{" "}
                to start scanning your inbox.
              </>
            )}
          </Typography>
          {hasMultipleConnections && (
            <Typography
              component="p"
              variant="caption"
              sx={{ display: "block", mt: 0.5, color: "var(--text-faint)" }}
            >
              Showing the first connected account; switcher coming soon.
            </Typography>
          )}
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="contained"
            startIcon={
              scanning ? (
                <CircularProgress size={12} color="inherit" />
              ) : (
                <RefreshIcon fontSize="small" />
              )
            }
            onClick={handleRescan}
            disabled={scanning || !hasConnections}
          >
            {scanning ? "Scanning…" : "Re-scan inbox"}
          </Button>
        </Box>
      </Box>

      {listError !== "" && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setListError("")}>
          {listError}
        </Alert>
      )}

      {/* Period selector */}
      <Box className="period-bar">
        <span className="period-label">Show jobs found in the</span>
        <Box className="seg-control">
          {PERIODS.map((p) => (
            <Button
              key={p.id}
              className="seg-btn"
              data-active={period === p.id}
              onClick={() => setPeriod(p.id)}
              disableRipple
            >
              {p.label}
            </Button>
          ))}
        </Box>
        <span className="period-summary">
          <strong>{discoveries.length}</strong> found · <strong>{counts.new}</strong> new ·{" "}
          <strong>{counts.duplicates}</strong> dupes
        </span>
      </Box>

      {/* Filter tabs */}
      <Box className="tabs">
        {FILTERS.map((tabDescriptor) => (
          <Button
            key={tabDescriptor.id}
            className="tab"
            data-active={filter === tabDescriptor.id}
            onClick={() => setFilter(tabDescriptor.id)}
            disableRipple
          >
            {tabDescriptor.label} <span className="count">{counts[tabDescriptor.id]}</span>
          </Button>
        ))}
      </Box>

      {/* Selection bar */}
      {filtered.length > 0 && (
        <Box className="select-bar">
          <Box className="select-bar-toggle" component="label">
            <Checkbox
              className="cbx"
              size="small"
              checked={isAllSelected}
              onChange={() => (isAllSelected ? clearSelection() : selectAllVisible())}
              disabled={eligibleCount === 0}
              inputProps={{ "aria-label": "select all visible" }}
            />
            <span>
              {selected.size > 0 ? (
                <>
                  <strong>{selected.size}</strong> of {eligibleCount} selected
                </>
              ) : (
                <>Select all {eligibleCount} new</>
              )}
            </span>
          </Box>
          {selected.size > 0 && (
            <Button size="small" variant="text" onClick={clearSelection}>
              Clear
            </Button>
          )}
          <Box sx={{ marginLeft: "auto", display: "flex", gap: 0.75 }}>
            <Button
              variant="contained"
              startIcon={<DownloadIcon fontSize="small" />}
              disabled={selected.size === 0 || importing}
              onClick={handleImport}
            >
              {importing
                ? "Importing…"
                : `Import ${selected.size > 0 ? `${String(selected.size)} ` : ""}job${selected.size === 1 ? "" : "s"}`}
            </Button>
          </Box>
        </Box>
      )}

      {/* Grouped list */}
      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      ) : groups.length === 0 ? (
        <Paper variant="outlined">
          <Box sx={{ p: 6, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            <InboxIcon sx={{ fontSize: 18, color: "var(--text-muted)" }} />
            <Box sx={{ fontWeight: 500, color: "var(--text)", mt: 1, mb: 0.5 }}>
              No jobs in this view
            </Box>
            Try a wider period or a different filter.
          </Box>
        </Paper>
      ) : (
        <Box className="disc-groups">
          {groups.map((g) => (
            <Box key={g.email.messageId} className="disc-group">
              <Box className="disc-group-head">
                <EmailTag email={g.email} />
                <span className="disc-group-time">{formatRelativeTime(g.email.receivedAt)}</span>
              </Box>
              {g.email.snippet !== null && (
                <Box className="disc-group-snippet">{g.email.snippet}</Box>
              )}
              <Box className="disc-group-body">
                {g.items.map((item) => (
                  <DiscoveredRow
                    key={item.id}
                    item={item}
                    selected={selected.has(item.id)}
                    onToggle={toggleOne}
                    onDismiss={handleDismiss}
                    onRestore={handleRestore}
                    onViewExisting={handleViewExisting}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Snackbar
        open={snackbarMessage !== null}
        autoHideDuration={6000}
        onClose={() => setSnackbarMessage(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {snackbarMessage === null ? undefined : (
          <Alert
            severity={snackbarMessage.severity}
            onClose={() => setSnackbarMessage(null)}
            sx={{ width: "100%" }}
          >
            {snackbarMessage.text}
          </Alert>
        )}
      </Snackbar>
    </Box>
  );
}

export default InboxPage;
