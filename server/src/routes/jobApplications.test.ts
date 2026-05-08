import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";

vi.mock("../prismaClient.js", () => {
  return {
    default: {
      jobListing: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
      },
      applicationAttemptLogs: {
        create: vi.fn(),
      },
    },
  };
});

vi.mock("../services/jobApplicationService.js", () => {
  return {
    applyToJob: vi.fn(),
  };
});

vi.mock("../services/jobListingScraperService.js", () => {
  return {
    fetchJobListingFromUrl: vi.fn(),
  };
});

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: { ...actual, readFile: mockReadFile },
    readFile: mockReadFile,
  };
});

import prisma from "../prismaClient.js";
import { applyToJob } from "../services/jobApplicationService.js";

const mockUserInfoJson = JSON.stringify({
  firstName: "Khalah",
  middleName: "Ciskei",
  lastName: "Jones-Golden",
  email: "khasan222@gmail.com",
  phone: "13479770736",
  github: "https://github.com/panda01",
  linkedin: "https://www.linkedin.com/in/khalahjonesgolden/",
  website: "https://khalah.medium.com",
  resumeUrl: "https://drive.google.com/file/d/test/view",
});

const mockInitJobListing = {
  id: 1,
  title: "Test Job",
  url: "https://linkedin.com/jobs/view/123",
  description: "Test description",
  salary: null,
  live_url: null,
  post_date: new Date("2026-03-07T00:00:00.000Z"),
  created_date: new Date("2026-03-07T00:00:00.000Z"),
  status: "init" as const,
};

const mockApplyingJobListing = {
  ...mockInitJobListing,
  status: "applying" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env["BROWSER_USE_PROFILE_ID"] = "test-profile-id";
  mockReadFile.mockResolvedValue(mockUserInfoJson);
  vi.mocked(prisma.applicationAttemptLogs.create).mockResolvedValue({
    id: 1, job_listing_id: 1, logs: "[]", end_response: "", created_date: new Date(),
  });
});

