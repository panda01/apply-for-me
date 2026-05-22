import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Minimal in-memory localStorage stand-in. The configured jsdom environment
 * does not expose a real Storage implementation; the JobsListPage reads
 * `afm:selectedApplicationProfileId` during the apply flow, so we stub one
 * onto window BEFORE importing the page module.
 */
const inMemoryStorage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string): string | null => inMemoryStorage.get(key) ?? null,
    setItem: (key: string, value: string): void => { inMemoryStorage.set(key, value); },
    removeItem: (key: string): void => { inMemoryStorage.delete(key); },
    clear: (): void => { inMemoryStorage.clear(); },
    key: (index: number): string | null => Array.from(inMemoryStorage.keys())[index] ?? null,
    get length(): number { return inMemoryStorage.size; },
  },
});

vi.mock("../services/jobListingsApi", () => ({
  getJobListings: vi.fn(),
  deleteJobListing: vi.fn(),
  applyToJob: vi.fn(),
}));

import JobsListPage from "./JobsListPage";
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

    // The page heading was renamed from "Job Listings" to "Jobs" in the UI
    // rewrite, and is rendered as an <h1 class="page-title">.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Jobs", level: 1 })).toBeDefined();
    });
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
        application_url: null,
        description: "Build cool stuff",
        salary: null,
        post_date: "2026-03-01T00:00:00.000Z",
        created_date: "2026-03-07T00:00:00.000Z",
        status: "init",
        live_url: null,
        resolution_in_progress: false,
        latest_resolution_log_id: null,
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

    // Empty-state copy was updated to phrase it as a tab-filter outcome.
    await waitFor(() => {
      expect(screen.getByText("No jobs match this filter.")).toBeDefined();
    });
  });

  it("should poll every 5 seconds when a listing is applying", async () => {
    vi.useFakeTimers();

    const applyingListing = {
      id: 1,
      title: "",
      url: "https://linkedin.com/jobs/1",
      application_url: null,
      description: "",
      salary: null,
      post_date: "2026-03-07T00:00:00.000Z",
      created_date: "2026-03-07T00:00:00.000Z",
      status: "applying",
      live_url: null,
      resolution_in_progress: false,
      latest_resolution_log_id: null,
    };

    const completedListing = {
      ...applyingListing,
      title: "Acme Corp - Engineer",
      status: "applied",
    };

    vi.mocked(getJobListings)
      .mockResolvedValueOnce([applyingListing])
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

  it("should stop polling when no listings are applying", async () => {
    vi.useFakeTimers();

    const completedListing = {
      id: 1,
      title: "Acme Corp - Engineer",
      url: "https://linkedin.com/jobs/1",
      application_url: null,
      description: "Build stuff",
      salary: null,
      post_date: "2026-03-07T00:00:00.000Z",
      created_date: "2026-03-07T00:00:00.000Z",
      status: "applied",
      live_url: null,
      resolution_in_progress: false,
      latest_resolution_log_id: null,
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
