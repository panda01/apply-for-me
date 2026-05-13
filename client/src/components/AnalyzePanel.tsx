import { useState } from "react";
import {
  Paper, Typography, TextField, Button, Box, Alert, CircularProgress, Chip, Stack, FormControlLabel, Checkbox,
} from "@mui/material";
import {
  AutoAwesome as AnalyzeIcon,
  CheckCircle as CheckIcon,
  Cancel as CancelIcon,
} from "@mui/icons-material";
import { analyzeUrl, type AnalyzeResponse } from "../services/managedContainersApi";

interface AnalyzePanelProps {
  /** The id of the managed container that should perform the analysis */
  containerId: number;
}

/**
 * URL input + Analyze button + result display for the Claude tool-calling agent.
 * The container dismisses popups, inspects the page, and reports whether the URL
 * is a job description page along with the Class B signals it found and a final
 * screenshot. Failures surface as a dismissable Alert with the server's error message.
 *
 * @param {AnalyzePanelProps} props
 * @param {number} props.containerId - Id of the container performing the analysis
 */
function AnalyzePanel({ containerId }: AnalyzePanelProps) {
  const [url, setUrl] = useState("https://www.linkedin.com/jobs/view/software-engineer-new-grads-at-giga-4374834620");
  const [useProxy, setUseProxy] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  /**
   * Sends the analyze request through the backend, replaces any prior result
   * with the new one, and surfaces a clear error message on failure.
   */
  const handleAnalyze = async () => {
    const trimmedUrl = url.trim();
    const isEmptyUrl = trimmedUrl.length === 0;
    if (isEmptyUrl) {
      setErrorMessage("Please enter a URL to analyze");
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage("");
    setResult(null);
    try {
      const response = await analyzeUrl(containerId, trimmedUrl, useProxy);
      setResult(response);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Failed to analyze URL";
      setErrorMessage(errorText);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const verdictChipProps = result === null
    ? null
    : result.is_job_description
      ? { color: "success" as const, icon: <CheckIcon />, label: "Job description page" }
      : { color: "default" as const, icon: <CancelIcon />, label: "Not a job description page" };

  const applyChipProps = result === null
    ? null
    : result.apply_button_present
      ? { color: "success" as const, label: "Apply button found" }
      : { color: "default" as const, label: "No apply button" };

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }} data-testid="analyze-panel">
      <Typography variant="h6" sx={{ mb: 2 }}>
        Analyze a URL
      </Typography>

      <Box sx={{ display: "flex", gap: 2, mb: 1 }}>
        <TextField
          label="URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          fullWidth
          disabled={isAnalyzing}
          inputProps={{ "data-testid": "analyze-url-input" }}
        />
        <Button
          variant="contained"
          startIcon={isAnalyzing ? <CircularProgress size={16} color="inherit" /> : <AnalyzeIcon />}
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          data-testid="analyze-button"
        >
          {isAnalyzing ? "Analyzing..." : "Analyze"}
        </Button>
      </Box>

      <FormControlLabel
        sx={{ mb: 1 }}
        control={
          <Checkbox
            checked={useProxy}
            onChange={(event) => setUseProxy(event.target.checked)}
            disabled={isAnalyzing}
            data-testid="analyze-use-proxy"
          />
        }
        label="Use residential proxy (Smartproxy) — needed for Cloudflare-blocked sites"
      />


      {errorMessage && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setErrorMessage("")}
          data-testid="analyze-error"
        >
          {errorMessage}
        </Alert>
      )}

      {result && verdictChipProps && applyChipProps && (
        <Box data-testid="analyze-result">
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Chip
              color={verdictChipProps.color}
              icon={verdictChipProps.icon}
              label={verdictChipProps.label}
              data-testid="analyze-verdict-chip"
            />
            <Chip
              color={applyChipProps.color}
              label={applyChipProps.label}
              data-testid="analyze-apply-chip"
            />
          </Stack>

          {result.description_signals.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Signals found
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap data-testid="analyze-signals">
                {result.description_signals.map((signal) => (
                  <Chip key={signal} size="small" label={signal} variant="outlined" />
                ))}
              </Stack>
            </Box>
          )}

          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Reasoning
          </Typography>
          <Typography sx={{ mb: 2 }} data-testid="analyze-reasoning">
            {result.reasoning}
          </Typography>

          {result.screenshot_b64 && (
            <Box
              component="img"
              src={`data:image/png;base64,${result.screenshot_b64}`}
              alt="Analyzed page screenshot"
              data-testid="analyze-screenshot"
              sx={{ maxWidth: "100%", height: "auto", display: "block", border: "1px solid #ccc" }}
            />
          )}
        </Box>
      )}
    </Paper>
  );
}

export default AnalyzePanel;
