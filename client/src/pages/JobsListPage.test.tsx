import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

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
  fetchJobData: vi.fn(),
}));

import JobsListPage from "./JobsListPage";
import { getJobListings, applyToJob, fetchJobData, deleteJobListing } from "../services/jobListingsApi";
import { type WorkArrangement } from "../components/WorkArrangementChip";

/**
 * Builds a single JobListingResponse-shaped row with sensible defaults so individual
 * tests can override only the fields they care about.
 *
 * @param overrides Partial row used to override the defaults.
 * @returns A fully-populated listing row with overrides applied.
 */
function makeListing(overrides: Partial<{
  id: number;
  title: string;
  url: string;
  application_url: string | null;
  description: string;
  company: string | null;
  location: string | null;
  work_arrangement: WorkArrangement | null;
  salary: string | null;
  post_date: string;
  created_date: string;
  status: string;
  live_url: string | null;
  resolution_in_progress: boolean;
  latest_resolution_log_id: number | null;
}> = {}) {
  return {
    id: 1,
    title: "Acme Corp - Software Engineer",
    url: "https://linkedin.com/jobs/1",
    application_url: null,
    description: "Build cool stuff",
    company: "Acme Corp",
    location: "Remote",
    work_arrangement: null,
    salary: null,
    post_date: "2026-03-01T00:00:00.000Z",
    created_date: "2026-03-07T00:00:00.000Z",
    status: "init",
    live_url: null,
    resolution_in_progress: false,
    latest_resolution_log_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Helper to render JobsListPage inside a MemoryRouter.
 *
 * @returns The render result from `@testing-library/react`.
 */
function renderJobsListPage() {
  return render(
    <MemoryRouter>
      <JobsListPage />
    </MemoryRouter>
  );
}

/**
 * Helper to render JobsListPage inside a MemoryRouter seeded with an initial
 * URL entry — needed to verify the page reads `?q=` on first mount.
 *
 * @param initialUrl The URL (including search string) to seed the router with.
 * @returns The render result from `@testing-library/react`.
 */
function renderJobsListPageAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
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
        company: null,
        location: null,
        work_arrangement: null,
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

  it("renders a 'Remote' work-arrangement chip in the location cell for a remote listing", async () => {
    // Override the default "Remote" location to "United States" so the only
    // "Remote" text on screen is the WorkArrangementChip in the location cell.
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 1,
        title: "Remote Listing",
        location: "United States",
        work_arrangement: "remote",
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Remote Listing")).toBeDefined();
    });
    // The chip label "Remote" renders alongside the "United States" location.
    expect(screen.getByText("Remote")).toBeDefined();
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
      company: null,
      location: null,
      work_arrangement: null,
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

  it("clears the poll interval when listings transition from applying to settled", async () => {
    vi.useFakeTimers();
    const applyingListing = {
      id: 1,
      title: "",
      url: "https://linkedin.com/jobs/1",
      application_url: null,
      description: "",
      company: null,
      location: null,
      work_arrangement: null,
      salary: null,
      post_date: "2026-03-07T00:00:00.000Z",
      created_date: "2026-03-07T00:00:00.000Z",
      status: "applying",
      live_url: null,
      resolution_in_progress: false,
      latest_resolution_log_id: null,
    };
    const settledListing = { ...applyingListing, status: "applied", title: "All done" };

    // Initial fetch returns the applying listing, scheduling the poll.
    // Next two polls return the settled listing — the second poll re-fires the
    // effect with the settled state which exercises the clearInterval branch
    // on lines 89-91.
    vi.mocked(getJobListings)
      .mockResolvedValueOnce([applyingListing])
      .mockResolvedValueOnce([settledListing])
      .mockResolvedValue([settledListing]);

    await act(async () => {
      renderJobsListPage();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getJobListings).toHaveBeenCalledTimes(1);

    // Fire the 5s poll — second call returns the settled listing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getJobListings).toHaveBeenCalledTimes(2);

    // The effect re-fires with the settled listing; clearInterval should fire
    // and no further polls should happen even after 15 more seconds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
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
      company: null,
      location: null,
      work_arrangement: null,
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

  it("renders one filter tab per status that has at least one row", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init" }),
      makeListing({ id: 2, status: "applied" }),
      makeListing({ id: 3, status: "applied" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ready/ })).toBeDefined();
    });
    expect(screen.getByRole("button", { name: /Applied/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /All/ })).toBeDefined();
  });

  it("filters rows when a status tab is clicked", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Init Co" }),
      makeListing({ id: 2, status: "applied", title: "Applied Co" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Init Co")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /Applied/ }));

    expect(screen.queryByText("Init Co")).toBeNull();
    expect(screen.getByText("Applied Co")).toBeDefined();
  });

  it("renders the hostname as the title when the title field is empty", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, title: "", url: "https://greenhouse.io/job/123" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("greenhouse.io")).toBeDefined();
    });
  });

  it("renders a View button for non-init rows and navigates on click", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 42, status: "applied", title: "Already Applied" }),
    ]);

    render(
      <MemoryRouter initialEntries={["/jobs"]}>
        <Routes>
          <Route path="/jobs" element={<JobsListPage />} />
          <Route path="/jobs/:id" element={<div>Job View Page for 42</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Already Applied")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByText("Job View Page for 42")).toBeDefined();
  });

  it("navigates to the job view page when the row body is clicked", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 7, status: "applied", title: "Row Click Co" }),
    ]);

    render(
      <MemoryRouter initialEntries={["/jobs"]}>
        <Routes>
          <Route path="/jobs" element={<JobsListPage />} />
          <Route path="/jobs/:id" element={<div>Job View Page for 7</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Row Click Co")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Row Click Co"));
    expect(screen.getByText("Job View Page for 7")).toBeDefined();
  });

  it("toggles a single row's selection via its row checkbox", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, title: "Pick Me" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Pick Me")).toBeDefined();
    });
    const rowCheckbox = screen.getByRole("checkbox", { name: /Select Pick Me/ });
    fireEvent.click(rowCheckbox);
    expect(screen.getByText(/1 selected/)).toBeDefined();

    fireEvent.click(rowCheckbox);
    expect(screen.queryByText(/1 selected/)).toBeNull();
  });

  it("toggles all visible rows via the header checkbox", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, title: "Row A" }),
      makeListing({ id: 2, title: "Row B" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Row A")).toBeDefined();
    });
    const headerCheckbox = screen.getByRole("checkbox", { name: "Select all" });

    fireEvent.click(headerCheckbox);
    expect(screen.getByText(/2 selected/)).toBeDefined();

    fireEvent.click(headerCheckbox);
    expect(screen.queryByText(/2 selected/)).toBeNull();
  });

  it("clears the selection when the bulk bar Clear button is pressed", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, title: "Row A" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Row A")).toBeDefined();
    });
    const rowCheckbox = screen.getByRole("checkbox", { name: /Select Row A/ });
    fireEvent.click(rowCheckbox);
    expect(screen.getByText(/1 selected/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText(/1 selected/)).toBeNull();
  });

  it("shows an action alert when Apply is clicked without a stored profile", async () => {
    window.localStorage.removeItem("afm:selectedApplicationProfileId");
    // A resolved application_url renders the single ENABLED Apply button.
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 1,
        status: "init",
        title: "Apply Target",
        application_url: "https://boards.example.com/apply/1",
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Apply Target")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(
        screen.getByText("Pick an application profile on the Apply dashboard before applying.")
      ).toBeDefined();
    });
  });

  it("calls applyToJob and refreshes the list when a profile is stored", async () => {
    window.localStorage.setItem("afm:selectedApplicationProfileId", "5");
    vi.mocked(applyToJob).mockResolvedValue(makeListing({ id: 1, status: "applying" }));
    // A resolved application_url renders the single ENABLED Apply button.
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 1,
        status: "init",
        title: "Apply Target",
        application_url: "https://boards.example.com/apply/1",
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Apply Target")).toBeDefined();
    });
    expect(getJobListings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(applyToJob).toHaveBeenCalledWith(1, 5);
    });
    await waitFor(() => {
      expect(getJobListings).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces an Alert when applyToJob rejects", async () => {
    window.localStorage.setItem("afm:selectedApplicationProfileId", "5");
    vi.mocked(applyToJob).mockRejectedValue(new Error("boom"));
    // A resolved application_url renders the single ENABLED Apply button.
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 1,
        status: "init",
        title: "Apply Target",
        application_url: "https://boards.example.com/apply/1",
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Apply Target")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeDefined();
    });
  });

  it("shows generic error when applyToJob rejects with a non-Error", async () => {
    window.localStorage.setItem("afm:selectedApplicationProfileId", "5");
    vi.mocked(applyToJob).mockRejectedValue("nope");
    // A resolved application_url renders the single ENABLED Apply button.
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 1,
        status: "init",
        title: "Apply Target",
        application_url: "https://boards.example.com/apply/1",
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Apply Target")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to start application")).toBeDefined();
    });
  });

  it("renders an enabled Apply button and no Fetch Info button for an init row with an application_url", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 11,
        status: "init",
        title: "Resolved Init",
        application_url: "https://boards.example.com/apply/11",
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Resolved Init")).toBeDefined();
    });

    const applyButton = screen.getByTestId("apply-button-11") as HTMLButtonElement;
    expect(applyButton).toBeDefined();
    expect(applyButton.disabled).toBe(false);
    // No fetch-info affordance when the application_url is already resolved.
    expect(screen.queryByTestId("fetch-info-button-11")).toBeNull();
  });

  it("renders a Fetch Info button and a disabled Apply button for an init row without an application_url", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 12,
        status: "init",
        title: "Unresolved Init",
        application_url: null,
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Unresolved Init")).toBeDefined();
    });

    expect(screen.getByTestId("fetch-info-button-12")).toBeDefined();
    const applyButton = screen.getByTestId("apply-button-12") as HTMLButtonElement;
    expect(applyButton).toBeDefined();
    expect(applyButton.disabled).toBe(true);
  });

  it("exposes the fetch-info hint on the disabled Apply button via the Tooltip", async () => {
    const user = userEvent.setup();
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 13,
        status: "init",
        title: "Tooltip Init",
        application_url: null,
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Tooltip Init")).toBeDefined();
    });

    // The disabled Apply button is wrapped in a <span> so MUI's Tooltip can still
    // receive hover events. Hovering that wrapper surfaces the tooltip with the
    // exact hint copy.
    const disabledApply = screen.getByTestId("apply-button-13");
    const tooltipWrapper = disabledApply.parentElement as HTMLElement;
    await user.hover(tooltipWrapper);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe(
      "Fetch the job's info first to find the application form."
    );
  });

  it("calls fetchJobData with the row id and shows the Fetching state when Fetch Info is clicked", async () => {
    // Hold fetchJobData unresolved so the in-flight "Fetching…" state is observable.
    let resolveFetch: (() => void) | undefined;
    vi.mocked(fetchJobData).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve(makeListing({ id: 14, status: "init" }));
        })
    );
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 14,
        status: "init",
        title: "Fetch Me",
        application_url: null,
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Fetch Me")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("fetch-info-button-14"));

    await waitFor(() => {
      expect(fetchJobData).toHaveBeenCalledWith(14);
    });

    // While in flight the button shows the "Fetching…" label, a spinner, and is disabled.
    await waitFor(() => {
      const fetchButton = screen.getByTestId("fetch-info-button-14") as HTMLButtonElement;
      expect(fetchButton.textContent).toContain("Fetching…");
      expect(fetchButton.disabled).toBe(true);
    });
    expect(screen.getByRole("progressbar")).toBeDefined();

    // Resolve the fetch so the test exits cleanly without dangling timers.
    await act(async () => {
      resolveFetch?.();
    });
  });

  it("surfaces an Alert with the rejection message when fetchJobData fails", async () => {
    vi.mocked(fetchJobData).mockRejectedValue(new Error("scrape failed"));
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 15,
        status: "init",
        title: "Fetch Fail",
        application_url: null,
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Fetch Fail")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("fetch-info-button-15"));

    await waitFor(() => {
      expect(screen.getByText("scrape failed")).toBeDefined();
    });
  });

  it("does not navigate to the job view when the disabled Apply wrapper is clicked", async () => {
    // The disabled Apply button is wrapped in a <span> whose onClick stops
    // propagation so a click on it never bubbles to the row's navigate handler.
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 17,
        status: "init",
        title: "No Nav Init",
        application_url: null,
      }),
    ]);

    render(
      <MemoryRouter initialEntries={["/jobs"]}>
        <Routes>
          <Route path="/jobs" element={<JobsListPage />} />
          <Route path="/jobs/:id" element={<div>Job View Page for 17</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No Nav Init")).toBeDefined();
    });

    const tooltipWrapper = screen.getByTestId("apply-button-17").parentElement as HTMLElement;
    fireEvent.click(tooltipWrapper);

    // Still on the list — the stopPropagation kept the row's navigate from firing.
    expect(screen.queryByText("Job View Page for 17")).toBeNull();
    expect(screen.getByText("No Nav Init")).toBeDefined();
  });

  it("prunes the fetching spinner and enables Apply once the refetched row gains an application_url", async () => {
    // fetchJobData succeeds; the follow-up list refetch returns the same row now
    // carrying an application_url, which the prune effect uses to drop the id from
    // fetchingIds — stopping the spinner and switching the row to an enabled Apply.
    vi.mocked(fetchJobData).mockResolvedValue(
      makeListing({ id: 16, status: "init", application_url: "https://boards.example.com/apply/16" })
    );
    vi.mocked(getJobListings)
      .mockResolvedValueOnce([
        makeListing({ id: 16, status: "init", title: "Resolve Me", application_url: null }),
      ])
      .mockResolvedValue([
        makeListing({
          id: 16,
          status: "init",
          title: "Resolve Me",
          application_url: "https://boards.example.com/apply/16",
        }),
      ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Resolve Me")).toBeDefined();
    });
    // Initially unresolved: Fetch Info present, Apply disabled.
    expect(screen.getByTestId("fetch-info-button-16")).toBeDefined();
    expect((screen.getByTestId("apply-button-16") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("fetch-info-button-16"));

    // After the fetch resolves and the list refetches with a URL, the prune effect
    // removes the tracked id: the Fetch Info button disappears and Apply enables.
    await waitFor(() => {
      const applyButton = screen.getByTestId("apply-button-16") as HTMLButtonElement;
      expect(applyButton.disabled).toBe(false);
    });
    expect(screen.queryByTestId("fetch-info-button-16")).toBeNull();
  });

  it("renders a Fetch Info button on a missing_form_url row that lacks an application_url", async () => {
    // A row whose first resolution attempt failed (status missing_form_url, no
    // application_url) must still offer Fetch Info so the user can retry the
    // resolve+scrape flow — alongside the usual View button for non-init rows.
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 50,
        status: "missing_form_url",
        title: "No Form Found",
        application_url: null,
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("No Form Found")).toBeDefined();
    });

    expect(screen.getByTestId("fetch-info-button-50")).toBeDefined();
    expect(screen.getByRole("button", { name: "View" })).toBeDefined();
    // No Apply affordance on a non-init row.
    expect(screen.queryByTestId("apply-button-50")).toBeNull();
  });

  it("does not render a Fetch Info button on a missing_form_url row that already has an application_url", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 51,
        status: "missing_form_url",
        title: "Has A Url",
        application_url: "https://boards.example.com/apply/51",
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Has A Url")).toBeDefined();
    });

    expect(screen.queryByTestId("fetch-info-button-51")).toBeNull();
    expect(screen.getByRole("button", { name: "View" })).toBeDefined();
  });

  it("opens the confirm dialog and bulk-deletes every selected row, then refreshes and clears", async () => {
    vi.mocked(deleteJobListing).mockResolvedValue(makeListing({ id: 1 }));
    vi.mocked(getJobListings)
      .mockResolvedValueOnce([
        makeListing({ id: 1, status: "init", title: "Delete A" }),
        makeListing({ id: 2, status: "init", title: "Delete B" }),
      ])
      .mockResolvedValue([]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Delete A")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText(/2 selected/)).toBeDefined();

    // Clicking Delete in the bulk bar opens the confirmation dialog rather than
    // deleting immediately.
    fireEvent.click(screen.getByTestId("bulk-delete-button"));
    expect(screen.getByText("Delete selected jobs?")).toBeDefined();
    expect(deleteJobListing).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirm-bulk-delete-button"));

    await waitFor(() => {
      expect(deleteJobListing).toHaveBeenCalledTimes(2);
    });
    expect(deleteJobListing).toHaveBeenCalledWith(1);
    expect(deleteJobListing).toHaveBeenCalledWith(2);
    // The list is refetched (mount + post-delete) and the now-empty result
    // collapses the bulk bar.
    await waitFor(() => {
      expect(getJobListings).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText(/selected/)).toBeNull();
    });
  });

  it("closes the delete dialog without deleting when Cancel is pressed", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Keep Me" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Keep Me")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByTestId("bulk-delete-button"));
    expect(screen.getByText("Delete selected jobs?")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText("Delete selected jobs?")).toBeNull();
    });
    expect(deleteJobListing).not.toHaveBeenCalled();
  });

  it("surfaces an Alert when a bulk delete call rejects", async () => {
    vi.mocked(deleteJobListing).mockRejectedValue(new Error("delete boom"));
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Delete A" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Delete A")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByTestId("bulk-delete-button"));
    fireEvent.click(screen.getByTestId("confirm-bulk-delete-button"));

    await waitFor(() => {
      expect(screen.getByText("delete boom")).toBeDefined();
    });
  });

  it("shows singular copy in the delete dialog when exactly one row is selected", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Solo Row" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Solo Row")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /Select Solo Row/ }));
    fireEvent.click(screen.getByTestId("bulk-delete-button"));

    expect(
      screen.getByText("This permanently deletes 1 selected job. This action cannot be undone.")
    ).toBeDefined();
  });

  it("closes the delete dialog on Escape when no deletion is in flight", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Esc Row" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Esc Row")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByTestId("bulk-delete-button"));
    expect(screen.getByText("Delete selected jobs?")).toBeDefined();

    // Escape fires the Dialog's onClose; with no deletion running it closes.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Delete selected jobs?")).toBeNull();
    });
    expect(deleteJobListing).not.toHaveBeenCalled();
  });

  it("keeps the delete dialog open if a close is attempted while a deletion is in flight", async () => {
    // Hold deleteJobListing unresolved so isDeleting stays true and the onClose
    // guard is exercised in its "don't close" branch.
    let resolveDelete: (() => void) | undefined;
    vi.mocked(deleteJobListing).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = () => resolve(makeListing({ id: 1 }));
        })
    );
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Slow Delete" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Slow Delete")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByTestId("bulk-delete-button"));
    fireEvent.click(screen.getByTestId("confirm-bulk-delete-button"));

    // Deletion is in flight: the confirm button reports the deleting state.
    await waitFor(() => {
      expect((screen.getByTestId("confirm-bulk-delete-button") as HTMLButtonElement).disabled).toBe(true);
    });

    // Attempting to close (Escape) is ignored while deleting — dialog stays open.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByText("Delete selected jobs?")).toBeDefined();

    // Resolve so the component settles and the test exits cleanly.
    await act(async () => {
      resolveDelete?.();
    });
  });

  it("stops the fetch spinner on a missing_form_url retry once a new resolution attempt finishes", async () => {
    // The row carries a prior resolution log (id 5). After Fetch Info runs, the
    // refetched row reports a NEW log (id 6) with resolution finished — even
    // though status stays missing_form_url and no application_url appears — so
    // the prune effect drops the spinner via the log-id comparison.
    vi.mocked(fetchJobData).mockResolvedValue(makeListing({ id: 60 }));
    vi.mocked(getJobListings)
      .mockResolvedValueOnce([
        makeListing({
          id: 60,
          status: "missing_form_url",
          title: "Retry Me",
          application_url: null,
          latest_resolution_log_id: 5,
          resolution_in_progress: false,
        }),
      ])
      .mockResolvedValue([
        makeListing({
          id: 60,
          status: "missing_form_url",
          title: "Retry Me",
          application_url: null,
          latest_resolution_log_id: 6,
          resolution_in_progress: false,
        }),
      ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Retry Me")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("fetch-info-button-60"));

    await waitFor(() => {
      expect(fetchJobData).toHaveBeenCalledWith(60);
    });

    // Once the new attempt (log 6 ≠ baseline 5, not in progress) is observed,
    // the spinner clears: the button returns to its enabled idle "Fetch Info".
    await waitFor(() => {
      const fetchButton = screen.getByTestId("fetch-info-button-60") as HTMLButtonElement;
      expect(fetchButton.disabled).toBe(false);
      expect(fetchButton.textContent).toContain("Fetch Info");
    });
  });

  it("auto-applies to every selected init row in the bulk bar", async () => {
    window.localStorage.setItem("afm:selectedApplicationProfileId", "5");
    vi.mocked(applyToJob).mockResolvedValue(makeListing({ id: 1, status: "applying" }));
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Init A" }),
      makeListing({ id: 2, status: "init", title: "Init B" }),
      makeListing({ id: 3, status: "applied", title: "Already Applied" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Init A")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText(/3 selected/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Auto-apply \(2\)/ }));

    await waitFor(() => {
      expect(applyToJob).toHaveBeenCalledTimes(2);
    });
    expect(applyToJob).toHaveBeenCalledWith(1, 5);
    expect(applyToJob).toHaveBeenCalledWith(2, 5);
  });

  it("surfaces an Alert from the bulk bar when bulk applyToJob rejects", async () => {
    window.localStorage.setItem("afm:selectedApplicationProfileId", "5");
    vi.mocked(applyToJob).mockRejectedValue(new Error("bulk boom"));
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Init A" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Init A")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: /Auto-apply \(1\)/ }));

    await waitFor(() => {
      expect(screen.getByText("bulk boom")).toBeDefined();
    });
  });

  it("dismisses the list-level Alert when its close button is clicked", async () => {
    vi.mocked(getJobListings).mockRejectedValue(new Error("List fetch failed"));

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("List fetch failed")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => {
      expect(screen.queryByText("List fetch failed")).toBeNull();
    });
  });

  it("dismisses the action-level Alert when its close button is clicked", async () => {
    window.localStorage.removeItem("afm:selectedApplicationProfileId");
    // A resolved application_url renders the single ENABLED Apply button.
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({
        id: 1,
        status: "init",
        title: "Apply Target",
        application_url: "https://boards.example.com/apply/1",
      }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Apply Target")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(
        screen.getByText("Pick an application profile on the Apply dashboard before applying.")
      ).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => {
      expect(
        screen.queryByText("Pick an application profile on the Apply dashboard before applying.")
      ).toBeNull();
    });
  });

  it("navigates to the add-job page when the Add job header button is clicked", async () => {
    vi.mocked(getJobListings).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/jobs"]}>
        <Routes>
          <Route path="/jobs" element={<JobsListPage />} />
          <Route path="/" element={<div>Add Job Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add job" })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Add job" }));
    expect(screen.getByText("Add Job Page")).toBeDefined();
  });

  it("renders the raw URL string as the displayed title when extractHostname fails to parse", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, title: "", url: "not-a-real-url" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getAllByText("not-a-real-url").length).toBeGreaterThan(0);
    });
  });

  it("shows the bulk Alert when bulk apply is clicked without a stored profile", async () => {
    window.localStorage.removeItem("afm:selectedApplicationProfileId");
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Init A" }),
    ]);

    renderJobsListPage();

    await waitFor(() => {
      expect(screen.getByText("Init A")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: /Auto-apply \(1\)/ }));

    await waitFor(() => {
      expect(
        screen.getByText("Pick an application profile on the Apply dashboard before applying.")
      ).toBeDefined();
    });
  });

  it("fires getJobListings with the typed value after the 300ms debounce", async () => {
    vi.useFakeTimers();
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, title: "Anything" }),
    ]);

    await act(async () => {
      renderJobsListPage();
    });
    // Drain the mount-time fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getJobListings).toHaveBeenLastCalledWith("");
    expect(getJobListings).toHaveBeenCalledTimes(1);

    const searchInput = screen.getByRole("textbox", { name: "Search jobs" });
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "react" } });
    });

    // Before the debounce fires, no new call should have been issued.
    expect(getJobListings).toHaveBeenCalledTimes(1);

    // Advance past the 300ms debounce window — the debounced value updates,
    // fetchListings is re-memoised, and the mount effect re-runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(getJobListings).toHaveBeenLastCalledWith("react");
  });

  it("pre-fills the search input and fires a filtered fetch when the URL has ?q=", async () => {
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, title: "Anything" }),
    ]);

    renderJobsListPageAt("/jobs?q=foo");

    const searchInput = await screen.findByRole("textbox", { name: "Search jobs" });
    expect((searchInput as HTMLInputElement).value).toBe("foo");
    await waitFor(() => {
      expect(getJobListings).toHaveBeenCalledWith("foo");
    });
  });

  it("shows the active-query empty-state copy and a Clear search button when nothing matches", async () => {
    vi.useFakeTimers();
    vi.mocked(getJobListings).mockResolvedValue([]);

    await act(async () => {
      renderJobsListPageAt("/jobs?q=zzz");
    });
    // Drain the mount-time fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(
      screen.getByText('No jobs match "zzz" in this tab.')
    ).toBeDefined();

    const clearSearchButton = screen.getByRole("button", { name: "Clear search" });
    expect(clearSearchButton).toBeDefined();

    // Clicking Clear search empties the input synchronously; after the debounce
    // window passes, the next getJobListings call should be with "".
    await act(async () => {
      fireEvent.click(clearSearchButton);
    });

    const searchInput = screen.getByRole("textbox", { name: "Search jobs" });
    expect((searchInput as HTMLInputElement).value).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(getJobListings).toHaveBeenLastCalledWith("");
  });
});
