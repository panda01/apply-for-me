import { Alert, Box, CircularProgress } from "@mui/material";

interface LoadingOrErrorPanelProps {
  /** Whether the surrounding page is still loading its primary data */
  isLoading: boolean;
  /** Error message to display in an alert (empty string hides the alert) */
  errorMessage: string;
  /** Optional handler invoked when the user dismisses the error alert */
  onClearError?: () => void;
}

/**
 * Renders the standard loading-spinner-and-error-alert pair shown at the top of
 * detail pages. Either, both, or neither may be visible depending on state.
 * @param {LoadingOrErrorPanelProps} props
 * @param {boolean} props.isLoading - Whether the page is still loading its data
 * @param {string} props.errorMessage - Error text to display (empty hides the alert)
 * @param {(() => void) | undefined} props.onClearError - Optional close-button handler
 */
function LoadingOrErrorPanel({ isLoading, errorMessage, onClearError }: LoadingOrErrorPanelProps) {
  return (
    <>
      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {errorMessage && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={onClearError}>
          {errorMessage}
        </Alert>
      )}
    </>
  );
}

export default LoadingOrErrorPanel;
