import { Button } from "@mui/material";
import { ArrowBack as ArrowBackIcon } from "@mui/icons-material";
import { Link as RouterLink } from "react-router-dom";
import type { ReactNode } from "react";

interface BackLinkProps {
  /** Destination route to navigate back to */
  to: string;
  /** Visible label for the back link */
  children: ReactNode;
}

/**
 * Reusable "back to <somewhere>" button with the standard arrow-back icon and bottom margin.
 * Used at the top of detail pages to return the user to the parent list view.
 * @param {BackLinkProps} props
 * @param {string} props.to - The route to navigate back to
 * @param {ReactNode} props.children - The visible label for the back link
 */
function BackLink({ to, children }: BackLinkProps) {
  return (
    <Button component={RouterLink} to={to} startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
      {children}
    </Button>
  );
}

export default BackLink;
