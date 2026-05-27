import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
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
}));

import JobsListPage from "./JobsListPage";
import { getJobListings, applyToJob } from "../services/jobListingsApi";

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
      company: null,
      location: null,
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
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Apply Target" }),
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
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Apply Target" }),
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
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Apply Target" }),
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
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Apply Target" }),
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
    vi.mocked(getJobListings).mockResolvedValue([
      makeListing({ id: 1, status: "init", title: "Apply Target" }),
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
