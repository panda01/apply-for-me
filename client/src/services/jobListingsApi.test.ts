import { describe, it, expect, vi, beforeEach } from "vitest";
import { getJobListings, getJobListing, createJobListing, deleteJobListing } from "./jobListingsApi";

const mockListing = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  description: "Build cool stuff",
  status: "completed",
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
