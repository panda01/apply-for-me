import { Box, CircularProgress, Typography } from "@mui/material";

interface LiveBrowserViewProps {
  /** The live-view URL from the Browser Use session, or null if it hasn't started yet */
  liveUrl: string | null;
}

/**
 * Renders the live-browser iframe when a Browser Use session URL is available,
 * or a "waiting for session" placeholder otherwise. Used during job applications
 * to show the in-progress automated browser session to the user.
 * @param {LiveBrowserViewProps} props
 * @param {string | null} props.liveUrl - The live-view URL, or null while waiting
 */
function LiveBrowserView({ liveUrl }: LiveBrowserViewProps) {
  const hasLiveUrl = liveUrl !== null && liveUrl !== "";

  if (hasLiveUrl) {
    return (
      <Box
        component="iframe"
        src={liveUrl}
        title="Browser Use Live View"
        sx={{
          width: "100%",
          height: 500,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
        }}
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }

  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300, bgcolor: "grey.100", borderRadius: 1 }}>
      <Box sx={{ textAlign: "center" }}>
        <CircularProgress size={32} sx={{ mb: 1 }} />
        <Typography color="text.secondary">
          Waiting for browser session to start...
        </Typography>
      </Box>
    </Box>
  );
}

export default LiveBrowserView;
