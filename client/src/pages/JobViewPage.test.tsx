import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import JobViewPage from "./JobViewPage";

/**
 * Minimal in-memory localStorage stand-in. The configured jsdom environment
 * does not expose a real Storage implementation, so we stub one onto window
 * before the component under test reads `afm:selectedApplicationProfileId`.
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

vi.mock("../services/jobListingsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/jobListingsApi")>();
  return {
    ...actual,
    getJobListing: vi.fn(),
    fetchJobData: vi.fn(),
    applyToJob: vi.fn(),
    resolveApplicationUrl: vi.fn(),
    getResolutionLogs: vi.fn(),
    getLiveUrlResolution: vi.fn().mockResolvedValue(null),
  };
});

import { getJobListing, fetchJobData, applyToJob, resolveApplicationUrl, getResolutionLogs, getLiveUrlResolution } from "../services/jobListingsApi";

const mockCompletedListing = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  application_url: "https://acme.com/jobs/123/apply",
  description: "Build cool stuff with great teams and cutting-edge technology.",
  salary: "$120k - $150k",
  status: "init",
  live_url: null,
  post_date: "2026-03-01T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
  resolution_in_progress: false,
  latest_resolution_log_id: null,
};

const mockEmptyListing = {
  id: 1,
  title: "",
  url: "https://linkedin.com/jobs/1",
  application_url: null,
  description: "",
  salary: null,
  status: "init",
  live_url: null,
  post_date: "2026-03-07T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
  resolution_in_progress: false,
  latest_resolution_log_id: null,
};

const mockApplyingListing = {
  id: 1,
  title: "",
  url: "https://linkedin.com/jobs/1",
  application_url: null,
  description: "",
  salary: null,
  status: "applying",
  live_url: null,
  post_date: "2026-03-07T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
  resolution_in_progress: false,
  latest_resolution_log_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default the trace panel's API call to an empty array so the panel doesn't
  // surface a spurious error in unrelated tests that don't care about the trace.
  vi.mocked(getResolutionLogs).mockResolvedValue([]);
  // Seed the localStorage key used by handleApply so Apply doesn't bail with
  // the "pick a profile" message in tests that exercise the apply flow.
  window.localStorage.setItem("afm:selectedApplicationProfileId", "7");
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

  it("should show Fetch Data and Apply buttons for init status when application_url is set", async () => {
    vi.mocked(getJobListing).mockResolvedValue(mockCompletedListing);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fetch Data/ })).toBeDefined();
      expect(screen.getByRole("button", { name: /Apply/ })).toBeDefined();
    });
  });

  it("should hide the Apply button when application_url is null even if status is init", async () => {
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fetch Data/ })).toBeDefined();
    });
    // Apply button should not be present — the apply gate requires application_url.
    expect(screen.queryByRole("button", { name: /^Apply$/ })).toBeNull();
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

  it("mounts the FetchProgressPanel when Fetch Data is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(fetchJobData).mockResolvedValue(mockEmptyListing);
    vi.mocked(getLiveUrlResolution).mockResolvedValue(null);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Fetch Data/ })).toBeDefined();
    });
    // No panel before the click.
    expect(screen.queryByTestId("fetch-progress-panel")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Fetch Data/ }));

    await waitFor(() => {
      expect(screen.getByTestId("fetch-progress-panel")).toBeDefined();
    });
  });

  it("mounts the FetchProgressPanel when the row loads with resolution_in_progress=true", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      ...mockEmptyListing,
      resolution_in_progress: true,
      latest_resolution_log_id: 5,
    });
    vi.mocked(getLiveUrlResolution).mockResolvedValue(null);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByTestId("fetch-progress-panel")).toBeDefined();
    });
  });

  it("should call applyToJob with the stored profile id when Apply button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockCompletedListing);
    vi.mocked(applyToJob).mockResolvedValue({ ...mockCompletedListing, status: "applying" });

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Apply$/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /^Apply$/ }));

    expect(applyToJob).toHaveBeenCalledWith(1, 7);
  });

  it("should surface a helpful message when no profile is selected", async () => {
    window.localStorage.removeItem("afm:selectedApplicationProfileId");
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockCompletedListing);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Apply$/ })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: /^Apply$/ }));

    await waitFor(() => {
      expect(screen.getByText(/Pick an application profile/)).toBeDefined();
    });
    expect(applyToJob).not.toHaveBeenCalled();
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
    vi.mocked(getJobListing).mockResolvedValue(mockCompletedListing);
    vi.mocked(applyToJob).mockRejectedValue(new Error("BROWSER_USE_PROFILE_ID not set"));

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Apply$/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /^Apply$/ }));

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
    vi.mocked(getJobListing).mockResolvedValue(mockCompletedListing);
    vi.mocked(applyToJob).mockRejectedValue("string error");

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Apply$/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /^Apply$/ }));

    await waitFor(() => {
      expect(screen.getByText("Failed to start application")).toBeDefined();
    });
  });
});

describe("JobViewPage — application_url resolution UI", () => {
  const mockMissingFormUrlListing = {
    id: 1,
    title: "Acme Corp - Software Engineer",
    url: "https://linkedin.com/jobs/1",
    application_url: null,
    description: "Build cool stuff",
    salary: null,
    status: "missing_form_url",
    live_url: null,
    post_date: "2026-03-01T00:00:00.000Z",
    created_date: "2026-03-07T00:00:00.000Z",
    resolution_in_progress: false,
    latest_resolution_log_id: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderPage(path = "/jobs/1") {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobViewPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("renders the application URL link and Open Application button when application_url is set", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      id: 1,
      title: "Acme Corp - Software Engineer",
      url: "https://linkedin.com/jobs/1",
      application_url: "https://acme.com/jobs/1/apply",
      description: "Build cool stuff",
      salary: null,
      status: "init",
      live_url: null,
      post_date: "2026-03-01T00:00:00.000Z",
      created_date: "2026-03-07T00:00:00.000Z",
      resolution_in_progress: false,
      latest_resolution_log_id: null,
    });

    renderPage();

    await waitFor(() => {
      const appLink = screen.getByTestId("application-url-link") as HTMLAnchorElement;
      expect(appLink.href).toBe("https://acme.com/jobs/1/apply");
      expect(screen.getByTestId("source-url-link").getAttribute("href")).toBe("https://linkedin.com/jobs/1");
      expect(screen.getByTestId("open-application-button")).toBeDefined();
    });
  });

  it("shows the missing-form-url alert and a Retry button when status is missing_form_url", async () => {
    vi.mocked(getJobListing).mockResolvedValue(mockMissingFormUrlListing);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("missing-form-url-alert")).toBeDefined();
      expect(screen.getByTestId("retry-resolve-button")).toBeDefined();
    });
    // Apply button must NOT appear when the row is in missing_form_url status.
    expect(screen.queryByRole("button", { name: /^Apply$/ })).toBeNull();
  });

  it("calls resolveApplicationUrl when the Retry button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockMissingFormUrlListing);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(mockMissingFormUrlListing);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("retry-resolve-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("retry-resolve-button"));

    expect(resolveApplicationUrl).toHaveBeenCalledWith(1);
  });

  it("shows the resolver error message when retry fails", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockMissingFormUrlListing);
    vi.mocked(resolveApplicationUrl).mockRejectedValue(new Error("Container offline"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("retry-resolve-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("retry-resolve-button"));

    await waitFor(() => {
      expect(screen.getByText("Container offline")).toBeDefined();
    });
  });

  it("shows a generic error when the retry rejects with a non-Error", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockMissingFormUrlListing);
    vi.mocked(resolveApplicationUrl).mockRejectedValue("string-rejection");

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("retry-resolve-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("retry-resolve-button"));

    await waitFor(() => {
      expect(screen.getByText("Failed to retry application URL resolution")).toBeDefined();
    });
  });

  it("does nothing when the retry button is clicked with an invalid id", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockMissingFormUrlListing);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(mockMissingFormUrlListing);

    render(
      <MemoryRouter initialEntries={["/jobs/abc"]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobViewPage />} />
        </Routes>
      </MemoryRouter>
    );

    // The invalid-id branch produces an error message; the retry button isn't rendered.
    await waitFor(() => {
      expect(screen.getByText(/Invalid job listing ID/)).toBeDefined();
    });
    expect(user).toBeDefined(); // satisfies vitest unused-var rules
  });

  it("replaces the Retry button with a 'View Resolution Progress' link when resolution_in_progress is true", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      ...mockMissingFormUrlListing,
      resolution_in_progress: true,
      latest_resolution_log_id: 7,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("view-resolution-progress-link")).toBeDefined();
    });
    expect(screen.queryByTestId("retry-resolve-button")).toBeNull();
    expect(screen.getByTestId("view-resolution-progress-link").getAttribute("href")).toBe("/jobs/1/url-resolution");
  });

  it("navigates to the trace page after clicking Retry", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockMissingFormUrlListing);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(mockMissingFormUrlListing);

    render(
      <MemoryRouter initialEntries={["/jobs/1"]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobViewPage />} />
          <Route path="/jobs/:id/url-resolution" element={<div data-testid="trace-page">trace</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("retry-resolve-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("retry-resolve-button"));

    await waitFor(() => {
      expect(screen.getByTestId("trace-page")).toBeDefined();
    });
  });

  it("renders a 'View Resolver Trace' link when there's a past attempt but no in-progress one", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      ...mockMissingFormUrlListing,
      status: "init",
      application_url: "https://acme.com/jobs/1/apply",
      resolution_in_progress: false,
      latest_resolution_log_id: 3,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("view-resolution-trace-link")).toBeDefined();
    });
    expect(screen.queryByTestId("view-resolution-progress-link")).toBeNull();
    expect(screen.getByTestId("view-resolution-trace-link").getAttribute("href")).toBe("/jobs/1/url-resolution");
  });
});
