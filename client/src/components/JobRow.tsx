import { Box, Button, CircularProgress, ListItem, ListItemText, Typography } from "@mui/material";
import { OpenInNew as OpenInNewIcon, PlayArrow as PlayArrowIcon } from "@mui/icons-material";
import type { ReactNode } from "react";
import type { JobListingResponse } from "../services/jobListingsApi";

interface JobRowAction {
  /** Visible button label (e.g., "Apply", "Retry") */
  label: string;
  /** MUI button color */
  color?: "primary" | "warning" | "error" | "secondary" | "info" | "success";
  /** Click handler invoked with the job id */
  onClick: (id: number) => void;
  /** Whether the button should be disabled for this row */
  disabled: boolean;
  /** Whether this row is the one currently applying (shows a spinner) */
  isLoading: boolean;
}

interface JobRowProps {
  /** The job listing to display */
  listing: JobListingResponse;
  /** Optional status chip to show next to the title */
  statusChip?: ReactNode;
  /** Optional per-row button (Apply/Retry). When omitted, no button is rendered. */
  action?: JobRowAction;
}

/**
 * Renders a single job listing row used by the application dashboard sections.
 * Shows the title (or URL), the URL as an external link, an optional status chip,
 * and an optional per-row action button (e.g., Apply/Retry).
 * @param {JobRowProps} props
 * @param {JobListingResponse} props.listing - The job listing to display
 * @param {ReactNode | undefined} props.statusChip - Optional status chip alongside the title
 * @param {JobRowAction | undefined} props.action - Optional per-row action button
 */
function JobRow({ listing, statusChip, action }: JobRowProps) {
  const titleText = listing.title || listing.url;

  return (
    <ListItem key={listing.id} disablePadding sx={{ mb: 0.5 }}>
      <Box sx={{ px: 2, py: 1, flex: 1, minWidth: 0 }}>
        <ListItemText
          primary={
            statusChip !== undefined ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography component="span" noWrap>{titleText}</Typography>
                {statusChip}
              </Box>
            ) : (
              titleText
            )
          }
          secondary={
            <Typography
              component="a"
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
              color="primary"
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
              noWrap
            >
              {listing.url}
              <OpenInNewIcon sx={{ fontSize: 14 }} />
            </Typography>
          }
          primaryTypographyProps={{ noWrap: true }}
        />
      </Box>
      {action && (
        <Button
          size="small"
          variant="outlined"
          color={action.color}
          startIcon={action.isLoading ? <CircularProgress size={14} /> : <PlayArrowIcon />}
          onClick={() => action.onClick(listing.id)}
          disabled={action.disabled}
          sx={{ ml: 1, minWidth: 100 }}
        >
          {action.label}
        </Button>
      )}
    </ListItem>
  );
}

export default JobRow;
