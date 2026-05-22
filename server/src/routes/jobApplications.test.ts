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
      applicationProfile: {
        findUnique: vi.fn(),
      },
    },
  };
});

vi.mock("../services/jobApplicationService.js", () => {
  return {
    applyToJob: vi.fn(),
  };
});

import prisma from "../prismaClient.js";
import { applyToJob } from "../services/jobApplicationService.js";

/**
 * Fixture mirroring an ApplicationProfile row as returned by Prisma. Used as
 * the default findUnique mock value so every apply/apply-batch test has a
 * usable profile to bind to.
 */
const mockApplicationProfile = {
  id: 1,
  name: "Default",
  firstName: "Khalah",
  middleName: "Ciskei",
  lastName: "Jones-Golden",
  email: "khasan222@gmail.com",
  phone: "13479770736",
  github: "https://github.com/panda01",
  linkedin: "https://www.linkedin.com/in/khalahjonesgolden/",
  website: "https://khalah.medium.com",
  resumeUrl: "https://drive.google.com/file/d/test/view",
  coverLetterUrl: null,
  workAuthorization: null,
  desiredSalaryMin: null,
  created_date: new Date("2026-05-21T00:00:00.000Z"),
  updated_date: new Date("2026-05-21T00:00:00.000Z"),
};

const mockInitJobListing = {
  id: 1,
  title: "Test Job",
  url: "https://linkedin.com/jobs/view/123",
  application_url: "https://acme.com/jobs/123/apply",
  description: "Test description",
  salary: null,
  location: null,
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
  vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(mockApplicationProfile);
  vi.mocked(prisma.applicationAttemptLogs.create).mockResolvedValue({
    id: 1,
    job_listing_id: 1,
    logs: "[]",
    end_response: "failed",
    submission_screenshot_path: null,
    log_directory: null,
    created_date: new Date(),
  });
});

