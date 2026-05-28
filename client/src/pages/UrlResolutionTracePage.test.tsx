import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import UrlResolutionTracePage from "./UrlResolutionTracePage";

vi.mock("../services/jobListingsApi", async () => {
  const actual = await vi.importActual<typeof import("../services/jobListingsApi")>("../services/jobListingsApi");
  return {
    ...actual,
    getJobListing: vi.fn(),
    getLiveUrlResolution: vi.fn(),
  };
});

import { getJobListing, getLiveUrlResolution, ResolutionPhase, StepStatus, ApplicationUrlResolutionOutcome, type LiveProgress, type JobListingResponse } from "../services/jobListingsApi";

const baseJobListing: JobListingResponse = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  application_url: null,
  description: "Build cool stuff",
  company: null,
  location: null,
  work_arrangement: null,
  salary: null,
  status: "missing_form_url",
  live_url: null,
  post_date: "2026-03-01T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
  resolution_in_progress: true,
  latest_resolution_log_id: 99,
};

/** Builds a LiveProgress with sensible defaults. */
function makeProgress(overrides: Partial<LiveProgress> = {}): LiveProgress {
  return {
    logId: 99,
    jobListingId: 1,
    isFinished: false,
    startedAt: "2026-05-18T00:00:00.000Z",
    finishedAt: null,
    steps: [],
    finalOutcome: null,
    finalApplicationUrl: null,
    reason: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getJobListing).mockResolvedValue(baseJobListing);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Renders the trace page mounted at /jobs/:id/url-resolution so useParams
 * picks up the id.
 *
 * @param {string} path - The route path to render (default: /jobs/1/url-resolution)
 */
function renderTracePage(path = "/jobs/1/url-resolution") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs/:id/url-resolution" element={<UrlResolutionTracePage />} />
        <Route path="/jobs/:id" element={<div data-testid="job-view-page">job view</div>} />
        <Route path="/jobs" element={<div data-testid="jobs-list-page">jobs list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("UrlResolutionTracePage", () => {
  it("renders the empty state when there are no resolution attempts", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(null);
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("trace-empty-state")).toBeDefined();
    });
  });

  it("renders the header with status chip, log id, and step count from the live snapshot", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: false,
      steps: [
        { stepIndex: 0, phase: ResolutionPhase.DirectCheck, status: StepStatus.Running, message: "starting", payload: {}, startedAt: "2026-05-18T00:00:00.000Z", endedAt: null, durationMs: null },
      ],
    }));

    renderTracePage();

    await waitFor(() => {
      expect(screen.getByTestId("trace-status-chip").textContent).toBe("running");
    });
    expect(screen.getByTestId("trace-log-id").textContent).toBe("99");
    expect(screen.getByTestId("trace-step-count").textContent).toBe("1");
    expect(screen.getByTestId("trace-in-progress-spinner")).toBeDefined();
  });

  it("renders a step row with phase, status, and the message", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      steps: [
        { stepIndex: 0, phase: ResolutionPhase.BraveSearch, status: StepStatus.Succeeded, message: "Got 9 results", payload: { resultCount: 9 }, startedAt: "2026-05-18T00:00:00.000Z", endedAt: "2026-05-18T00:00:02.000Z", durationMs: 2000 },
      ],
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.ResolvedViaSearch,
      finalApplicationUrl: "https://acme.com/jobs/1",
    }));

    renderTracePage();

    await waitFor(() => {
      expect(screen.getByTestId("step-row-0")).toBeDefined();
    });
    expect(screen.getByText(/Got 9 results/)).toBeDefined();
    // No spinner once terminal.
    expect(screen.queryByTestId("trace-in-progress-spinner")).toBeNull();
    expect(screen.getByTestId("trace-final-url").getAttribute("href")).toBe("https://acme.com/jobs/1");
  });

  it("expands an accordion row to reveal the raw JSON payload on click", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      steps: [
        { stepIndex: 0, phase: ResolutionPhase.BraveSearch, status: StepStatus.Succeeded, message: "ok", payload: { query: "Acme", resultCount: 1 }, startedAt: "2026-05-18T00:00:00.000Z", endedAt: "2026-05-18T00:00:02.000Z", durationMs: 2000 },
      ],
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.ResolvedViaSearch,
    }));
    const user = userEvent.setup();

    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("step-row-0")).toBeDefined();
    });

    await user.click(screen.getByTestId("step-row-0").querySelector("button")!);
    await waitFor(() => {
      const payload = screen.getByTestId("step-payload-0");
      expect(payload.textContent).toContain('"query"');
      expect(payload.textContent).toContain('"Acme"');
    });
  });

  it("stops polling once the snapshot's isFinished flips to true", async () => {
    vi.useFakeTimers();
    vi.mocked(getLiveUrlResolution)
      .mockResolvedValueOnce(makeProgress({ isFinished: false }))
      .mockResolvedValueOnce(makeProgress({ isFinished: true, finalOutcome: ApplicationUrlResolutionOutcome.ResolvedViaSearch }));

    await act(async () => {
      renderTracePage();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // First call (initial fetch).
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(1);

    // Tick once: second poll fires and lands the terminal snapshot.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(2);

    // After terminal, further ticks must NOT trigger more polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(2);
  });

  it("renders the reason banner on a not_found terminal state", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.NotFound,
      reason: "nothing matched",
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("trace-reason").textContent).toBe("nothing matched");
    });
  });

  it("renders an error alert and stops loading when getLiveUrlResolution throws", async () => {
    vi.mocked(getLiveUrlResolution).mockRejectedValue(new Error("upstream blew up"));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByText(/upstream blew up/)).toBeDefined();
    });
  });

  it("falls back to a generic message when getLiveUrlResolution rejects with a non-Error", async () => {
    vi.mocked(getLiveUrlResolution).mockRejectedValue("string failure");
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByText(/Failed to load live trace/)).toBeDefined();
    });
  });

  it("renders the elapsed duration with sub-second precision when finished quickly", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      startedAt: "2026-05-18T00:00:00.000Z",
      finishedAt: "2026-05-18T00:00:00.500Z",
      finalOutcome: ApplicationUrlResolutionOutcome.Direct,
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("trace-elapsed").textContent).toBe("500ms");
    });
  });

  it("renders the elapsed duration in seconds with one decimal when >1s", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      startedAt: "2026-05-18T00:00:00.000Z",
      finishedAt: "2026-05-18T00:00:02.500Z",
      finalOutcome: ApplicationUrlResolutionOutcome.Direct,
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("trace-elapsed").textContent).toBe("2.5s");
    });
  });

  it("renders the empty-steps message when finished with no steps", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.Direct,
      steps: [],
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByText(/No steps recorded yet/)).toBeDefined();
    });
  });

  it("flags '—' for elapsed when timestamps are unparseable", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      startedAt: "not a date",
      isFinished: true,
      finishedAt: "also not a date",
      finalOutcome: ApplicationUrlResolutionOutcome.Direct,
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("trace-elapsed").textContent).toBe("—");
    });
  });

  it("renders the failed-status chip variant for a not_found terminal", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.NotFound,
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("trace-status-chip").textContent).toBe("not_found");
    });
  });

  it("renders the crashed-status chip variant when finalOutcome is null", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      finalOutcome: null,
      reason: "crashed",
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("trace-status-chip").textContent).toBe("crashed");
    });
  });

  it("renders the resolved_via_redirect chip variant", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.ResolvedViaRedirect,
      finalApplicationUrl: "https://acme.com/apply",
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("trace-status-chip").textContent).toBe("resolved_via_redirect");
    });
  });

  it("renders the direct chip variant", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.Direct,
      finalApplicationUrl: "https://acme.com",
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("trace-status-chip").textContent).toBe("direct");
    });
  });

  it("renders the failed step status chip", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.NotFound,
      steps: [
        { stepIndex: 0, phase: ResolutionPhase.BraveSearch, status: StepStatus.Failed, message: "boom", payload: {}, startedAt: "x", endedAt: "x", durationMs: 0 },
        { stepIndex: 1, phase: ResolutionPhase.Finalize, status: StepStatus.Skipped, message: "skipped", payload: {}, startedAt: "x", endedAt: "x", durationMs: 0 },
      ],
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("step-row-0")).toBeDefined();
      expect(screen.getByTestId("step-row-1")).toBeDefined();
    });
  });

  it("treats an invalid :id param as an error", async () => {
    renderTracePage("/jobs/abc/url-resolution");
    await waitFor(() => {
      expect(screen.getByText(/Invalid job listing ID/)).toBeDefined();
    });
  });

  it("silently tolerates a failure to fetch the parent job listing", async () => {
    vi.mocked(getJobListing).mockRejectedValue(new Error("listing fetch failed"));
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.Direct,
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("trace-status-chip")).toBeDefined();
    });
    // The error from getJobListing did NOT bubble into the error banner.
    expect(screen.queryByText(/listing fetch failed/)).toBeNull();
  });

  it("renders a step row with no payload (empty object) without crashing", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(makeProgress({
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.Direct,
      steps: [
        { stepIndex: 0, phase: ResolutionPhase.DirectCheck, status: StepStatus.Succeeded, message: "done", payload: {}, startedAt: "2026-05-18T00:00:00.000Z", endedAt: "2026-05-18T00:00:00.000Z", durationMs: null },
      ],
    }));
    renderTracePage();
    await waitFor(() => {
      expect(screen.getByTestId("step-row-0")).toBeDefined();
    });
  });
});
