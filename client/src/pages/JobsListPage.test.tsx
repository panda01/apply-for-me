import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import JobsListPage from "./JobsListPage";

vi.mock("../services/jobListingsApi", () => ({
  getJobListings: vi.fn(),
  deleteJobListing: vi.fn(),
}));

import { getJobListings } from "../services/jobListingsApi";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Helper to render JobsListPage inside a MemoryRouter.
 */
function renderJobsListPage() {
  return render(
    <MemoryRouter>
      <JobsListPage />
    </MemoryRouter>
  );
}

describe("JobsListPage", () => {
  it("should render the page title", async () => {
    vi.mocked(getJobListings).mockResolvedValue([]);

    renderJobsListPage();

    expect(screen.getByText("Job Listings")).toBeDefined();
    await waitFor(() => {
      expect(getJobListings).toHaveBeenCalledOnce();
    });
  });

  it("should fetch and display job listings on mount", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      {
        id: 1,
        title: "Acme Corp - Software Engineer",
        url: "https://linkedin.com/jobs/1",
        description: "Build cool stuff",
        post_date: "2026-03-01T00:00:00.000Z",
        created_date: "2026-03-07T00:00:00.000Z",
        status: "completed",
        live_url: null,
      },
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Acme Corp - Software Engineer")).toBeDefined();
    });
  });

  it("should show loading indicator initially", () => {
    vi.mocked(getJobListings).mockReturnValue(new Promise(() => {}));

    renderJobsListPage();

    expect(screen.getByRole("progressbar")).toBeDefined();
  });

  it("should show error message when fetch fails", async () => {
    vi.mocked(getJobListings).mockRejectedValue(new Error("Network error"));

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeDefined();
    });
  });

  it("should show generic error message when a non-Error is thrown", async () => {
    vi.mocked(getJobListings).mockRejectedValue("string error");

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Failed to load job listings")).toBeDefined();
    });
  });

  it("should show empty state when no listings exist", async () => {
    vi.mocked(getJobListings).mockResolvedValue([]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText(/No job listings yet/)).toBeDefined();
    });
  });

  it("should poll every 5 seconds when a listing is pending", async () => {
    vi.useFakeTimers();

    const pendingListing = {
      id: 1,
      title: "",
      url: "https://linkedin.com/jobs/1",
      description: "",
      post_date: "2026-03-07T00:00:00.000Z",
      created_date: "2026-03-07T00:00:00.000Z",
      status: "pending",
      live_url: null,
    };

    const completedListing = {
      ...pendingListing,
      title: "Acme Corp - Engineer",
      status: "completed",
    };

    vi.mocked(getJobListings)
      .mockResolvedValueOnce([pendingListing])
      .mockResolvedValueOnce([completedListing]);

    await act(async () => {
      renderJobsListPage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(getJobListings).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getJobListings).toHaveBeenCalledTimes(2);
  });

  it("should stop polling when no listings are pending", async () => {
    vi.useFakeTimers();

    const completedListing = {
      id: 1,
      title: "Acme Corp - Engineer",
      url: "https://linkedin.com/jobs/1",
      description: "Build stuff",
      post_date: "2026-03-07T00:00:00.000Z",
      created_date: "2026-03-07T00:00:00.000Z",
      status: "completed",
      live_url: null,
    };

    vi.mocked(getJobListings).mockResolvedValue([completedListing]);

    await act(async () => {
      renderJobsListPage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(getJobListings).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(getJobListings).toHaveBeenCalledTimes(1);
  });
});
