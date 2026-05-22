import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getJobListings, getJobListing, createJobListing, fetchJobData, deleteJobListing,
  bulkCreateJobListings, applyToJob, startBatchApply, getBatchApplyStatus,
  resolveApplicationUrl, getResolutionLogs, getLiveUrlResolution,
} from "./jobListingsApi";

const mockListing = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  application_url: null,
  description: "Build cool stuff",
  salary: null,
  status: "init",
  live_url: null,
  post_date: "2026-03-01T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
  resolution_in_progress: false,
  latest_resolution_log_id: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("getJobListings", () => {
  it("should return job listings on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([mockListing]),
    }));

    const result = await getJobListings();

    expect(result).toEqual([mockListing]);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings");
  });

  it("should throw on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
    }));

    await expect(getJobListings()).rejects.toThrow("Failed to fetch job listings");
  });
});

describe("getJobListing", () => {
  it("should return a single job listing on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockListing),
    }));

    const result = await getJobListing(1);

    expect(result).toEqual(mockListing);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/1");
  });

  it("should throw with API error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Job listing not found" }),
    }));

    await expect(getJobListing(999)).rejects.toThrow("Job listing not found");
  });

  it("should throw generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(getJobListing(999)).rejects.toThrow("Failed to fetch job listing");
  });
});

describe("createJobListing", () => {
  it("should create a job listing and return it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockListing),
    }));

    const result = await createJobListing("https://linkedin.com/jobs/1");

    expect(result).toEqual(mockListing);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://linkedin.com/jobs/1" }),
    });
  });

  it("should throw with API error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Missing required field: url" }),
    }));

    await expect(createJobListing("")).rejects.toThrow("Missing required field: url");
  });

  it("should throw generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(createJobListing("bad")).rejects.toThrow("Failed to create job listing");
  });
});

describe("fetchJobData", () => {
  it("should trigger fetch and return the listing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockListing),
    }));

    const result = await fetchJobData(1);

    expect(result).toEqual(mockListing);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/1/fetch", { method: "POST" });
  });

  it("should throw with API error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Job listing not found" }),
    }));

    await expect(fetchJobData(999)).rejects.toThrow("Job listing not found");
  });

  it("should throw generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(fetchJobData(1)).rejects.toThrow("Failed to fetch job data");
  });
});

describe("deleteJobListing", () => {
  it("should delete a job listing and return it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockListing),
    }));

    const result = await deleteJobListing(1);

    expect(result).toEqual(mockListing);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/1", { method: "DELETE" });
  });

  it("should throw with API error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Job listing not found" }),
    }));

    await expect(deleteJobListing(999)).rejects.toThrow("Job listing not found");
  });

  it("should throw generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(deleteJobListing(999)).rejects.toThrow("Failed to delete job listing");
  });
});

describe("bulkCreateJobListings", () => {
  it("should create multiple listings and return the result", async () => {
    const bulkResult = { count: 2, listings: [mockListing, { ...mockListing, id: 2 }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(bulkResult),
    }));

    const result = await bulkCreateJobListings(["https://example.com/1", "https://example.com/2"]);

    expect(result.count).toBe(2);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: ["https://example.com/1", "https://example.com/2"] }),
    });
  });

  it("should throw on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Invalid URLs found" }),
    }));

    await expect(bulkCreateJobListings(["bad"])).rejects.toThrow("Invalid URLs found");
  });

  it("should throw generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(bulkCreateJobListings([])).rejects.toThrow("Failed to bulk create job listings");
  });
});

describe("applyToJob", () => {
  it("should start an application and return the listing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...mockListing, status: "applying" }),
    }));

    const result = await applyToJob(1, 7);

    expect(result.status).toBe("applying");
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/1/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationProfileId: 7 }),
    });
  });

  it("should throw on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Job listing not found" }),
    }));

    await expect(applyToJob(999, 7)).rejects.toThrow("Job listing not found");
  });

  it("should throw generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(applyToJob(1, 7)).rejects.toThrow("Failed to start job application");
  });
});

describe("startBatchApply", () => {
  it("should start batch and return confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: "Batch started", totalJobs: 5 }),
    }));

    const result = await startBatchApply(7);

    expect(result.totalJobs).toBe(5);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/apply-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationProfileId: 7 }),
    });
  });

  it("should throw on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "No job listings" }),
    }));

    await expect(startBatchApply(7)).rejects.toThrow("No job listings");
  });

  it("should throw generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(startBatchApply(7)).rejects.toThrow("Failed to start batch application");
  });
});

describe("getBatchApplyStatus", () => {
  it("should return batch status", async () => {
    const mockStatus = {
      isRunning: true,
      currentJobId: 1,
      completed: [2, 3],
      errors: [],
      totalJobs: 5,
      remaining: 2,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStatus),
    }));

    const result = await getBatchApplyStatus();

    expect(result.isRunning).toBe(true);
    expect(result.remaining).toBe(2);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/apply-batch/status");
  });

  it("should throw on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
    }));

    await expect(getBatchApplyStatus()).rejects.toThrow("Failed to fetch batch apply status");
  });
});

