import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert, Box, Button, CircularProgress, IconButton, Paper, Snackbar, Tooltip, Typography,
} from "@mui/material";
import {
  Delete as DeleteIcon,
  Mail as MailIcon,
} from "@mui/icons-material";
import {
  deleteGmailConnection,
  getGmailAuthorizationUrl,
  listGmailConnections,
  type GmailConnectionResponse,
} from "../services/gmailApi";

/**
 * Page that manages the user's third-party integrations. Today this is just
 * Gmail: a "Connect Gmail" button kicks off the OAuth flow by fetching the
 * authorization URL and assigning window.location to it; on return, the
 * server redirects to `/integrations?connected=<email>` (or
 * `?error=<reason>`), which this page reads via useSearchParams and renders
 * as a snackbar.
 *
 * Existing connections are listed below the connect button with a per-row
 * disconnect button. Disconnect revokes the refresh token at Google's end
 * and then deletes the local row.
 */
function IntegrationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [connections, setConnections] = useState<GmailConnectionResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [connectingToGoogle, setConnectingToGoogle] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [snackbarMessage, setSnackbarMessage] = useState<{ severity: "success" | "error" | "warning"; text: string } | null>(null);

  /**
   * Fetches the full list of Gmail connections. Wraps the API call so the
   * mount effect and post-disconnect refresh share the same error handling.
   * @returns {Promise<void>}
   */
  const fetchConnections = useCallback(async (): Promise<void> => {
    try {
      const records = await listGmailConnections();
      setConnections(records);
      setListError("");
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to load Gmail connections";
      setListError(errorText);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // Translate ?connected= / ?error= query params (set by the OAuth callback's
  // redirect target) into a one-shot snackbar, then strip the params so a
  // reload doesn't keep re-firing the snackbar.
  useEffect(() => {
    const connectedEmail = searchParams.get("connected");
    const errorReason = searchParams.get("error");
    if (connectedEmail !== null) {
      setSnackbarMessage({ severity: "success", text: `Connected ${connectedEmail}` });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("connected");
      setSearchParams(nextParams, { replace: true });
      return;
    }
    if (errorReason !== null) {
      setSnackbarMessage({ severity: "error", text: `Gmail connect failed: ${errorReason}` });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("error");
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  /**
   * Kicks off the OAuth flow: fetches the authorization URL from the server,
   * then assigns window.location.href so the browser leaves the SPA and
   * lands on Google's consent screen.
   * @returns {Promise<void>}
   */
  const handleConnect = async (): Promise<void> => {
    setConnectingToGoogle(true);
    setListError("");
    try {
      const { url } = await getGmailAuthorizationUrl();
      window.location.href = url;
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to start Gmail connect";
      setListError(errorText);
      setConnectingToGoogle(false);
    }
  };

  /**
   * Prompts for confirmation, then disconnects a Gmail account and refreshes
   * the list. If the server reports a revokeWarning (the local row was
   * deleted but Google's revoke endpoint complained), surfaces that as a
   * warning snackbar rather than an error.
   * @param {GmailConnectionResponse} connection - The connection being disconnected
   * @returns {Promise<void>}
   */
  const handleDisconnect = async (connection: GmailConnectionResponse): Promise<void> => {
    const isConfirmed = window.confirm(`Disconnect ${connection.google_email}? You'll need to reconnect to read this inbox again.`);
    if (!isConfirmed) {
      return;
    }
    setDeletingId(connection.id);
    setListError("");
    try {
      const result = await deleteGmailConnection(connection.id);
      if (result.revokeWarning !== null) {
        setSnackbarMessage({ severity: "warning", text: result.revokeWarning });
      } else {
        setSnackbarMessage({ severity: "success", text: `Disconnected ${connection.google_email}` });
      }
      await fetchConnections();
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to disconnect Gmail account";
      setListError(errorText);
    } finally {
      setDeletingId(null);
    }
  };

  const connectionCount = connections.length;
  const hasConnections = connectionCount > 0;
  const connectionWord = connectionCount === 1 ? "account" : "accounts";

  return (
    <Box>
      <Box className="page-head">
        <Box>
          <Typography component="h1" className="page-title">Integrations</Typography>
          <Typography component="p" className="page-sub">
            {connectionCount} Gmail {connectionWord} connected · used to read replies and scan for postings
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Tooltip title="Opens Google's consent screen in this tab" arrow>
            <span>
              <Button
                variant="contained"
                startIcon={<MailIcon fontSize="small" />}
                onClick={handleConnect}
                disabled={connectingToGoogle}
              >
                {connectingToGoogle ? "Redirecting…" : "Connect Gmail"}
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {listError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setListError("")}>
          {listError}
        </Alert>
      )}

      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!isLoading && (
        <Paper variant="outlined">
          <Box className="card-head">
            <span className="card-title">Connected Gmail accounts</span>
            <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
              gmail.readonly · OAuth refresh tokens stored locally
            </span>
          </Box>

          {!hasConnections && (
            <Box sx={{ p: 5, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              <Box sx={{ fontWeight: 500, color: "var(--text)", mb: 0.75 }}>No Gmail accounts connected</Box>
              Connect a Gmail account to let this app read replies to your applications.
            </Box>
          )}

          {hasConnections && connections.map((connection) => (
            <GmailConnectionRow
              key={connection.id}
              connection={connection}
              onDisconnect={handleDisconnect}
              isDeleting={deletingId === connection.id}
            />
          ))}
        </Paper>
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

interface GmailConnectionRowProps {
  /** The connection this row represents */
  connection: GmailConnectionResponse;
  /** Called with the connection when the user clicks Disconnect */
  onDisconnect: (connection: GmailConnectionResponse) => void;
  /** Whether this row is currently being deleted (disables the action button) */
  isDeleting: boolean;
}

/**
 * Renders a single Gmail connection as a `.profile-row` (shared CSS with
 * ApplicationProfilesPage to keep the visual style consistent). Stateless;
 * delegates the disconnect action to its parent.
 *
 * @param {GmailConnectionRowProps} props
 * @returns {JSX.Element} The rendered row
 */
function GmailConnectionRow({ connection, onDisconnect, isDeleting }: GmailConnectionRowProps) {
  const localPart = connection.google_email.split("@")[0] ?? connection.google_email;
  const initials = localPart.slice(0, 2).toUpperCase();
  const connectedAt = new Date(connection.created_date).toLocaleString();
  const accessTokenExpiresAt = new Date(connection.access_token_expires_at).toLocaleString();

  return (
    <Box className="profile-row" data-testid={`gmail-connection-row-${String(connection.id)}`}>
      <Box className="profile-row-avatar">{initials}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          <span className="profile-row-label">{connection.google_email}</span>
        </Box>
        <Box className="profile-row-meta">
          Connected {connectedAt}
        </Box>
        <Box className="profile-row-meta" sx={{ mt: "2px" }}>
          <span style={{ color: "var(--text-faint)" }}>Access token expires {accessTokenExpiresAt}</span>
          <span style={{ margin: "0 8px", color: "var(--text-faint)" }}>·</span>
          <span style={{ color: "var(--text-faint)" }}>Scopes: {connection.scopes}</span>
        </Box>
      </Box>
      <Box className="profile-row-stat">
        <strong>—</strong><br />
        <span style={{ fontSize: 11 }}>emails read</span>
      </Box>
      <Box className="profile-row-actions">
        <IconButton
          aria-label={`disconnect ${connection.google_email}`}
          onClick={() => onDisconnect(connection)}
          disabled={isDeleting}
          size="small"
        >
          {isDeleting ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
        </IconButton>
      </Box>
    </Box>
  );
}

export default IntegrationsPage;
