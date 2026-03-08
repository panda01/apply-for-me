import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import JobViewPage from "./JobViewPage";

vi.mock("../services/jobListingsApi", () => ({
  getJobListing: vi.fn(),
}));

import { getJobListing } from "../services/jobListingsApi";

const mockCompletedListing = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  description: "Build cool stuff with great teams and cutting-edge technology.",
  status: "completed",
  live_url: null,
  post_date: "2026-03-01T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
};

const mockPendingListing = {
  id: 1,
  title: "",
  url: "https://linkedin.com/jobs/1",
  description: "",
  status: "pending",
  live_url: null,
  post_date: "2026-03-07T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Helper to render JobViewPage at a specific route with URL params.
 * @param {string} path - The route path to render (e.g., "/jobs/1")
 */
function renderJobViewPage(path = "/jobs/1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs/:id" element={<JobViewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("JobViewPage", () => {
  it("should show loading indicator while fetching", () => {
    vi.mocked(getJobListing).mockReturnValue(new Promise(() => {}));

    renderJobViewPage();

    expect(screen.getByRole("progressbar")).toBeDefined();
  });

  it("should display job listing details after fetching a completed listing", async () => {
    vi.mocked(getJobListing).mockResolvedValue(mockCompletedListing);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByText("Acme Corp - Software Engineer")).toBeDefined();
    });

    expect(screen.getByText("Completed")).toBeDefined();
    expect(screen.getByText(/Build cool stuff with great teams/)).toBeDefined();
    expect(screen.getByText("https://linkedin.com/jobs/1")).toBeDefined();
  });

  it("should show error message when fetch fails", async () => {
    vi.mocked(getJobListing).mockRejectedValue(new Error("Job listing not found"));

    renderJobViewPage("/jobs/999");

    await waitFor(() => {
      expect(screen.getByText("Job listing not found")).toBeDefined();
    });
  });

  it("should show generic error message when a non-Error is thrown", async () => {
    vi.mocked(getJobListing).mockRejectedValue("string error");

    renderJobViewPage("/jobs/1");

    await waitFor(() => {
      expect(screen.getByText("Failed to load job listing")).toBeDefined();
    });
  });

  it("should show error for invalid id parameter", async () => {
    renderJobViewPage("/jobs/abc");

    await waitFor(() => {
      expect(screen.getByText("Invalid job listing ID")).toBeDefined();
    });

    expect(getJobListing).not.toHaveBeenCalled();
  });

  it("should render back to jobs list link", async () => {
    vi.mocked(getJobListing).mockResolvedValue(mockCompletedListing);

    renderJobViewPage();

    const backLink = screen.getByRole("link", { name: /Back to Jobs List/ });

    expect(backLink).toBeDefined();
    expect(backLink.getAttribute("href")).toBe("/jobs");
  });

  it("should display 'Untitled' when title is empty on completed listing", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      ...mockCompletedListing,
      title: "",
    });

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByText("Untitled")).toBeDefined();
    });
  });

  it("should display 'No description available.' when description is empty", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      ...mockCompletedListing,
      description: "",
    });

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByText("No description available.")).toBeDefined();
    });
  });

  it("should show scraping progress view when listing is pending", async () => {
    vi.useFakeTimers();
    vi.mocked(getJobListing).mockResolvedValue(mockPendingListing);

    await act(async () => {
      renderJobViewPage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Scraping Job Details...")).toBeDefined();
    expect(screen.getByText("Pending")).toBeDefined();
    expect(screen.getByText(/Waiting for browser session to start/)).toBeDefined();
  });

  it("should show iframe when pending listing has a live_url", async () => {
    vi.useFakeTimers();
    const pendingWithLiveUrl = {
      ...mockPendingListing,
      live_url: "https://live.browser-use.com/session/abc123",
    };
    vi.mocked(getJobListing).mockResolvedValue(pendingWithLiveUrl);

    await act(async () => {
      renderJobViewPage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("https://live.browser-use.com/session/abc123");
    expect(iframe?.getAttribute("title")).toBe("Browser Use Live View");
  });

  it("should poll every 3 seconds when listing is pending", async () => {
    vi.useFakeTimers();
    vi.mocked(getJobListing)
      .mockResolvedValueOnce(mockPendingListing)
      .mockResolvedValueOnce(mockCompletedListing);

    await act(async () => {
      renderJobViewPage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(getJobListing).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(getJobListing).toHaveBeenCalledTimes(2);
  });

  it("should stop polling and show details when listing becomes completed", async () => {
    vi.useFakeTimers();
    vi.mocked(getJobListing)
      .mockResolvedValueOnce(mockPendingListing)
      .mockResolvedValueOnce(mockCompletedListing);

    await act(async () => {
      renderJobViewPage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Should be in pending state
    expect(screen.getByText("Scraping Job Details...")).toBeDefined();

    // Advance to trigger poll — the resolved mock will update state
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Should now show completed details
    expect(screen.getByText("Acme Corp - Software Engineer")).toBeDefined();
    expect(screen.getByText("Completed")).toBeDefined();

    // Advance more - should not poll again
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(getJobListing).toHaveBeenCalledTimes(2);
  });
});