describe("POST /api/job-listings/:id/apply", () => {
  it("should return 202 and set status to applying", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    const response = await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe("applying");
    expect(prisma.jobListing.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: "applying", live_url: null },
    });
  });

  it("should drive applyToJob against the application_url, not the source url", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    await vi.waitFor(() => {
      expect(applyToJob).toHaveBeenCalledWith(
        "https://acme.com/jobs/123/apply",
        expect.objectContaining({ firstName: "Khalah", lastName: "Jones-Golden" }),
        "test-profile-id",
        expect.any(Function),
        1,
        expect.any(Function),
      );
    });
  });

  it("should return 400 when application_url is null", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue({
      ...mockInitJobListing,
      application_url: null,
    });

    const response = await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/no application_url/i);
    expect(applyToJob).not.toHaveBeenCalled();
  });

  it("should return 400 when application_url is an empty string", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue({
      ...mockInitJobListing,
      application_url: "",
    });

    const response = await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/no application_url/i);
  });

  it("should return 400 for invalid id", async () => {
    const response = await request(app)
      .post("/api/job-listings/abc/apply")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid id/);
  });

  it("should return 404 when job listing not found", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);

    const response = await request(app)
      .post("/api/job-listings/999/apply")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/);
  });

  it("should return 400 when job is not in init or error_applying status", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue({
      ...mockInitJobListing,
      status: "applied" as const,
    });

    const response = await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("applied");
  });

  it("should return 400 when status is missing_form_url", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue({
      ...mockInitJobListing,
      status: "missing_form_url" as const,
      application_url: null,
    });

    const response = await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(400);
  });

  it("should allow re-applying when status is error_applying", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue({
      ...mockInitJobListing,
      status: "error_applying" as const,
    });
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    const response = await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(202);
  });

  it("should return 400 when applicationProfileId is missing from the body", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);

    const response = await request(app).post("/api/job-listings/1/apply").send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/applicationProfileId/);
  });

  it("should return 400 when applicationProfileId points at a missing profile", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(null);

    const response = await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 999 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not found/);
  });

  it("should return 400 when BROWSER_USE_PROFILE_ID is missing", async () => {
    delete process.env["BROWSER_USE_PROFILE_ID"];
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);

    const response = await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("BROWSER_USE_PROFILE_ID");
  });

  it("should stringify a non-Error rejection from applyToJob in the failure log line", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockRejectedValue("non-error-apply-failure");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Application failed for job 1: non-error-apply-failure")
      );
    });
    consoleErrorSpy.mockRestore();
  });

  it("should stringify a non-Error rejection from prisma.applicationAttemptLogs.create", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });
    vi.mocked(prisma.applicationAttemptLogs.create).mockRejectedValue("non-error-attempt-log");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save attempt log for job 1: non-error-attempt-log")
      );
    });
    consoleErrorSpy.mockRestore();
  });

  it("should update status to applied after successful application", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied", stepLogs: [] });

    await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

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
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    await vi.waitFor(() => {
      expect(prisma.applicationAttemptLogs.create).toHaveBeenCalledWith({
        data: {
          job_listing_id: 1,
          logs: expect.stringContaining("stepNumber"),
          end_response: "applied",
          submission_screenshot_path: null,
          log_directory: null,
        },
      });
    });
  });

  it("should save application attempt log on failure with derived enum", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockRejectedValue(new Error("Application error"));

    await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    await vi.waitFor(() => {
      expect(prisma.applicationAttemptLogs.create).toHaveBeenCalledWith({
        data: {
          job_listing_id: 1,
          logs: "[]",
          end_response: "failed",
          submission_screenshot_path: null,
          log_directory: null,
        },
      });
    });
  });

  it("should persist submission_screenshot_path and log_directory when applyToJob fires the screenshot callback", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockImplementation(
      async (_url, _info, _profile, _onLiveUrlReady, _jobId, onSubmissionScreenshotSaved) => {
        if (onSubmissionScreenshotSaved) {
          await onSubmissionScreenshotSaved("/abs/logs/1-2026-05-22/step-4.png");
        }
        return { success: true, message: "Applied", logDirectory: "/abs/logs/1-2026-05-22", stepLogs: [] };
      },
    );

    await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    await vi.waitFor(() => {
      expect(prisma.applicationAttemptLogs.create).toHaveBeenCalledWith({
        data: {
          job_listing_id: 1,
          logs: "[]",
          end_response: "applied",
          submission_screenshot_path: "/abs/logs/1-2026-05-22/step-4.png",
          log_directory: "/abs/logs/1-2026-05-22",
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
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to save attempt log"));
    });
    errorSpy.mockRestore();
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

    await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

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
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: "closed", live_url: null },
      });
    });
  });

  it("should update status to error_applying and log error when application fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockInitJobListing);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockRejectedValue(new Error("Application error"));

    await request(app)
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

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
      .post("/api/job-listings/1/apply")
      .send({ applicationProfileId: 1 });

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
      .post("/api/job-listings/apply-batch")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(202);
    expect(response.body.totalJobs).toBe(2);
    expect(response.body.message).toContain("2 jobs");
  });

  it("filters out jobs whose application_url is null via the findMany where clause", async () => {
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([mockInitJobListing]);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    await request(app)
      .post("/api/job-listings/apply-batch")
      .send({ applicationProfileId: 1 });

    expect(prisma.jobListing.findMany).toHaveBeenCalledWith({
      where: { status: "init", application_url: { not: null } },
      orderBy: { created_date: "asc" },
    });
  });

  it("should return 400 when no eligible jobs exist", async () => {
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([]);

    const response = await request(app)
      .post("/api/job-listings/apply-batch")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("No job listings");
  });

  it("should return 400 when BROWSER_USE_PROFILE_ID is missing", async () => {
    delete process.env["BROWSER_USE_PROFILE_ID"];

    const response = await request(app)
      .post("/api/job-listings/apply-batch")
      .send({ applicationProfileId: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("BROWSER_USE_PROFILE_ID");
  });

  it("should return 400 when applicationProfileId is missing from the body", async () => {
    const response = await request(app)
      .post("/api/job-listings/apply-batch")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/applicationProfileId/);
  });

  it("should return 400 when applicationProfileId points at a missing profile", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(null);

    const response = await request(app)
      .post("/api/job-listings/apply-batch")
      .send({ applicationProfileId: 999 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not found/);
  });
});