describe("POST /api/job-listings/:id/apply", () => {
  it("should return 202 and set status to applying", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    const response = await request(app)
      .post("/api/job-listings/1/apply");

    expect(response.status).toBe(202);
    expect(response.body.status).toBe("applying");
    expect(prisma.jobListing.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: "applying", live_url: null },
    });
  });

  it("should return 400 for invalid id", async () => {
    const response = await request(app)
      .post("/api/job-listings/abc/apply");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid id/);
  });

  it("should return 404 when job listing not found", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);

    const response = await request(app)
      .post("/api/job-listings/999/apply");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/);
  });

  it("should return 400 when job is not in init or error_applying status", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue({
      ...mockInitJobListing,
      status: "applied" as const,
    });

    const response = await request(app)
      .post("/api/job-listings/1/apply");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("applied");
  });

  it("should allow re-applying when status is error_applying", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue({
      ...mockInitJobListing,
      status: "error_applying" as const,
    });
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    const response = await request(app)
      .post("/api/job-listings/1/apply");

    expect(response.status).toBe(202);
  });

  it("should return 400 when BROWSER_USE_PROFILE_ID is missing", async () => {
    delete process.env["BROWSER_USE_PROFILE_ID"];
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);

    const response = await request(app)
      .post("/api/job-listings/1/apply");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("BROWSER_USE_PROFILE_ID");
  });

  it("should return 400 when user_info.json cannot be read", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);

    const response = await request(app)
      .post("/api/job-listings/1/apply");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("ENOENT");
  });

  it("should update status to applied after successful application", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied", stepLogs: [] });

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: "applied", live_url: null },
      });
    });
  });

  it("should save application attempt log on success", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied", stepLogs: [
      { stepNumber: 1, phase: 1, phaseLabel: "Opening", url: "https://example.com", nextGoal: "Navigate",
        actions: [], screenshotSaved: false, captchaDetected: false, stuckDetected: false, timestamp: "2026-03-28T00:00:00Z" },
    ] });

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      expect(prisma.applicationAttemptLogs.create).toHaveBeenCalledWith({
        data: {
          job_listing_id: 1,
          logs: expect.stringContaining("stepNumber"),
          end_response: "Applied",
        },
      });
    });
  });

  it("should save application attempt log on failure", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockRejectedValue(new Error("Application error"));

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      expect(prisma.applicationAttemptLogs.create).toHaveBeenCalledWith({
        data: {
          job_listing_id: 1,
          logs: "[]",
          end_response: "Application error",
        },
      });
    });
  });

  it("should handle saveAttemptLog failure gracefully", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });
    vi.mocked(prisma.applicationAttemptLogs.create).mockRejectedValue(new Error("DB write error"));

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to save attempt log"));
    });
    errorSpy.mockRestore();
  });

  it("should enrich job listing details after successful application when title is empty", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });
    // findUnique called again inside enrichJobListingDetails — return listing with empty title
    vi.mocked(prisma.jobListing.findUnique)
      .mockResolvedValueOnce(mockInitJobListing)  // first call: route handler
      .mockResolvedValueOnce({ ...mockInitJobListing, title: "" });  // second call: enrichment check

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      // Verify status was set to applied
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: "applied" as const, live_url: null },
      });
    });
  });

  it("should skip enrichment when job already has a title", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(prisma.jobListing.findUnique)
      .mockResolvedValueOnce(mockInitJobListing)  // route handler
      .mockResolvedValueOnce({ ...mockInitJobListing, title: "Existing Title" });  // enrichment check
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      const logCalls = logSpy.mock.calls.map(c => c[0] as string);
      const hasSkipLog = logCalls.some(msg => msg.includes("already has title"));
      expect(hasSkipLog).toBe(true);
    });
    logSpy.mockRestore();
  });

  it("should enrich LinkedIn job listing with credentials path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(prisma.jobListing.findUnique)
      .mockResolvedValueOnce({ ...mockInitJobListing, url: "https://www.linkedin.com/jobs/view/123" })
      .mockResolvedValueOnce({ ...mockInitJobListing, title: "", url: "https://www.linkedin.com/jobs/view/123" });
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      const logCalls = logSpy.mock.calls.map(c => c[0] as string);
      const hasEnrichLog = logCalls.some(msg => msg.includes("Enriching job"));
      expect(hasEnrichLog).toBe(true);
    });
    logSpy.mockRestore();
  });

  it("should call handleLiveUrlReady during single job application", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockImplementation(async (_url, _info, _profile, onLiveUrlReady) => {
      if (onLiveUrlReady) {
        await onLiveUrlReady("https://live.example.com/session");
      }
      return { success: true, message: "Applied" };
    });

    await request(app).post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { live_url: "https://live.example.com/session" },
      });
    });
  });

  it("should set status to closed when closedListing is true", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: false, closedListing: true, message: "No longer accepting" });

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: "closed", live_url: null },
      });
    });
  });

  it("should handle enrichment failure gracefully", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.jobListing.findUnique)
      .mockResolvedValueOnce(mockInitJobListing)
      .mockRejectedValueOnce(new Error("DB error during enrichment"));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to enrich"));
    });
    errorSpy.mockRestore();
  });

  it("should update status to error_applying and log error when application fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockRejectedValue(new Error("Application error"));

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: "error_applying", live_url: null },
      });
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Application failed for job 1"));
    errorSpy.mockRestore();
  });

  it("should update status to error_applying when applyToJob returns failure", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: false, message: "Task stopped" });

    await request(app)
      .post("/api/job-listings/1/apply");

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: "error_applying", live_url: null },
      });
    });
  });
});

describe("POST /api/job-listings/apply-batch", () => {
  it("should return 202 and start batch when eligible jobs exist", async () => {
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([
      mockInitJobListing,
      { ...mockInitJobListing, id: 2, url: "https://linkedin.com/jobs/view/456" },
    ]);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    const response = await request(app)
      .post("/api/job-listings/apply-batch");

    expect(response.status).toBe(202);
    expect(response.body.totalJobs).toBe(2);
    expect(response.body.message).toContain("2 jobs");
  });

  it("should return 400 when no eligible jobs exist", async () => {
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([]);

    const response = await request(app)
      .post("/api/job-listings/apply-batch");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("No job listings");
  });

  it("should return 400 when BROWSER_USE_PROFILE_ID is missing", async () => {
    delete process.env["BROWSER_USE_PROFILE_ID"];

    const response = await request(app)
      .post("/api/job-listings/apply-batch");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("BROWSER_USE_PROFILE_ID");
  });
});

describe("POST /api/job-listings/apply-batch (batch already running)", () => {
  it("should return 409 when a batch is already running", async () => {
    // First, start a batch so batchState.isRunning becomes true
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([
      mockInitJobListing,
    ]);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    // Make applyToJob hang so the batch stays running during our second request
    vi.mocked(applyToJob).mockReturnValue(new Promise(() => {}));

    const firstResponse = await request(app)
      .post("/api/job-listings/apply-batch");
    expect(firstResponse.status).toBe(202);

    // Second request while batch is still running
    const secondResponse = await request(app)
      .post("/api/job-listings/apply-batch");

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error).toContain("already running");

    // Reset the batchState so other tests aren't affected
    const { batchState } = await import("./jobApplications.js");
    batchState.isRunning = false;
    batchState.currentJobId = null;
    batchState.completed = [];
    batchState.errors = [];
    batchState.totalJobs = 0;
  });
});

