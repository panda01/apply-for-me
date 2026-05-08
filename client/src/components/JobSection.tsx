import { List, Paper, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface JobSectionProps {
  /** Section heading shown next to the count, e.g., "Applied" */
  title: string;
  /** Number of jobs displayed (rendered as "(N)" after the title) */
  count: number;
  /** The rendered job rows (typically a list of <JobRow /> elements) */
  children: ReactNode;
}

/**
 * Renders a Paper-wrapped section heading + List used by the application dashboard
 * to group jobs (Applied / Closed / Errors / etc.). The actual rows are passed in as children.
 * @param {JobSectionProps} props
 * @param {string} props.title - The section heading
 * @param {number} props.count - The count shown after the title
 * @param {ReactNode} props.children - The job rows to render in the list
 */
function JobSection({ title, count, children }: JobSectionProps) {
  return (
    <Paper elevation={1} sx={{ p: 2, mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {title} ({count})
      </Typography>
      <List disablePadding>
        {children}
      </List>
    </Paper>
  );
}

export default JobSection;
