import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
} from "@mui/material";
import Search from "@mui/icons-material/Search";
import {
  applyToJob,
  getJobListings,
  type JobListingResponse,
} from "../services/jobListingsApi";
import StatusPill from "../components/StatusPill";
import { KNOWN_STATUSES, getStatusMeta } from "../lib/jobStatus";
import { useDebouncedValue } from "../lib/useDebouncedValue";

/**
 * Tries to extract the hostname portion of a URL string for display.
 * Falls back to the original string if it isn't a valid URL.
 * @param {string} rawUrl - The URL to parse.
 * @returns {string} The hostname (e.g. "example.com") or the original input.
 */
function extractHostname(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname;
  } catch {
    return rawUrl;
  }
}

/**
 * Page that displays all job listings with automatic polling, filter tabs,
 * and bulk-selection actions. Mirrors the design's Jobs page while projecting
 * the real backend statuses (init, applying, applied, error_applying, closed,
 * missing_form_url) onto the design's pill variants via {@link getStatusMeta}.
 * Polls every 5 seconds while any listing has status === "applying".
 * @returns {JSX.Element} The Jobs list page.
 */
function JobsListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [jobListings, setJobListings] = useState<JobListingResponse[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listErrorMessage, setListErrorMessage] = useState("");
  const [actionErrorMessage, setActionErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Search input is initialised from the URL `?q=` param so deep links and
  // back-navigation restore the previous search context.
  const [searchInputValue, setSearchInputValue] = useState<string>(
    () => searchParams.get("q") ?? ""
  );
  // Debounce typing so the server isn't pelted with one request per keystroke.
  const debouncedSearchQuery = useDebouncedValue(searchInputValue, 300);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetches the current job listings from the server and updates state.
   * Passes the debounced search query to the API so filtering happens
   * server-side. Surfaces errors via the {@link listErrorMessage} alert.
   */
  const fetchListings = useCallback(async () => {
    try {
      const listings = await getJobListings(debouncedSearchQuery);
      setJobListings(listings);
      setListErrorMessage("");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load job listings";
      setListErrorMessage(errorText);
    } finally {
      setIsLoadingList(false);
    }
  }, [debouncedSearchQuery]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  /**
   * Syncs the debounced search query into the URL `?q=` param using
   * `{ replace: true }` so each keystroke doesn't push a new history entry.
   * Removes the param entirely when the query is empty so the URL stays
   * tidy.
   */
  useEffect(() => {
    const trimmedQuery = debouncedSearchQuery.trim();
    const currentQueryParam = searchParams.get("q") ?? "";

    if (trimmedQuery === currentQueryParam) {
      // Already in sync — skip the setSearchParams call to avoid noisy
      // history/render churn.
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    if (trimmedQuery.length === 0) {
      nextSearchParams.delete("q");
    } else {
      nextSearchParams.set("q", trimmedQuery);
    }
    setSearchParams(nextSearchParams, { replace: true });
  }, [debouncedSearchQuery, searchParams, setSearchParams]);

  useEffect(() => {
    const hasApplyingListings = jobListings.some((listing) => listing.status === "applying");

    if (hasApplyingListings) {
      const hasNoExistingPoll = !pollIntervalRef.current;
      if (hasNoExistingPoll) {
        pollIntervalRef.current = setInterval(fetchListings, 5000);
      }
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [jobListings, fetchListings]);

  /**
   * Memoized per-status counts used to populate tab badges and the page-sub
   * summary line. Iterates the listings once instead of N times.
   */
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const listing of jobListings) {
      counts[listing.status] = (counts[listing.status] ?? 0) + 1;
    }
    return counts;
  }, [jobListings]);

  const savedCount = statusCounts["init"] ?? 0;
  const appliedCount = statusCounts["applied"] ?? 0;

  /**
   * The filter tabs to show. Includes "All" plus one tab per known status that
   * actually has at least one row in the current listings. Order follows
   * {@link KNOWN_STATUSES}.
   */
  const visibleTabs = useMemo(() => {
    const tabs: Array<{ id: string; label: string; count: number }> = [
      { id: "all", label: "All", count: jobListings.length },
    ];
    for (const status of KNOWN_STATUSES) {
      const count = statusCounts[status] ?? 0;
      if (count > 0) {
        tabs.push({ id: status, label: getStatusMeta(status).label, count });
      }
    }
    return tabs;
  }, [jobListings.length, statusCounts]);

  /**
   * The listings to render — filtered by the active tab. The "all" tab passes
   * every row through.
   */
  const filteredListings = useMemo(() => {
    if (activeTab === "all") return jobListings;
    return jobListings.filter((listing) => listing.status === activeTab);
  }, [jobListings, activeTab]);

  // Selection logic restricted to currently visible (filtered) rows.
  const visibleIds = filteredListings.map((listing) => listing.id);
  const visibleSelectedIds = visibleIds.filter((id) => selectedIds.has(id));
  const areAllVisibleSelected =
    visibleIds.length > 0 && visibleSelectedIds.length === visibleIds.length;
  const areSomeVisibleSelected =
    visibleSelectedIds.length > 0 && !areAllVisibleSelected;

  /**
   * Toggles the "select all visible" header checkbox. If every visible row is
   * already selected, deselects all of them; otherwise selects every visible
   * row (preserving selections from rows not currently visible).
   */
  const handleToggleAllVisible = () => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (areAllVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  /**
   * Toggles a single row's selection state.
   * @param {number} id - The job listing id to toggle.
   */
  const handleToggleOne = (id: number) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /**
   * Clears the entire selection set (used by the bulk-bar Clear button).
   */
  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  /**
   * Resolves the ApplicationProfile id the user picked on the apply dashboard.
   * @returns {number | null} The stored profile id, or null if none is set.
   */
  const readStoredApplicationProfileId = (): number | null => {
    const storedRaw = window.localStorage.getItem("afm:selectedApplicationProfileId");
    const storedProfileId = storedRaw === null ? NaN : parseInt(storedRaw, 10);
    if (Number.isNaN(storedProfileId)) {
      return null;
    }
    return storedProfileId;
  };

  /**
   * Triggers apply-to-job for a single listing using the stored ApplicationProfile.
   * Surfaces a top-of-page Alert if no profile is selected.
   * @param {number} jobId - The job listing id to apply to.
   */
  const handleApplyOne = async (jobId: number) => {
    const storedProfileId = readStoredApplicationProfileId();
    if (storedProfileId === null) {
      setActionErrorMessage("Pick an application profile on the Apply dashboard before applying.");
      return;
    }
    setActionErrorMessage("");
    try {
      await applyToJob(jobId, storedProfileId);
      await fetchListings();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to start application";
      setActionErrorMessage(errorText);
    }
  };

  /**
   * Auto-applies to every selected row whose status is "init" using the stored
   * ApplicationProfile. Surfaces a top-of-page Alert if no profile is selected.
   * Clears the selection after dispatching.
   */
  const handleBulkAutoApply = async () => {
    const storedProfileId = readStoredApplicationProfileId();
    if (storedProfileId === null) {
      setActionErrorMessage("Pick an application profile on the Apply dashboard before applying.");
      return;
    }
    setActionErrorMessage("");

    const idsToApply = visibleSelectedIds.filter((id) => {
      const listing = jobListings.find((row) => row.id === id);
      return listing?.status === "init";
    });

    try {
      for (const jobId of idsToApply) {
        await applyToJob(jobId, storedProfileId);
      }
      await fetchListings();
      handleClearSelection();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to start bulk application";
      setActionErrorMessage(errorText);
    }
  };

  /**
   * Count of selected rows whose status is currently "init" (used to label the
   * Auto-apply button in the bulk bar).
   */
  const autoApplyEligibleCount = visibleSelectedIds.filter((id) => {
    const listing = jobListings.find((row) => row.id === id);
    return listing?.status === "init";
  }).length;

  /**
   * Row click handler: navigates to the job view page unless the click came
   * from an interactive child element (button, link, input, label).
   * @param {React.MouseEvent<HTMLTableRowElement>} event - The row click event.
   * @param {number} jobId - The job listing id for navigation.
   */
  const handleRowClick = (
    event: React.MouseEvent<HTMLTableRowElement>,
    jobId: number,
  ) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, label")) return;
    navigate(`/jobs/${String(jobId)}`);
  };

  if (isLoadingList) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      {listErrorMessage && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setListErrorMessage("")}>
          {listErrorMessage}
        </Alert>
      )}
      {actionErrorMessage && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionErrorMessage("")}>
          {actionErrorMessage}
        </Alert>
      )}

      <div className="page-head">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-sub">
            {savedCount} saved · {appliedCount} applied this cycle
          </p>
        </div>
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField
            size="small"
            placeholder="Search title, description, or URL"
            value={searchInputValue}
            onChange={(event) => setSearchInputValue(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: {
                "aria-label": "Search jobs",
              },
            }}
          />
          <Button variant="outlined" size="small" disabled>
            Filters
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => navigate("/")}
          >
            Add job
          </Button>
        </Box>
      </div>

      <div className="tabs">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="tab"
            data-active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label} <span className="count">{tab.count}</span>
          </button>
        ))}
      </div>

      <Paper variant="outlined">
        {visibleSelectedIds.length > 0 && (
          <div className="bulk-bar">
            <span className="count">{visibleSelectedIds.length} selected</span>
            <span className="sep">·</span>
            <Button size="small" variant="text" onClick={handleClearSelection}>
              Clear
            </Button>
            <Box className="actions">
              <Button
                size="small"
                variant="outlined"
                onClick={handleBulkAutoApply}
                disabled={autoApplyEligibleCount === 0}
              >
                Auto-apply ({autoApplyEligibleCount})
              </Button>
              <Button size="small" variant="outlined" disabled>
                Change status
              </Button>
              <Button size="small" variant="outlined" disabled>
                Export
              </Button>
              <Button size="small" variant="outlined" color="error" disabled>
                Delete
              </Button>
            </Box>
          </div>
        )}

        <Table>
          <TableHead>
            <TableRow>
              <TableCell className="cbx-cell" padding="checkbox">
                <Checkbox
                  size="small"
                  checked={areAllVisibleSelected}
                  indeterminate={areSomeVisibleSelected}
                  onChange={handleToggleAllVisible}
                  inputProps={{ "aria-label": "Select all" }}
                />
              </TableCell>
              <TableCell>Title</TableCell>
              <TableCell sx={{ width: 130 }}>Status</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Salary</TableCell>
              <TableCell>URL</TableCell>
              <TableCell sx={{ width: 110 }}>Added</TableCell>
              <TableCell sx={{ width: 160, textAlign: "right" }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredListings.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  sx={{ py: 4, textAlign: "center", color: "var(--text-muted)" }}
                >
                  {debouncedSearchQuery.trim().length > 0 ? (
                    <>
                      <div>
                        {`No jobs match "${debouncedSearchQuery.trim()}" in this tab.`}
                      </div>
                      <Box sx={{ mt: 1 }}>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setSearchInputValue("")}
                        >
                          Clear search
                        </Button>
                      </Box>
                    </>
                  ) : (
                    "No jobs match this filter."
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredListings.map((listing) => {
                const isRowSelected = selectedIds.has(listing.id);
                const hostnameForUrl = extractHostname(listing.url);
                const titleHasNotLoadedYet = !listing.title || listing.title.trim().length === 0;
                const titleText = titleHasNotLoadedYet ? hostnameForUrl : listing.title;
                // Sub-line under the title shows the company. The URL hostname
                // is only a fallback for legacy rows where `company` is null /
                // empty — without that fallback rows like LinkedIn alerts
                // would just display the host every time they pre-date the
                // company-column backfill.
                const companyText = listing.company !== null && listing.company.trim().length > 0
                  ? listing.company
                  : "";
                const subLineText = titleHasNotLoadedYet
                  ? ""
                  : companyText.length > 0
                    ? companyText
                    : hostnameForUrl;
                const locationText = listing.location !== null && listing.location.trim().length > 0
                  ? listing.location
                  : "—";
                const addedDateText = new Date(listing.created_date).toLocaleDateString();

                return (
                  <TableRow
                    key={listing.id}
                    data-selected={isRowSelected}
                    onClick={(event) => handleRowClick(event, listing.id)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell className="cbx-cell" padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={isRowSelected}
                        onChange={() => handleToggleOne(listing.id)}
                        inputProps={{ "aria-label": `Select ${titleText}` }}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="col-title">{titleText}</div>
                      {subLineText.length > 0 && (
                        <div className="col-co">{subLineText}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={listing.status} />
                    </TableCell>
                    <TableCell className="col-co">{locationText}</TableCell>
                    <TableCell className="mono">{listing.salary ?? "—"}</TableCell>
                    <TableCell
                      sx={{
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <a
                        href={listing.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mono"
                      >
                        {listing.url}
                      </a>
                    </TableCell>
                    <TableCell className="mono">{addedDateText}</TableCell>
                    <TableCell sx={{ textAlign: "right", pr: 2 }}>
                      {listing.status === "init" ? (
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => handleApplyOne(listing.id)}
                        >
                          Apply
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => navigate(`/jobs/${String(listing.id)}`)}
                        >
                          View
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Paper>
    </>
  );
}

export default JobsListPage;
