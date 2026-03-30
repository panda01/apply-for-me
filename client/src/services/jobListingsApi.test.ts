import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getJobListings, getJobListing, createJobListing, deleteJobListing,
  bulkCreateJobListings, applyToJob, startBatchApply, getBatchApplyStatus,
} from "./jobListingsApi";

const mockListing = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  description: "Build cool stuff",
  status: "init",
  live_url: null,
  post_date: "2026-03-01T00:00:00.000Z",
  created_date: "2026-03-07T00:00:00.000Z",
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

    const result = await applyToJob(1);

    expect(result.status).toBe("applying");
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/1/apply", { method: "POST" });
  });

  it("should throw on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Job listing not found" }),
    }));

    await expect(applyToJob(999)).rejects.toThrow("Job listing not found");
  });

  it("should throw generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(applyToJob(1)).rejects.toThrow("Failed to start job application");
  });
});

describe("startBatchApply", () => {
  it("should start batch and return confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: "Batch started", totalJobs: 5 }),
    }));

    const result = await startBatchApply();

    expect(result.totalJobs).toBe(5);
    expect(fetch).toHaveBeenCalledWith("/api/job-listings/apply-batch", { method: "POST" });
  });

  it("should throw on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "No job listings" }),
    }));

    await expect(startBatchApply()).rejects.toThrow("No job listings");
  });

  it("should throw generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(startBatchApply()).rejects.toThrow("Failed to start batch application");
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