describe("POST /api/job-listings/apply-batch (batch already running)", () => {
  it("should return 409 when a batch is already running", async () => {
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([mockInitJobListing]);
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockReturnValue(new Promise(() => {}));

    const firstResponse = await request(app)
      .post("/api/job-listings/apply-batch")
      .send({ applicationProfileId: 1 });
    expect(firstResponse.status).toBe(202);

    const secondResponse = await request(app)
      .post("/api/job-listings/apply-batch")
      .send({ applicationProfileId: 1 });

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error).toContain("already running");

    const { batchState } = await import("./jobApplications.js");
    batchState.isRunning = false;
    batchState.currentJobId = null;
    batchState.completed = [];
    batchState.errors = [];
    batchState.totalJobs = 0;
  });
});

/**
 * Builds a UserInfo fixture matching the shape jobApplicationService.ts expects
 * (all optional fields nullable). Used in the runBatchApply integration tests.
 */
function buildTestUserInfo() {
  return {
    firstName: "Khalah",
    middleName: "Ciskei",
    lastName: "Jones-Golden",
    email: "khasan222@gmail.com",
    phone: "13479770736",
    github: "https://github.com/panda01",
    linkedin: "https://www.linkedin.com/in/khalahjonesgolden/",
    website: "https://khalah.medium.com",
    resumeUrl: "https://drive.google.com/file/d/test/view",
    coverLetterUrl: null,
    workAuthorization: null,
    desiredSalaryMin: null,
  };
}

