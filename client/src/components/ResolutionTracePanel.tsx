import { useState, useEffect, useCallback } from "react";
import {
  Accordion, AccordionSummary, AccordionDetails, Typography, Chip, Box,
  Link as MuiLink, List, ListItem, Divider, CircularProgress, Alert,
} from "@mui/material";
import { ExpandMore as ExpandMoreIcon } from "@mui/icons-material";
import { getResolutionLogs, type ResolutionLog, type ResolutionLogInspectedCandidate } from "../services/jobListingsApi";

interface ResolutionTracePanelProps {
  /** The id of the job listing whose resolver attempts should be rendered. */
  jobListingId: number;
  /** Bumping this prop forces a re-fetch — used by the parent page to refresh the panel after the resolver re-runs. */
  refreshToken?: number;
}

/**
 * Maps a resolver outcome string to the MUI Chip color the user expects.
 *
 * @param {string} outcome - The persisted resolver outcome
 * @returns {"success" | "info" | "warning" | "default"} A Chip color name
 */
function outcomeColor(outcome: ResolutionLog["outcome"]): "success" | "info" | "warning" | "default" {
  if (outcome === "direct") return "success";
  if (outcome === "resolved_via_redirect") return "success";
  if (outcome === "resolved_via_search") return "info";
  return "warning";
}

/**
 * Renders one inspected candidate with its scraped title, URL, matched flag,
 * and rejection reason — so users can see exactly why each candidate was
 * rejected (e.g. "title mismatch", "description overlap 23% < 40%").
 *
 * @param {{candidate: ResolutionLogInspectedCandidate}} props
 * @returns {JSX.Element}
 */
function InspectedCandidateRow({ candidate }: { candidate: ResolutionLogInspectedCandidate }) {
  return (
    <ListItem
      sx={{ display: "block", py: 1 }}
      data-testid="trace-inspected-candidate"
      data-matched={candidate.matched ? "true" : "false"}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <Chip
          size="small"
          color={candidate.matched ? "success" : "warning"}
          label={candidate.matched ? "matched" : "rejected"}
        />
        <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
          <MuiLink href={candidate.url} target="_blank" rel="noopener noreferrer">
            {candidate.url}
          </MuiLink>
        </Typography>
      </Box>
      {candidate.scrapedTitle && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          Scraped title: {candidate.scrapedTitle}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        Reason: {candidate.rejectionReason}
      </Typography>
    </ListItem>
  );
}

/**
 * Panel that exposes the resolver's decision trace for a job listing:
 * the search query that ran, the Brave results returned, and the per-
 * candidate verdicts (matched / rejected, with rejection reason). Always
 * rendered but collapsed by default so it doesn't dominate the page.
 *
 * Re-fetches the log list whenever `refreshToken` changes — the parent page
 * bumps it after the resolver completes so the panel updates without a manual reload.
 *
 * @param {ResolutionTracePanelProps} props
 * @returns {JSX.Element | null}
 */
function ResolutionTracePanel({ jobListingId, refreshToken = 0 }: ResolutionTracePanelProps) {
  const [logs, setLogs] = useState<ResolutionLog[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const fetched = await getResolutionLogs(jobListingId);
      setLogs(fetched);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load resolution logs";
      setErrorMessage(errorText);
    } finally {
      setIsLoading(false);
    }
  }, [jobListingId]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs, refreshToken]);

  const hasLogs = logs !== null && logs.length > 0;
  const latestLog = hasLogs ? logs[0] : null;
  const earlierLogs = hasLogs ? logs.slice(1) : [];

  return (
    <Accordion sx={{ mt: 2 }} data-testid="resolution-trace-panel">
      <AccordionSummary expandIcon={<ExpandMoreIcon />} data-testid="resolution-trace-summary">
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="subtitle1">Resolution trace</Typography>
          {isLoading && <CircularProgress size={16} />}
          {latestLog !== null && (
            <Chip
              size="small"
              color={outcomeColor(latestLog.outcome)}
              label={latestLog.outcome}
              data-testid="trace-latest-outcome"
            />
          )}
          {hasLogs && (
            <Typography variant="caption" color="text.secondary">
              {String(logs.length)} attempt{logs.length === 1 ? "" : "s"}
            </Typography>
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
        {!isLoading && !hasLogs && (
          <Typography color="text.secondary">No resolver attempts yet. The trace will appear once Fetch Data has run.</Typography>
        )}
        {latestLog !== null && <LatestAttempt log={latestLog} />}
        {earlierLogs.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" gutterBottom>Earlier attempts</Typography>
            {earlierLogs.map((log) => (
              <Box key={log.id} sx={{ mb: 2, opacity: 0.75 }} data-testid="trace-earlier-attempt">
                <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <Chip size="small" color={outcomeColor(log.outcome)} label={log.outcome} />
                  <Typography variant="caption" color="text.secondary">{new Date(log.created_date).toLocaleString()}</Typography>
                </Box>
                {log.final_application_url && (
                  <Typography variant="caption" sx={{ display: "block", wordBreak: "break-all" }}>
                    → {log.final_application_url}
                  </Typography>
                )}
                {log.reason && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{log.reason}</Typography>
                )}
              </Box>
            ))}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

/**
 * Renders the most recent resolver attempt in full detail: query, Brave
 * results, inspected candidates, final outcome.
 *
 * @param {{log: ResolutionLog}} props
 * @returns {JSX.Element}
 */
function LatestAttempt({ log }: { log: ResolutionLog }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {new Date(log.created_date).toLocaleString()}
      </Typography>

      {log.search_query !== null && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="subtitle2">Search query</Typography>
          <Typography variant="body2" data-testid="trace-search-query">{log.search_query}</Typography>
        </Box>
      )}

      {log.search_query === null && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Search was skipped (resolver short-circuited on the {log.outcome} path).
        </Typography>
      )}

      {log.final_application_url && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="subtitle2">Adopted URL</Typography>
          <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
            <MuiLink href={log.final_application_url} target="_blank" rel="noopener noreferrer">
              {log.final_application_url}
            </MuiLink>
          </Typography>
        </Box>
      )}

      {log.reason && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="subtitle2">Reason</Typography>
          <Typography variant="body2" color="text.secondary">{log.reason}</Typography>
        </Box>
      )}

      {log.brave_results.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" gutterBottom>
            Brave results ({String(log.brave_results.length)})
          </Typography>
          <List dense data-testid="trace-brave-results">
            {log.brave_results.map((r) => (
              <ListItem key={r.url} sx={{ display: "block", py: 0.5 }}>
                <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                  <MuiLink href={r.url} target="_blank" rel="noopener noreferrer">{r.title || r.url}</MuiLink>
                </Typography>
                {r.description && (
                  <Typography variant="caption" color="text.secondary">{r.description}</Typography>
                )}
              </ListItem>
            ))}
          </List>
        </>
      )}

      {log.inspected_candidates.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" gutterBottom>
            Inspected candidates ({String(log.inspected_candidates.length)})
          </Typography>
          <List dense>
            {log.inspected_candidates.map((c) => (
              <InspectedCandidateRow key={c.url} candidate={c} />
            ))}
          </List>
        </>
      )}
    </Box>
  );
}

export default ResolutionTracePanel;
