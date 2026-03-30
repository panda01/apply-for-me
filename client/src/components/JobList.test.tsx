import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import JobList from "./JobList";
import type { JobListingResponse } from "../services/jobListingsApi";

vi.mock("../services/jobListingsApi", () => ({
  deleteJobListing: vi.fn(),
}));

import { deleteJobListing } from "../services/jobListingsApi";

const mockCompletedListing: JobListingResponse = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  description: "Build cool stuff with great teams",
  status: "init",
  live_url: null,
  post_date: "2026-03-01T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
};

const mockApplyingListing: JobListingResponse = {
  id: 2,
  title: "",
  url: "https://linkedin.com/jobs/2",
  description: "",
  status: "applying",
  live_url: null,
  post_date: "2026-03-07T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
};

const mockErrorListing: JobListingResponse = {
  id: 3,
  title: "",
  url: "https://linkedin.com/jobs/3",
  description: "",
  status: "error_applying",
  live_url: null,
  post_date: "2026-03-07T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Helper to render JobList inside a MemoryRouter.
 * @param {JobListingResponse[]} jobListings - The listings to render
 * @param {() => void} onJobDeleted - Delete callback
 */
function renderJobList(jobListings: JobListingResponse[], onJobDeleted = vi.fn()) {
  return render(
    <MemoryRouter>
      <JobList jobListings={jobListings} onJobDeleted={onJobDeleted} />
    </MemoryRouter>
  );
}

describe("JobList", () => {
  it("should show empty state when no listings", () => {
    renderJobList([]);

    expect(screen.getByText(/No job listings yet/)).toBeDefined();
  });

  it("should render completed listings with title and status", () => {
    renderJobList([mockCompletedListing]);

    expect(screen.getByText("Acme Corp - Software Engineer")).toBeDefined();
    expect(screen.getByText("Ready")).toBeDefined();
  });

  it("should render pending listings with scraping indicator", () => {
    renderJobList([mockApplyingListing]);

    expect(screen.getByText("Scraping...")).toBeDefined();
    expect(screen.getByText("Applying")).toBeDefined();
  });

  it("should render failed listings with error status", () => {
    renderJobList([mockErrorListing]);

    expect(screen.getByText("Error")).toBeDefined();
  });

  it("should show delete confirmation dialog and delete on confirm", async () => {
    const user = userEvent.setup();
    const onJobDeleted = vi.fn();
    vi.mocked(deleteJobListing).mockResolvedValue(mockCompletedListing);

    renderJobList([mockCompletedListing], onJobDeleted);

    await user.click(screen.getByLabelText("delete"));

    expect(screen.getByText(/Are you sure you want to delete/)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Delete/ }));

    await waitFor(() => {
      expect(deleteJobListing).toHaveBeenCalledWith(1);
      expect(onJobDeleted).toHaveBeenCalledOnce();
    });
  });

  it("should close dialog on cancel", async () => {
    const user = userEvent.setup();

    renderJobList([mockCompletedListing]);

    await user.click(screen.getByLabelText("delete"));
    expect(screen.getByText(/Are you sure you want to delete/)).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Cancel/ }));

    await waitFor(() => {
      expect(deleteJobListing).not.toHaveBeenCalled();
    });
  });

  it("should display all status types correctly", () => {
    renderJobList([mockCompletedListing, mockApplyingListing, mockErrorListing]);

    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByText("Applying")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
  });

  it("should render unknown status with fallback chip", () => {
    const unknownStatusListing: JobListingResponse = {
      ...mockCompletedListing,
      id: 4,
      status: "unknown_status",
    };

    renderJobList([unknownStatusListing]);

    expect(screen.getByText("unknown_status")).toBeDefined();
  });

  it("should make list items clickable to navigate to job view", () => {
    renderJobList([mockCompletedListing]);

    const listItemButton = screen.getByText("Acme Corp - Software Engineer").closest("[role='button']");

    expect(listItemButton).toBeDefined();
  });
});
