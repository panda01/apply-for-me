import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResolutionTracePanel from "./ResolutionTracePanel";

vi.mock("../services/jobListingsApi", () => ({
  getResolutionLogs: vi.fn(),
}));

import { getResolutionLogs, type ResolutionLog } from "../services/jobListingsApi";

const matchedLog: ResolutionLog = {
  id: 10,
  job_listing_id: 1,
  outcome: "resolved_via_search",
  search_query: "Acme Software Engineer",
  brave_results: [
    { title: "Acme careers", url: "https://acme.com/jobs/1", description: "Build cool stuff" },
    { title: "Levels", url: "https://levels.fyi/acme", description: "Salary data" },
  ],
  inspected_candidates: [
    { url: "https://acme.com/jobs/1", scrapedTitle: "Software Engineer", matched: true, rejectionReason: "title matched and description overlap 60% >= 40%" },
  ],
  final_application_url: "https://acme.com/jobs/1",
  reason: null,
  created_date: "2026-05-16T13:00:00.000Z",
};

const notFoundLog: ResolutionLog = {
  id: 9,
  job_listing_id: 1,
  outcome: "not_found",
  search_query: "Acme Software Engineer",
  brave_results: [
    { title: "Unrelated", url: "https://elsewhere.com/x", description: "" },
  ],
  inspected_candidates: [
    { url: "https://elsewhere.com/x", scrapedTitle: "Other Role", matched: false, rejectionReason: "title mismatch (original=\"Software Engineer\", candidate=\"Other Role\")" },
  ],
  final_application_url: null,
  reason: "Inspected 1 candidate(s); none matched.",
  created_date: "2026-05-15T13:00:00.000Z",
};

const directLog: ResolutionLog = {
  id: 8,
  job_listing_id: 1,
  outcome: "direct",
  search_query: null,
  brave_results: [],
  inspected_candidates: [],
  final_application_url: "https://acme.com/careers/1",
  reason: null,
  created_date: "2026-05-14T13:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ResolutionTracePanel", () => {
  it("renders the panel collapsed with the latest outcome chip", async () => {
    vi.mocked(getResolutionLogs).mockResolvedValue([matchedLog]);

    render(<ResolutionTracePanel jobListingId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("trace-latest-outcome")).toBeDefined();
    });
    expect(screen.getByTestId("trace-latest-outcome").textContent).toBe("resolved_via_search");
  });

  it("expands to show the search query, brave results, and inspected candidates", async () => {
    const user = userEvent.setup();
    vi.mocked(getResolutionLogs).mockResolvedValue([matchedLog]);

    render(<ResolutionTracePanel jobListingId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("resolution-trace-summary")).toBeDefined();
    });

    await user.click(screen.getByTestId("resolution-trace-summary"));

    expect(screen.getByTestId("trace-search-query").textContent).toBe("Acme Software Engineer");
    // Both brave results render
    expect(screen.getByText("Acme careers")).toBeDefined();
    expect(screen.getByText("Levels")).toBeDefined();
    // Inspected candidate verdict + reason render
    const candidates = screen.getAllByTestId("trace-inspected-candidate");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].getAttribute("data-matched")).toBe("true");
  });

  it("renders the not_found reason and the rejection reason for each candidate", async () => {
    const user = userEvent.setup();
    vi.mocked(getResolutionLogs).mockResolvedValue([notFoundLog]);

    render(<ResolutionTracePanel jobListingId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("resolution-trace-summary")).toBeDefined();
    });

    await user.click(screen.getByTestId("resolution-trace-summary"));

    expect(screen.getByText(/Inspected 1 candidate/)).toBeDefined();
    expect(screen.getByText(/title mismatch/)).toBeDefined();
  });

  it("shows 'Search was skipped' messaging when search_query is null (direct path)", async () => {
    const user = userEvent.setup();
    vi.mocked(getResolutionLogs).mockResolvedValue([directLog]);

    render(<ResolutionTracePanel jobListingId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("resolution-trace-summary")).toBeDefined();
    });
    await user.click(screen.getByTestId("resolution-trace-summary"));

    expect(screen.getByText(/Search was skipped/)).toBeDefined();
  });

  it("shows earlier attempts beneath the latest one", async () => {
    const user = userEvent.setup();
    vi.mocked(getResolutionLogs).mockResolvedValue([matchedLog, notFoundLog]);

    render(<ResolutionTracePanel jobListingId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("resolution-trace-summary")).toBeDefined();
    });
    await user.click(screen.getByTestId("resolution-trace-summary"));

    const earlier = screen.getAllByTestId("trace-earlier-attempt");
    expect(earlier).toHaveLength(1);
  });

  it("shows an empty-state message when there are no logs yet", async () => {
    vi.mocked(getResolutionLogs).mockResolvedValue([]);

    const user = userEvent.setup();
    render(<ResolutionTracePanel jobListingId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("resolution-trace-summary")).toBeDefined();
    });
    await user.click(screen.getByTestId("resolution-trace-summary"));

    expect(screen.getByText(/No resolver attempts yet/)).toBeDefined();
  });

  it("shows an error Alert when the fetch fails with an Error", async () => {
    vi.mocked(getResolutionLogs).mockRejectedValue(new Error("API down"));

    const user = userEvent.setup();
    render(<ResolutionTracePanel jobListingId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("resolution-trace-summary")).toBeDefined();
    });
    await user.click(screen.getByTestId("resolution-trace-summary"));

    expect(screen.getByText("API down")).toBeDefined();
  });

  it("shows the generic fallback message when fetch rejects with a non-Error", async () => {
    vi.mocked(getResolutionLogs).mockRejectedValue("string error");

    const user = userEvent.setup();
    render(<ResolutionTracePanel jobListingId={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("resolution-trace-summary")).toBeDefined();
    });
    await user.click(screen.getByTestId("resolution-trace-summary"));

    expect(screen.getByText("Failed to load resolution logs")).toBeDefined();
  });

  it("re-fetches the logs when refreshToken changes", async () => {
    vi.mocked(getResolutionLogs).mockResolvedValue([matchedLog]);

    const { rerender } = render(<ResolutionTracePanel jobListingId={1} refreshToken={0} />);
    await waitFor(() => {
      expect(getResolutionLogs).toHaveBeenCalledTimes(1);
    });

    rerender(<ResolutionTracePanel jobListingId={1} refreshToken={1} />);
    await waitFor(() => {
      expect(getResolutionLogs).toHaveBeenCalledTimes(2);
    });
  });
});
