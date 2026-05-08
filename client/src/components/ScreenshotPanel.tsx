import { useEffect, useState } from "react";
import {
  Paper, Typography, TextField, Button, Box, Alert, CircularProgress,
} from "@mui/material";
import { CameraAlt as CameraIcon } from "@mui/icons-material";
import { captureScreenshot } from "../services/managedContainersApi";

interface ScreenshotPanelProps {
  /** The id of the managed container that should perform the capture */
  containerId: number;
}

/**
 * URL input + Capture button + result area for taking a screenshot through
 * a managed container's WireGuard tunnel. Renders the returned PNG as an
 * <img> via URL.createObjectURL, and surfaces any capture failure as a
 * dismissable MUI Alert showing the error message returned by the server.
 *
 * @param {ScreenshotPanelProps} props
 * @param {number} props.containerId - Id of the container performing the capture
 */
function ScreenshotPanel({ containerId }: ScreenshotPanelProps) {
  const [url, setUrl] = useState("https://google.com");
  const [isCapturing, setIsCapturing] = useState(false);
  const [imageObjectUrl, setImageObjectUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Object URLs created with URL.createObjectURL must be revoked when the
  // <img> no longer references them or the browser leaks the underlying blob.
  useEffect(() => {
    const currentUrl = imageObjectUrl;
    return () => {
      if (currentUrl !== null) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [imageObjectUrl]);

  /**
   * Sends the capture request through the backend, replaces any previously
   * displayed image with the new one, and displays a clear error message if
   * anything in the chain (URL validation, container, WG tunnel, Playwright)
   * fails.
   */
  const handleCapture = async () => {
    const trimmedUrl = url.trim();
    const isEmptyUrl = trimmedUrl.length === 0;
    if (isEmptyUrl) {
      setErrorMessage("Please enter a URL to screenshot");
      return;
    }

    setIsCapturing(true);
    setErrorMessage("");
    try {
      const blob = await captureScreenshot(containerId, trimmedUrl);
      const newObjectUrl = URL.createObjectURL(blob);
      setImageObjectUrl((previousObjectUrl) => {
        if (previousObjectUrl !== null) {
          URL.revokeObjectURL(previousObjectUrl);
        }
        return newObjectUrl;
      });
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to capture screenshot";
      setErrorMessage(errorText);
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }} data-testid="screenshot-panel">
      <Typography variant="h6" sx={{ mb: 2 }}>
        Screenshot a URL
      </Typography>

      <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
        <TextField
          label="URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          fullWidth
          disabled={isCapturing}
          inputProps={{ "data-testid": "screenshot-url-input" }}
        />
        <Button
          variant="contained"
          startIcon={isCapturing ? <CircularProgress size={16} color="inherit" /> : <CameraIcon />}
          onClick={handleCapture}
          disabled={isCapturing}
          data-testid="screenshot-capture-button"
        >
          {isCapturing ? "Capturing..." : "Capture"}
        </Button>
      </Box>

      {errorMessage && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setErrorMessage("")}
          data-testid="screenshot-error"
        >
          {errorMessage}
        </Alert>
      )}

      {imageObjectUrl && (
        <Box
          component="img"
          src={imageObjectUrl}
          alt="Screenshot result"
          data-testid="screenshot-image"
          sx={{ maxWidth: "100%", height: "auto", display: "block", border: "1px solid #ccc" }}
        />
      )}
    </Paper>
  );
}

export default ScreenshotPanel;