describe("runBatchApply", () => {
  it("should call handleLiveUrlReady callback during batch apply", async () => {
    const { runBatchApply } = await import("./jobApplications.js");

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockImplementation(async (_url, _info, _profile, onLiveUrlReady) => {
      if (onLiveUrlReady) {
        await onLiveUrlReady("https://live.example.com/session");
      }
      return { success: true, message: "Applied" };
    });

    const jobs = [{ id: 1, url: "https://linkedin.com/jobs/view/123", application_url: "https://acme.com/apply" }];
    await runBatchApply(jobs, buildTestUserInfo(), "test-profile-id");

    expect(prisma.jobListing.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { live_url: "https://live.example.com/session" },
    });
  });

  it("drives applyToJob against the application_url, not the source url", async () => {
    const { runBatchApply } = await import("./jobApplications.js");

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: true, message: "Applied" });

    const jobs = [{ id: 1, url: "https://linkedin.com/jobs/view/1", application_url: "https://acme.com/apply" }];
    await runBatchApply(jobs, buildTestUserInfo(), "test-profile-id");

    expect(applyToJob).toHaveBeenCalledWith("https://acme.com/apply", expect.anything(), "test-profile-id", expect.any(Function), 1, expect.any(Function));
  });

  it("should set status to closed in batch when closedListing is true", async () => {
    const { runBatchApply, batchState } = await import("./jobApplications.js");

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: false, closedListing: true, message: "No longer accepting" });

    batchState.isRunning = true;
    batchState.completed = [];
    batchState.errors = [];
    batchState.totalJobs = 1;

    const jobs = [{ id: 40, url: "https://linkedin.com/jobs/view/closed", application_url: "https://acme.com/closed" }];
    await runBatchApply(jobs, buildTestUserInfo(), "test-profile-id");

    expect(prisma.jobListing.update).toHaveBeenCalledWith({
      where: { id: 40 },
      data: { status: "closed", live_url: null },
    });
    expect(batchState.errors).toEqual([{ jobId: 40, error: "No longer accepting" }]);
  });

  it("should push to errors when applyToJob returns failure", async () => {
    const { runBatchApply, batchState } = await import("./jobApplications.js");

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockResolvedValue({ success: false, message: "Task stopped" });

    batchState.isRunning = true;
    batchState.completed = [];
    batchState.errors = [];
    batchState.totalJobs = 1;

    const jobs = [{ id: 10, url: "https://linkedin.com/jobs/view/999", application_url: "https://acme.com/999" }];
    await runBatchApply(jobs, buildTestUserInfo(), "test-profile-id");

    expect(batchState.errors).toEqual([{ jobId: 10, error: "Task stopped" }]);
    expect(batchState.completed).toEqual([]);

    expect(prisma.jobListing.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { status: "error_applying", live_url: null },
    });
  });

  it("should catch errors thrown by applyToJob and push to errors", async () => {
    const { runBatchApply, batchState } = await import("./jobApplications.js");

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockRejectedValue(new Error("Network failure"));

    batchState.isRunning = true;
    batchState.completed = [];
    batchState.errors = [];
    batchState.totalJobs = 1;

    const jobs = [{ id: 20, url: "https://linkedin.com/jobs/view/888", application_url: "https://acme.com/888" }];
    await runBatchApply(jobs, buildTestUserInfo(), "test-profile-id");

    expect(batchState.errors).toEqual([{ jobId: 20, error: "Network failure" }]);
    expect(prisma.jobListing.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { status: "error_applying", live_url: null },
    });
  });

  it("should handle non-Error thrown by applyToJob in catch block", async () => {
    const { runBatchApply, batchState } = await import("./jobApplications.js");

    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockApplyingJobListing);
    vi.mocked(applyToJob).mockRejectedValue("string error");

    batchState.isRunning = true;
    batchState.completed = [];
    batchState.errors = [];
    batchState.totalJobs = 1;

    const jobs = [{ id: 30, url: "https://linkedin.com/jobs/view/777", application_url: "https://acme.com/777" }];
    await runBatchApply(jobs, buildTestUserInfo(), "test-profile-id");

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

describe("deriveAttemptOutcome", () => {
  it("should return applied when success is true", async () => {
    const { deriveAttemptOutcome } = await import("./jobApplications.js");
    expect(deriveAttemptOutcome({ success: true, message: "ok", stepLogs: [] })).toBe("applied");
  });

  it("should return failed when success is false with no special flags", async () => {
    const { deriveAttemptOutcome } = await import("./jobApplications.js");
    expect(deriveAttemptOutcome({ success: false, message: "boom", stepLogs: [] })).toBe("failed");
  });

  it("should return closed_listing when closedListing is true (precedence over other flags)", async () => {
    const { deriveAttemptOutcome } = await import("./jobApplications.js");
    expect(
      deriveAttemptOutcome({
        success: false,
        closedListing: true,
        message: "Closed",
        stepLogs: [
          { stepNumber: 1, phase: 1, phaseLabel: "Opening", url: "x", nextGoal: "x", actions: [], screenshotSaved: false, captchaDetected: true, stuckDetected: true, timestamp: "t" },
        ],
      }),
    ).toBe("closed_listing");
  });

  it("should return captcha_blocked when any step has captchaDetected", async () => {
    const { deriveAttemptOutcome } = await import("./jobApplications.js");
    expect(
      deriveAttemptOutcome({
        success: false,
        message: "Failed",
        stepLogs: [
          { stepNumber: 1, phase: 3, phaseLabel: "Form", url: "x", nextGoal: "x", actions: [], screenshotSaved: false, captchaDetected: true, stuckDetected: false, timestamp: "t" },
        ],
      }),
    ).toBe("captcha_blocked");
  });

  it("should return stuck when any step has stuckDetected and no captcha", async () => {
    const { deriveAttemptOutcome } = await import("./jobApplications.js");
    expect(
      deriveAttemptOutcome({
        success: false,
        message: "Stuck",
        stepLogs: [
          { stepNumber: 1, phase: 3, phaseLabel: "Form", url: "x", nextGoal: "x", actions: [], screenshotSaved: false, captchaDetected: false, stuckDetected: true, timestamp: "t" },
        ],
      }),
    ).toBe("stuck");
  });

  it("should prefer captcha_blocked over stuck when both flags are set", async () => {
    const { deriveAttemptOutcome } = await import("./jobApplications.js");
    expect(
      deriveAttemptOutcome({
        success: false,
        message: "Both",
        stepLogs: [
          { stepNumber: 1, phase: 3, phaseLabel: "Form", url: "x", nextGoal: "x", actions: [], screenshotSaved: false, captchaDetected: true, stuckDetected: true, timestamp: "t" },
        ],
      }),
    ).toBe("captcha_blocked");
  });
});
