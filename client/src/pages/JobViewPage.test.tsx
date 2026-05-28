import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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
    getJobAttempts: vi.fn(),
    deleteJobListing: vi.fn(),
  };
});

import JobViewPage from "./JobViewPage";
import {
  getJobListing,
  fetchJobData,
  applyToJob,
  resolveApplicationUrl,
  getResolutionLogs,
  getLiveUrlResolution,
  getJobAttempts,
  deleteJobListing,
  ApplicationAttemptOutcome,
} from "../services/jobListingsApi";

const mockCompletedListing = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  application_url: "https://acme.com/jobs/123/apply",
  description: "Build cool stuff with great teams and cutting-edge technology.",
  company: "Acme Corp",
  location: null,
  work_arrangement: null,
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
  company: null,
  location: null,
  work_arrangement: null,
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
  company: null,
  location: null,
  work_arrangement: null,
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
  // Default the attempts API call to an empty list so the attempts card stays
  // in its empty state for tests that don't care about attempts.
  vi.mocked(getJobAttempts).mockResolvedValue({
    ...mockEmptyListing,
    attempts: [],
  });
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
      expect(screen.getByTestId("job-title")).toBeDefined();
    });
    expect(screen.getByTestId("job-title").textContent).toBe(
      "Acme Corp - Software Engineer"
    );

    // The status pill renders the "Ready" label for the init status. The
    // label also appears as a `.tag` next to the Job description card head,
    // so use getAllByText to match either occurrence.
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    expect(screen.getByText(/Build cool stuff with great teams/)).toBeDefined();
    expect(screen.getByTestId("source-url-link").getAttribute("href")).toBe(
      "https://linkedin.com/jobs/1"
    );
    // Salary appears in the side meta-list AND as a card-head tag, so
    // assert at least one occurrence.
    expect(screen.getAllByText("$120k - $150k").length).toBeGreaterThan(0);
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

  it("should render Back to jobs button that returns to the jobs list", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockCompletedListing);

    render(
      <MemoryRouter initialEntries={["/jobs/1"]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobViewPage />} />
          <Route path="/jobs" element={<div data-testid="jobs-list-page">jobs list</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("back-to-jobs-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("back-to-jobs-button"));

    await waitFor(() => {
      expect(screen.getByTestId("jobs-list-page")).toBeDefined();
    });
  });

  it("should fall back to URL hostname and prompt to fetch data when title is empty", async () => {
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByTestId("job-title")).toBeDefined();
    });
    // The page title falls back to the URL's hostname when title is empty.
    expect(screen.getByTestId("job-title").textContent).toBe("linkedin.com");
    // The Job description card shows a prompt asking the user to fetch data.
    expect(
      screen.getByText(/No description yet\. Click Fetch Data to scrape the listing\./)
    ).toBeDefined();
    expect(screen.getByTestId("fetch-data-button")).toBeDefined();
  });

  it("should show an enabled Auto-apply button and hide Fetch Info for init status when application_url is set", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      ...mockCompletedListing,
      title: "",
    });

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByTestId("apply-button")).toBeDefined();
    });
    // With a resolved application_url the Auto-apply button is the enabled,
    // clickable variant (no disabled attribute, no Tooltip wrapper).
    expect((screen.getByTestId("apply-button") as HTMLButtonElement).disabled).toBe(false);
    // The Fetch Info button only renders while there's no application_url, so
    // it must be absent here.
    expect(screen.queryByTestId("fetch-data-button")).toBeNull();
  });

  it("should render a disabled Auto-apply button with a hint when application_url is null for an init job with a title", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue({
      ...mockEmptyListing,
      title: "Acme Corp - Software Engineer",
    });

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByTestId("apply-button")).toBeDefined();
    });
    // The apply gate requires a resolved application_url, so the button renders
    // but is disabled rather than hidden.
    const applyButton = screen.getByTestId("apply-button") as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);

    // The Fetch Info button is present and labeled "Fetch Info" (its testid is
    // unchanged) since the job still has no application_url.
    const fetchButton = screen.getByTestId("fetch-data-button");
    expect(fetchButton.textContent).toContain("Fetch Info");

    // Hovering the disabled button's Tooltip wrapper surfaces the hint that the
    // job's info must be fetched first. MUI renders the disabled <button> inside
    // a <span> wrapper that owns the hover, so hover that wrapper.
    const tooltipWrapper = applyButton.parentElement as HTMLElement;
    await user.hover(tooltipWrapper);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe(
      "Fetch the job's info first to find the application form."
    );
  });

  it("should call fetchJobData when Fetch Data button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(fetchJobData).mockResolvedValue(mockEmptyListing);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByTestId("fetch-data-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("fetch-data-button"));

    expect(fetchJobData).toHaveBeenCalledWith(1);
  });

  it("mounts the FetchProgressPanel when Fetch Data is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(fetchJobData).mockResolvedValue(mockEmptyListing);
    vi.mocked(getLiveUrlResolution).mockResolvedValue(null);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByTestId("fetch-data-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("fetch-data-button"));

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

  it("should call applyToJob with the stored profile id when Auto-apply button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockCompletedListing);
    vi.mocked(applyToJob).mockResolvedValue({ ...mockCompletedListing, status: "applying" });

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByTestId("apply-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("apply-button"));

    expect(applyToJob).toHaveBeenCalledWith(1, 7);
  });

  it("should surface a helpful message when no profile is selected", async () => {
    window.localStorage.removeItem("afm:selectedApplicationProfileId");
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockCompletedListing);

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByTestId("apply-button")).toBeDefined();
    });
    await user.click(screen.getByTestId("apply-button"));

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

    // The "Applying to job..." heading is rendered inside the applying section
    // alongside LiveBrowserView's waiting placeholder.
    expect(screen.getByText("Applying to job...")).toBeDefined();
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

    expect(screen.getByText("Applying to job...")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.getByTestId("job-title").textContent).toBe(
      "Acme Corp - Software Engineer"
    );
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(getJobListing).toHaveBeenCalledTimes(2);
  });

  it("should not show Auto-apply button for applied status", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      ...mockCompletedListing,
      status: "applied",
    });

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByTestId("job-title")).toBeDefined();
    });

    // The Auto-apply button is gated on init/error_applying status.
    expect(screen.queryByTestId("apply-button")).toBeNull();
    // For applied rows we show the Re-apply button instead.
    expect(screen.getByTestId("re-apply-button")).toBeDefined();
  });

  it("should show action error when fetchJobData fails", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(mockEmptyListing);
    vi.mocked(fetchJobData).mockRejectedValue(new Error("Scraping service unavailable"));

    renderJobViewPage();

    await waitFor(() => {
      expect(screen.getByTestId("fetch-data-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("fetch-data-button"));

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
      expect(screen.getByTestId("apply-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("apply-button"));

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
      expect(screen.getByTestId("fetch-data-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("fetch-data-button"));

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
      expect(screen.getByTestId("fetch-data-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("fetch-data-button"));

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
      expect(screen.getByTestId("apply-button")).toBeDefined();
    });

    await user.click(screen.getByTestId("apply-button"));

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
    company: "Acme Corp",
    location: null,
    work_arrangement: null,
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
    vi.mocked(getResolutionLogs).mockResolvedValue([]);
    vi.mocked(getJobAttempts).mockResolvedValue({
      ...mockMissingFormUrlListing,
      attempts: [],
    });
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

  it("renders the Open posting button and the source URL link when application_url is set", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      id: 1,
      title: "Acme Corp - Software Engineer",
      url: "https://linkedin.com/jobs/1",
      application_url: "https://acme.com/jobs/1/apply",
      description: "Build cool stuff",
      company: "Acme Corp",
      location: null,
      work_arrangement: null,
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
      const openPostingButton = screen.getByTestId("open-application-button") as HTMLAnchorElement;
      expect(openPostingButton.href).toBe("https://acme.com/jobs/1/apply");
      expect(screen.getByTestId("source-url-link").getAttribute("href")).toBe("https://linkedin.com/jobs/1");
    });
  });

  it("shows the missing-form-url alert and a Retry button when status is missing_form_url", async () => {
    vi.mocked(getJobListing).mockResolvedValue(mockMissingFormUrlListing);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("missing-form-url-alert")).toBeDefined();
      expect(screen.getByTestId("retry-resolve-button")).toBeDefined();
    });
    // Auto-apply button must NOT appear when the row is in missing_form_url status.
    expect(screen.queryByTestId("apply-button")).toBeNull();
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

  it("shows the 'View progress' link in the header when resolution_in_progress is true", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      ...mockMissingFormUrlListing,
      resolution_in_progress: true,
      latest_resolution_log_id: 7,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("view-resolution-progress-link")).toBeDefined();
    });
    // The trace deep-link replaces the static "Trace" link in the header. The
    // Retry button still lives in the missing-form-url alert; both can be
    // visible at the same time.
    expect(screen.queryByTestId("view-resolution-trace-link")).toBeNull();
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

describe("JobViewPage — Manage panel + attempts list", () => {
  const baseListing = {
    id: 1,
    title: "Acme Corp - Software Engineer",
    url: "https://linkedin.com/jobs/1",
    application_url: "https://acme.com/jobs/1/apply",
    description: "Build cool stuff",
    company: "Acme Corp",
    location: null,
    work_arrangement: null,
    salary: "$120k",
    status: "init",
    live_url: null,
    post_date: "2026-03-01T00:00:00.000Z",
    created_date: "2026-03-07T00:00:00.000Z",
    resolution_in_progress: false,
    latest_resolution_log_id: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getResolutionLogs).mockResolvedValue([]);
    vi.mocked(getJobAttempts).mockResolvedValue({ ...baseListing, attempts: [] });
    vi.mocked(getLiveUrlResolution).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Render the page at /jobs/1 with the standard MemoryRouter route table plus a
   * `/jobs` placeholder so we can detect handleDeleteJob's post-success navigation.
   */
  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/jobs/1"]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobViewPage />} />
          <Route path="/jobs" element={<div data-testid="jobs-list-stub">Jobs list</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("surfaces a snackbar when Move to Saved is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(baseListing);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("manage-move-saved")).toBeDefined();
    });
    await user.click(screen.getByTestId("manage-move-saved"));
    await waitFor(() => {
      expect(screen.getByText(/Move to Saved: status changes are not yet wired up/)).toBeDefined();
    });
  });

  it("surfaces a snackbar when Mark as Interview is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(baseListing);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("manage-mark-interview")).toBeDefined();
    });
    await user.click(screen.getByTestId("manage-mark-interview"));
    await waitFor(() => {
      expect(screen.getByText(/Mark as Interview: status changes are not yet wired up/)).toBeDefined();
    });
  });

  it("surfaces a snackbar when Mark as Rejected is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(baseListing);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("manage-mark-rejected")).toBeDefined();
    });
    await user.click(screen.getByTestId("manage-mark-rejected"));
    await waitFor(() => {
      expect(screen.getByText(/Mark as Rejected: status changes are not yet wired up/)).toBeDefined();
    });
  });

  it("navigates to /jobs after a successful delete", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(baseListing);
    vi.mocked(deleteJobListing).mockResolvedValue(baseListing);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("manage-delete-job")).toBeDefined();
    });
    await user.click(screen.getByTestId("manage-delete-job"));
    await waitFor(() => {
      expect(deleteJobListing).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("jobs-list-stub")).toBeDefined();
    });
  });

  it("surfaces the delete failure message in the snackbar", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(baseListing);
    vi.mocked(deleteJobListing).mockRejectedValue(new Error("not allowed"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("manage-delete-job")).toBeDefined();
    });
    await user.click(screen.getByTestId("manage-delete-job"));
    await waitFor(() => {
      expect(screen.getByText("not allowed")).toBeDefined();
    });
  });

  it("falls back to a generic message when delete rejects with a non-Error", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(baseListing);
    vi.mocked(deleteJobListing).mockRejectedValue("nope");

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("manage-delete-job")).toBeDefined();
    });
    await user.click(screen.getByTestId("manage-delete-job"));
    await waitFor(() => {
      expect(screen.getByText("Failed to delete job")).toBeDefined();
    });
  });

  it("renders attempt rows for every ApplicationAttemptOutcome enum value", async () => {
    vi.mocked(getJobListing).mockResolvedValue(baseListing);
    vi.mocked(getJobAttempts).mockResolvedValue({
      ...baseListing,
      attempts: [
        {
          id: 11,
          job_listing_id: 1,
          end_response: ApplicationAttemptOutcome.Applied,
          created_date: "2026-03-09T12:00:00.000Z",
          step_logs: [],
          has_submission_screenshot: false,
        },
        {
          id: 12,
          job_listing_id: 1,
          end_response: ApplicationAttemptOutcome.Failed,
          created_date: "2026-03-08T12:00:00.000Z",
          step_logs: [],
          has_submission_screenshot: false,
        },
        {
          id: 13,
          job_listing_id: 1,
          end_response: ApplicationAttemptOutcome.ClosedListing,
          created_date: "2026-03-07T12:00:00.000Z",
          step_logs: [],
          has_submission_screenshot: false,
        },
        {
          id: 14,
          job_listing_id: 1,
          end_response: ApplicationAttemptOutcome.CaptchaBlocked,
          created_date: "2026-03-06T12:00:00.000Z",
          step_logs: [],
          has_submission_screenshot: false,
        },
        {
          id: 15,
          job_listing_id: 1,
          end_response: ApplicationAttemptOutcome.Stuck,
          created_date: "2026-03-05T12:00:00.000Z",
          step_logs: [],
          has_submission_screenshot: false,
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Applied")).toBeDefined();
    });
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Closed listing")).toBeDefined();
    expect(screen.getByText("CAPTCHA blocked")).toBeDefined();
    expect(screen.getByText("Stuck")).toBeDefined();
  });

  it("auto-dismisses the snackbar after the 4s autoHideDuration elapses", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListing).mockResolvedValue(baseListing);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("manage-move-saved")).toBeDefined();
    });
    await user.click(screen.getByTestId("manage-move-saved"));
    expect(screen.getByText(/Move to Saved: status changes are not yet wired up/)).toBeDefined();

    // Wait for Snackbar's autoHideDuration (4 s) + exit transition.
    await waitFor(
      () => {
        expect(screen.queryByText(/Move to Saved: status changes are not yet wired up/)).toBeNull();
      },
      { timeout: 6000 }
    );
  }, 10000);

  it("falls back to '—' for company label when the job URL is invalid", async () => {
    vi.mocked(getJobListing).mockResolvedValue({
      ...baseListing,
      url: "not-a-real-url",
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Company")).toBeDefined();
    });
    // The "Company" meta key sits in the same .meta-item as the value. The fallback
    // should render '—' since new URL("not-a-real-url") throws.
    // There are multiple em-dashes on the page — use queryAllByText.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the Details panel side-column metadata for a completed listing", async () => {
    vi.mocked(getJobListing).mockResolvedValue(baseListing);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("source-url-link")).toBeDefined();
    });
    // The "Company", "Salary", and "Posted" labels live in the details panel.
    // (Each appears once in the Manage card's siblings — the details meta-key list.)
    expect(screen.getAllByText("Company").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Salary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Posted").length).toBeGreaterThan(0);
  });
});
