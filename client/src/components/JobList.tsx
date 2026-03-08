import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  List, ListItem, ListItemText, ListItemButton, IconButton,
  Paper, Chip, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Button, Typography,
  CircularProgress, Box,
} from "@mui/material";
import { Delete as DeleteIcon } from "@mui/icons-material";
import { deleteJobListing, type JobListingResponse } from "../services/jobListingsApi";

interface JobListProps {
  /** Array of job listings to display */
  jobListings: JobListingResponse[];
  /** Callback invoked after a job listing is successfully deleted */
  onJobDeleted: () => void;
}

/**
 * Displays a list of job listings with status indicators and delete functionality.
 * Shows a confirmation dialog before deleting.
 * @param {JobListProps} props
 * @param {JobListingResponse[]} props.jobListings - The job listings to display
 * @param {() => void} props.onJobDeleted - Called after successful deletion
 */
function JobList({ jobListings, onJobDeleted }: JobListProps) {
  const navigate = useNavigate();
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isDialogOpen = deleteTargetId !== null;

  const handleDeleteClick = (id: number) => {
    setDeleteTargetId(id);
  };

  const handleDeleteCancel = () => {
    setDeleteTargetId(null);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetId === null) return;

    setIsDeleting(true);
    try {
      await deleteJobListing(deleteTargetId);
      onJobDeleted();
    } finally {
      setIsDeleting(false);
      setDeleteTargetId(null);
    }
  };

  const getStatusChip = (status: string) => {
    const statusConfig: Record<string, { color: "warning" | "success" | "error"; label: string }> = {
      pending: { color: "warning", label: "Pending" },
      completed: { color: "success", label: "Completed" },
      failed: { color: "error", label: "Failed" },
    };
    const config = statusConfig[status] ?? { color: "warning" as const, label: status };
    return <Chip size="small" color={config.color} label={config.label} />;
  };

  const hasNoListings = jobListings.length === 0;
  if (hasNoListings) {
    return (
      <Typography color="text.secondary" sx={{ textAlign: "center", mt: 4 }}>
        No job listings yet. Add one above to get started.
      </Typography>
    );
  }

  return (
    <>
      <List>
        {jobListings.map((listing) => {
          const isPending = listing.status === "pending";
          return (
            <Paper key={listing.id} elevation={1} sx={{ mb: 1 }}>
              <ListItem
                disablePadding
                secondaryAction={
                  <IconButton
                    edge="end"
                    aria-label="delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteClick(listing.id);
                    }}
                  >
                    <DeleteIcon />
                  </IconButton>
                }
              >
                <ListItemButton onClick={() => navigate(`/jobs/${listing.id}`)}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {isPending ? (
                          <>
                            <CircularProgress size={16} />
                            <Typography component="span">Scraping...</Typography>
                          </>
                        ) : (
                          <Typography component="span">{listing.title || listing.url}</Typography>
                        )}
                        {getStatusChip(listing.status)}
                      </Box>
                    }
                    secondary={isPending ? listing.url : listing.description?.substring(0, 150)}
                  />
                </ListItemButton>
              </ListItem>
            </Paper>
          );
        })}
      </List>

      <Dialog open={isDialogOpen} onClose={handleDeleteCancel}>
        <DialogTitle>Delete Job Listing</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this job listing? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={isDeleting}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" disabled={isDeleting}>
            {isDeleting ? <CircularProgress size={20} /> : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default JobList;