describe("resolveApplicationUrl", () => {
  it("POSTs to the resolve endpoint and returns the parsed body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockListing),
    }));

    const result = await resolveApplicationUrl(42);

    expect(result).toEqual(mockListing);
    expect(fetch).toHaveBeenCalledWith(
      "/api/job-listings/42/resolve-application-url",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws the server error string when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Container offline" }),
    }));

    await expect(resolveApplicationUrl(1)).rejects.toThrow("Container offline");
  });

  it("throws the default message when the response body has no error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(resolveApplicationUrl(1)).rejects.toThrow("Failed to retry application URL resolution");
  });
});

describe("getResolutionLogs", () => {
  const mockLog = {
    id: 1,
    job_listing_id: 1,
    outcome: "direct",
    search_query: null,
    brave_results: [],
    inspected_candidates: [],
    final_application_url: "https://acme.com/careers/1",
    reason: null,
    created_date: "2026-05-16T13:00:00.000Z",
  };

  it("fetches the resolution-logs endpoint and returns the array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([mockLog]),
    }));

    const result = await getResolutionLogs(42);

    expect(result).toEqual([mockLog]);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/42/resolution-logs");
  });

  it("throws on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));

    await expect(getResolutionLogs(1)).rejects.toThrow("Failed to fetch resolution logs");
  });
});


describe("getLiveUrlResolution", () => {
  const mockLiveProgress = {
    logId: 1,
    jobListingId: 42,
    isFinished: false,
    startedAt: "2026-05-18T00:00:00.000Z",
    finishedAt: null,
    steps: [],
    finalOutcome: null,
    finalApplicationUrl: null,
    reason: null,
  };

  it("fetches the live endpoint and returns the snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockLiveProgress),
    }));

    const result = await getLiveUrlResolution(42);

    expect(result).toEqual(mockLiveProgress);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/42/url-resolution/live");
  });

  it("returns null when the server reports no resolution attempts (404 body)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "No resolution attempts found for this job" }),
    }));

    const result = await getLiveUrlResolution(42);

    expect(result).toBeNull();
  });

  it("rethrows non-404 errors with their messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Internal server error" }),
    }));

    await expect(getLiveUrlResolution(42)).rejects.toThrow("Internal server error");
  });

  it("rethrows when fetch itself rejects with a non-Error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("nope"));

    await expect(getLiveUrlResolution(42)).rejects.toBe("nope");
  });
});

describe("getJobAttempts", () => {
  it("calls the per-job attempts endpoint and returns the typed body", async () => {
    const { getJobAttempts } = await import("./jobListingsApi");
    const body = { ...mockListing, attempts: [{ id: 1, job_listing_id: 1, end_response: "applied", has_submission_screenshot: true, step_logs: [], created_date: "2026-05-21T00:00:00.000Z" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));

    const result = await getJobAttempts(1);

    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].end_response).toBe("applied");
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/1/attempts");
  });

  it("throws on a non-ok response", async () => {
    const { getJobAttempts } = await import("./jobListingsApi");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Job listing not found" }) }));

    await expect(getJobAttempts(999)).rejects.toThrow("Job listing not found");
  });
});

describe("getApplicationAttempt", () => {
  it("calls the per-attempt endpoint with both ids", async () => {
    const { getApplicationAttempt } = await import("./jobListingsApi");
    const body = {
      id: 10,
      job_listing_id: 1,
      end_response: "applied",
      has_submission_screenshot: true,
      step_logs: [],
      created_date: "2026-05-21T00:00:00.000Z",
      job_listing: { id: 1, title: "Acme - Engineer", url: "https://x" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }));

    const result = await getApplicationAttempt(1, 10);

    expect(result.id).toBe(10);
    expect(result.job_listing.title).toBe("Acme - Engineer");
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/1/attempts/10");
  });
});

describe("buildSubmissionScreenshotUrl + buildStepScreenshotUrl", () => {
  it("builds the submission-screenshot streaming URL", async () => {
    const { buildSubmissionScreenshotUrl } = await import("./jobListingsApi");
    expect(buildSubmissionScreenshotUrl(7, 42)).toBe("/api/job-listings/7/attempts/42/submission-screenshot");
  });

  it("builds the per-step streaming URL", async () => {
    const { buildStepScreenshotUrl } = await import("./jobListingsApi");
    expect(buildStepScreenshotUrl(7, 42, 3)).toBe("/api/job-listings/7/attempts/42/steps/3/screenshot");
  });
});

describe("RESOLUTION_PHASE_LABELS", () => {
  it("has a non-empty label for every ResolutionPhase enum member", async () => {
    const { ResolutionPhase, RESOLUTION_PHASE_LABELS } = await import("./jobListingsApi");
    for (const phaseValue of Object.values(ResolutionPhase)) {
      const label = RESOLUTION_PHASE_LABELS[phaseValue];
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("matches the spec'd human-readable labels", async () => {
    const { ResolutionPhase, RESOLUTION_PHASE_LABELS } = await import("./jobListingsApi");
    expect(RESOLUTION_PHASE_LABELS[ResolutionPhase.BraveSearch]).toBe("Searching the web");
    expect(RESOLUTION_PHASE_LABELS[ResolutionPhase.AIPageClassify]).toBe("Reading candidate pages with AI");
    expect(RESOLUTION_PHASE_LABELS[ResolutionPhase.Finalize]).toBe("Wrapping up");
  });
});
