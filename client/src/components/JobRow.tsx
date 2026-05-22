import { Box, Button, CircularProgress, ListItem, ListItemButton, ListItemText, Typography } from "@mui/material";
import { OpenInNew as OpenInNewIcon, PlayArrow as PlayArrowIcon } from "@mui/icons-material";
import type { MouseEvent, ReactNode } from "react";
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
  /** Optional row-level click handler. When set, the row body becomes a MUI ListItemButton — used by the dashboard to navigate to the attempts list. The external-URL link and Apply button both stop propagation so they don't trigger this. */
  onClick?: (id: number) => void;
}

/**
 * Renders a single job listing row used by the application dashboard sections.
 * Shows the title (or URL), the URL as an external link, an optional status chip,
 * and an optional per-row action button (e.g., Apply/Retry). When `onClick` is
 * provided the entire row body becomes clickable; the external link and action
 * button stop propagation so they keep their own behavior.
 * @param {JobRowProps} props
 * @param {JobListingResponse} props.listing - The job listing to display
 * @param {ReactNode | undefined} props.statusChip - Optional status chip alongside the title
 * @param {JobRowAction | undefined} props.action - Optional per-row action button
 * @param {((id: number) => void) | undefined} props.onClick - Optional row-body click handler (navigates to attempts list in the dashboard)
 */
function JobRow({ listing, statusChip, action, onClick }: JobRowProps) {
  const titleText = listing.title || listing.url;

  const rowContent = (
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
          onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
          noWrap
        >
          {listing.url}
          <OpenInNewIcon sx={{ fontSize: 14 }} />
        </Typography>
      }
      primaryTypographyProps={{ noWrap: true }}
    />
  );

  const isClickable = onClick !== undefined;

  return (
    <ListItem key={listing.id} disablePadding sx={{ mb: 0.5 }}>
      {isClickable ? (
        <ListItemButton onClick={() => onClick(listing.id)} sx={{ px: 2, py: 1, flex: 1, minWidth: 0 }}>
          {rowContent}
        </ListItemButton>
      ) : (
        <Box sx={{ px: 2, py: 1, flex: 1, minWidth: 0 }}>{rowContent}</Box>
      )}
      {action && (
        <Button
          size="small"
          variant="outlined"
          color={action.color}
          startIcon={action.isLoading ? <CircularProgress size={14} /> : <PlayArrowIcon />}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            action.onClick(listing.id);
          }}
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
