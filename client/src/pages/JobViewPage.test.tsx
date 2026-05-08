import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import JobViewPage from "./JobViewPage";

vi.mock("../services/jobListingsApi", () => ({
  getJobListing: vi.fn(),
  fetchJobData: vi.fn(),
  applyToJob: vi.fn(),
}));

import { getJobListing, fetchJobData, applyToJob } from "../services/jobListingsApi";

const mockCompletedListing = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  description: "Build cool stuff with great teams and cutting-edge technology.",
  salary: "$120k - $150k",
  status: "init",
  live_url: null,
  post_date: "2026-03-01T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
};

const mockEmptyListing = {
  id: 1,
  title: "",
  url: "https://linkedin.com/jobs/1",
  description: "",
  salary: null,
  status: "init",
  live_url: null,
  post_date: "2026-03-07T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
};

const mockApplyingListing = {
  id: 1,
  title: "",
  url: "https://linkedin.com/jobs/1",
  description: "",
  salary: null,
  status: "applying",
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

    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByText(/Build cool stuff with great teams/)).toBeDefined();
    expect(screen.getByText("https://linkedin.com/jobs/1")).toBeDefined();
    expect(screen.getByText("$120k - $150k")).toBeDefined();
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

  it("should display 'Untitled' and prompt to fetch data when title is empty", async () => {
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByText("Untitled")).toBeDefined();
    });

    expect(screen.getByText(/No job details yet/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Fetch Data/ })).toBeDefined();
  });

  it("should show Fetch Data and Apply buttons for init status", async () => {
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fetch Data/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Apply/ })).toBeDefined();
    });
  });

  it("should call fetchJobData when Fetch Data button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(fetchJobData).mockResolvedValue(mockEmptyListing);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fetch Data/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Fetch Data/ }));

    expect(fetchJobData).toHaveBeenCalledWith(1);
  });

  it("should call applyToJob when Apply button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(applyToJob).mockResolvedValue({ ...mockEmptyListing, status: "applying" });

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Apply/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Apply/ }));

    expect(applyToJob).toHaveBeenCalledWith(1);
  });

  it("should show applying view when listing is in applying status", async () => {
    vi.useFakeTimers();
    vi.mocked(getJobListing).mockResolvedValue(mockApplyingListing);

    await act(async () => {
      renderJobViewPage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Applying to Job...")).toBeDefined();
    expect(screen.getByText(/Waiting for browser session to start/)).toBeDefined();
  });

  it("should show iframe when applying listing has a live_url", async () => {
    vi.useFakeTimers();
    const applyingWithLiveUrl = {
      ...mockApplyingListing,
      live_url: "https://live.browser-use.com/session/abc123",
    };
    vi.mocked(getJobListing).mockResolvedValue(applyingWithLiveUrl);

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

  it("should poll every 3 seconds when listing is applying", async () => {
    vi.useFakeTimers();
    vi.mocked(getJobListing)
      .mockResolvedValueOnce(mockApplyingListing)
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
      .mockResolvedValueOnce(mockApplyingListing)
      .mockResolvedValueOnce(mockCompletedListing);

    await act(async () => {
      renderJobViewPage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Applying to Job...")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByText("Acme Corp - Software Engineer")).toBeDefined();
    expect(screen.getByText("Ready")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(getJobListing).toHaveBeenCalledTimes(2);
  });

  it("should not show Apply button for applied status", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      ...mockCompletedListing,
      status: "applied",
    });

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByText("Acme Corp - Software Engineer")).toBeDefined();
    });

    expect(screen.queryByRole("button", { name: /^Apply$/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Fetch Data/ })).toBeDefined();
  });

  it("should show action error when fetchJobData fails", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(fetchJobData).mockRejectedValue(new Error("Scraping service unavailable"));

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fetch Data/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Fetch Data/ }));

    await waitFor(() => {
      expect(screen.getByText("Scraping service unavailable")).toBeDefined();
    });
  });

  it("should show action error when applyToJob fails", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(applyToJob).mockRejectedValue(new Error("BROWSER_USE_PROFILE_ID not set"));

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Apply/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Apply/ }));

    await waitFor(() => {
      expect(screen.getByText("BROWSER_USE_PROFILE_ID not set")).toBeDefined();
    });
  });

  it("should show generic error when fetchJobData throws a non-Error", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(fetchJobData).mockRejectedValue("string error");

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fetch Data/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Fetch Data/ }));

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch job data")).toBeDefined();
    });
  });

  it("should dismiss action error when close button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(fetchJobData).mockRejectedValue(new Error("Service down"));

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fetch Data/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Fetch Data/ }));

    await waitFor(() => {
      expect(screen.getByText("Service down")).toBeDefined();
    });

    // Close the alert
    const closeButton = screen.getByRole("button", { name: /close/i });
    await user.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText("Service down")).toBeNull();
    });
  });

  it("should show generic error when applyToJob throws a non-Error", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(applyToJob).mockRejectedValue("string error");

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Apply/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Apply/ }));

    await waitFor(() => {
      expect(screen.getByText("Failed to start application")).toBeDefined();
    });
  });
});