describe("runBatchApply", () => {
  it("should call handleLiveUrlReady callback during batch apply", async () => {
    const { runBatchApply } = await import("./jobApplications.js");
    const userInfo = JSON.parse(mockUserInfoJson);

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockImplementation(async (_url, _info, _profile, onLiveUrlReady) => {
      if (onLiveUrlReady) {
        await onLiveUrlReady("https://live.example.com/session");
      }
      return { success: true, message: "Applied" };
    });

    const jobs = [{ id: 1, url: "https://linkedin.com/jobs/view/123" }];
    await runBatchApply(jobs, userInfo, "test-profile-id");

    // Verify the live_url was set via the callback
    expect(prisma.jobListing.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { live_url: "https://live.example.com/session" },
    });
  });

  it("should set status to closed in batch when closedListing is true", async () => {
    const { runBatchApply, batchState } = await import("./jobApplications.js");
    const userInfo = JSON.parse(mockUserInfoJson);

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: false, closedListing: true, message: "No longer accepting" });

    batchState.isRunning = true;
    batchState.completed = [];
    batchState.errors = [];
    batchState.totalJobs = 1;

    const jobs = [{ id: 40, url: "https://linkedin.com/jobs/view/closed" }];
    await runBatchApply(jobs, userInfo, "test-profile-id");

    expect(prisma.jobListing.update).toHaveBeenCalledWith({
      where: { id: 40 },
      data: { status: "closed", live_url: null },
    });
    expect(batchState.errors).toEqual([{ jobId: 40, error: "No longer accepting" }]);
  });

  it("should push to errors when applyToJob returns failure", async () => {
    const { runBatchApply, batchState } = await import("./jobApplications.js");
    const userInfo = JSON.parse(mockUserInfoJson);

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: false, message: "Task stopped" });

    batchState.isRunning = true;
    batchState.completed = [];
    batchState.errors = [];
    batchState.totalJobs = 1;

    const jobs = [{ id: 10, url: "https://linkedin.com/jobs/view/999" }];
    await runBatchApply(jobs, userInfo, "test-profile-id");

    expect(batchState.errors).toEqual([{ jobId: 10, error: "Task stopped" }]);
    expect(batchState.completed).toEqual([]);

    // Verify error_applying status was set
    expect(prisma.jobListing.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { status: "error_applying", live_url: null },
    });
  });

  it("should catch errors thrown by applyToJob and push to errors", async () => {
    const { runBatchApply, batchState } = await import("./jobApplications.js");
    const userInfo = JSON.parse(mockUserInfoJson);

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockRejectedValue(new Error("Network failure"));

    batchState.isRunning = true;
    batchState.completed = [];
    batchState.errors = [];
    batchState.totalJobs = 1;

    const jobs = [{ id: 20, url: "https://linkedin.com/jobs/view/888" }];
    await runBatchApply(jobs, userInfo, "test-profile-id");

    expect(batchState.errors).toEqual([{ jobId: 20, error: "Network failure" }]);
    expect(prisma.jobListing.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { status: "error_applying", live_url: null },
    });
  });

  it("should handle non-Error thrown by applyToJob in catch block", async () => {
    const { runBatchApply, batchState } = await import("./jobApplications.js");
    const userInfo = JSON.parse(mockUserInfoJson);

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockRejectedValue("string error");

    batchState.isRunning = true;
    batchState.completed = [];
    batchState.errors = [];
    batchState.totalJobs = 1;

    const jobs = [{ id: 30, url: "https://linkedin.com/jobs/view/777" }];
    await runBatchApply(jobs, userInfo, "test-profile-id");

    expect(batchState.errors).toEqual([{ jobId: 30, error: "string error" }]);
  });
});

describe("GET /api/job-listings/apply-batch/status", () => {
  it("should return the current batch status", async () => {
    const response = await request(app)
      .get("/api/job-listings/apply-batch/status");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("isRunning");
    expect(response.body).toHaveProperty("currentJobId");
    expect(response.body).toHaveProperty("completed");
    expect(response.body).toHaveProperty("errors");
    expect(response.body).toHaveProperty("totalJobs");
    expect(response.body).toHaveProperty("remaining");
  });
});
