import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockTasksGet = vi.fn();
const mockTasksStopTaskAndSession = vi.fn();
const mockTasksLogs = vi.fn();
const mockSessionsGet = vi.fn();

/**
 * Creates a mock TaskRun that supports both await and for-await iteration.
 * @param {object} result - The resolved task result
 * @param {string} taskId - The task ID to expose on the run object
 * @param {Array<Record<string, unknown>>} steps - Steps to yield during for-await iteration
 * @returns {object} A mock TaskRun with taskId, .then(), .result, and [Symbol.asyncIterator]
 */
function createMockTaskRun(
  result: Record<string, unknown>,
  taskId: string,
  steps: Array<Record<string, unknown>> = []
) {
  return {
    taskId,
    result,
    then(onFulfilled: (value: Record<string, unknown>) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
    async *[Symbol.asyncIterator]() {
      for (const step of steps) {
        yield step;
      }
    },
  };
}

/**
 * Creates a mock TaskRun that rejects when awaited.
 * @param {Error} error - The error to reject with
 * @returns {object} A mock TaskRun that rejects
 */
function createMockRejectedTaskRun(error: Error) {
  return {
    taskId: null,
    result: null,
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.reject(error).then(onFulfilled, onRejected);
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => Promise.reject(error),
        return: () => Promise.resolve({ value: undefined, done: true as const }),
        throw: () => Promise.reject(error),
      };
    },
  };
}

const mockRun = vi.fn();

vi.mock("browser-use-sdk", () => {
  return {
    BrowserUse: class MockBrowserUse {
      run = mockRun;
      tasks = {
        get: mockTasksGet,
        stopTaskAndSession: mockTasksStopTaskAndSession,
        logs: mockTasksLogs,
      };
      sessions = {
        get: mockSessionsGet,
      };
    },
  };
});

const { mockMkdir, mockWriteFile } = vi.hoisted(() => ({
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: { ...actual, mkdir: mockMkdir, writeFile: mockWriteFile },
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
  };
});

import {
  applyToJob,
  classifyApplicationPhase,
  detectCaptchaOrStuck,
  ensureLogDirectory,
  saveStepScreenshot,
  saveRunSummary,
  type UserInfo,
} from "./jobApplicationService.js";

const mockUserInfo: UserInfo = {
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

const mockProfileId = "439bc116-ae1f-4f98-aee1-6a7cd16d4968";

const mockStep = (overrides: Partial<{
  number: number; nextGoal: string; url: string;
  actions: string[]; memory: string; screenshotUrl: string | null;
  evaluationPreviousGoal: string;
}> = {}) => ({
  number: 1,
  nextGoal: "Navigate to job page",
  url: "https://linkedin.com/jobs/view/123",
  actions: [],
  memory: "",
  screenshotUrl: null,
  evaluationPreviousGoal: "",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockTasksGet.mockResolvedValue({ sessionId: "session-1" });
  mockSessionsGet.mockResolvedValue({ liveUrl: "https://live.example.com/session" });
  mockTasksLogs.mockResolvedValue({ url: null });
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyApplicationPhase", () => {
  it("should classify step as Phase 1 when no keywords match", () => {
    const step = { nextGoal: "Navigate to the page", url: "https://example.com", actions: [] };
    const result = classifyApplicationPhase(step, "https://example.com", 0);
    expect(result.phase).toBe(1);
    expect(result.label).toBe("Opening job URL");
  });

  it("should classify step as Phase 2 when apply keywords found", () => {
    const step = { nextGoal: "Click Easy Apply button", url: "https://example.com/jobs/1", actions: [] };
    const result = classifyApplicationPhase(step, "https://example.com/jobs/1", 1);
    expect(result.phase).toBe(2);
    expect(result.label).toBe("Following apply links");
  });

  it("should classify step as Phase 3 when form keywords found", () => {
    const step = { nextGoal: "Fill in the name field", url: "https://example.com/apply", actions: ["type name"] };
    const result = classifyApplicationPhase(step, "https://example.com/jobs/1", 2);
    expect(result.phase).toBe(3);
    expect(result.label).toBe("Filling out form");
  });

  it("should classify step as Phase 4 when review keywords found", () => {
    const step = { nextGoal: "Review the application before submitting", url: "https://example.com/apply", actions: [] };
    const result = classifyApplicationPhase(step, "https://example.com/jobs/1", 3);
    expect(result.phase).toBe(4);
    expect(result.label).toBe("Reviewing application");
  });

  it("should classify step as Phase 4 when verify keywords found", () => {
    const step = { nextGoal: "Verify every field is correct", url: "https://example.com/apply", actions: [] };
    const result = classifyApplicationPhase(step, "https://example.com/jobs/1", 3);
    expect(result.phase).toBe(4);
  });

  it("should classify step as Phase 4 when double-check keywords found", () => {
    const step = { nextGoal: "Double-check the email field", url: "https://example.com/apply", actions: [] };
    const result = classifyApplicationPhase(step, "https://example.com/jobs/1", 3);
    expect(result.phase).toBe(4);
  });

  it("should classify step as Phase 5 when submit keywords found", () => {
    const step = { nextGoal: "Submit the application", url: "https://example.com/apply", actions: [] };
    const result = classifyApplicationPhase(step, "https://example.com/jobs/1", 4);
    expect(result.phase).toBe(5);
    expect(result.label).toBe("Submitting application");
  });

  it("should classify step as Phase 5 when send application keywords found", () => {
    const step = { nextGoal: "Send application", url: "https://example.com/apply", actions: [] };
    const result = classifyApplicationPhase(step, "https://example.com/jobs/1", 4);
    expect(result.phase).toBe(5);
  });

  it("should classify combined review+submit step as Phase 4 (review wins ordering)", () => {
    const step = { nextGoal: "Review the form before submit", url: "https://example.com/apply", actions: [] };
    const result = classifyApplicationPhase(step, "https://example.com/jobs/1", 3);
    expect(result.phase).toBe(4);
  });

  it("should never go backward from previous phase", () => {
    const step = { nextGoal: "Navigate to page", url: "https://example.com", actions: [] };
    const result = classifyApplicationPhase(step, "https://example.com", 3);
    expect(result.phase).toBe(3);
  });

  it("should never go backward from Phase 5 to Phase 4 even on review wording", () => {
    const step = { nextGoal: "Review the receipt", url: "https://example.com/apply", actions: [] };
    const result = classifyApplicationPhase(step, "https://example.com/jobs/1", 5);
    expect(result.phase).toBe(5);
  });
});

describe("detectCaptchaOrStuck", () => {
  it("should detect captcha in nextGoal", () => {
    const step = { nextGoal: "Solve the CAPTCHA challenge", memory: "", url: "https://example.com", actions: [] };
    const result = detectCaptchaOrStuck(step, 0);
    expect(result.isCaptcha).toBe(true);
    expect(result.isStuck).toBe(false);
  });

  it("should detect captcha in memory", () => {
    const step = { nextGoal: "Continue", memory: "I see a verify you are human check", url: "https://example.com", actions: [] };
    const result = detectCaptchaOrStuck(step, 0);
    expect(result.isCaptcha).toBe(true);
  });

  it("should not detect captcha when no keywords present", () => {
    const step = { nextGoal: "Fill form", memory: "Going well", url: "https://example.com", actions: [] };
    const result = detectCaptchaOrStuck(step, 0);
    expect(result.isCaptcha).toBe(false);
  });

  it("should detect stuck when idle same URL count reaches threshold", () => {
    const step = { nextGoal: "Try again", memory: "", url: "https://example.com/page", actions: [] };
    const result = detectCaptchaOrStuck(step, 3);
    expect(result.isStuck).toBe(true);
  });

  it("should not detect stuck when idle count is below threshold", () => {
    const step = { nextGoal: "Continue", memory: "", url: "https://example.com/page", actions: [] };
    const result = detectCaptchaOrStuck(step, 2);
    expect(result.isStuck).toBe(false);
  });

  it("should not detect stuck when agent is actively performing actions", () => {
    // Even with a high idle count, if the step has actions it's making progress
    // (though the caller handles not incrementing — here we just test threshold check)
    const step = { nextGoal: "Type name", memory: "", url: "https://example.com/page", actions: ["type Khalah"] };
    const result = detectCaptchaOrStuck(step, 2);
    expect(result.isStuck).toBe(false);
  });
});

describe("ensureLogDirectory", () => {
  it("should create a directory with jobId and timestamp", async () => {
    await ensureLogDirectory(42);
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining("42-"),
      { recursive: true }
    );
  });

  it("should use string jobId when provided", async () => {
    await ensureLogDirectory("test-job");
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining("test-job-"),
      { recursive: true }
    );
  });
});

describe("saveStepScreenshot", () => {
  it("should download, save, and return the absolute file path", async () => {
    const mockBuffer = new ArrayBuffer(8);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockBuffer),
    }));

    const savedPath = await saveStepScreenshot("https://screenshots.example.com/img.png", "/tmp/logs", 3);

    expect(fetch).toHaveBeenCalledWith("https://screenshots.example.com/img.png");
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("step-3.png"),
      expect.any(Buffer)
    );
    expect(savedPath).not.toBeNull();
    expect(savedPath).toContain("step-3.png");
  });

  it("should return null on download failure and warn", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const savedPath = await saveStepScreenshot("https://screenshots.example.com/missing.png", "/tmp/logs", 5);

    expect(savedPath).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to download screenshot"));
    warnSpy.mockRestore();
  });

  it("should return null on fetch exception and log error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const savedPath = await saveStepScreenshot("https://screenshots.example.com/err.png", "/tmp/logs", 1);

    expect(savedPath).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Error saving screenshot"));
    errorSpy.mockRestore();
  });
});

describe("saveRunSummary", () => {
  it("should write JSON summary to the log directory", async () => {
    const steps = [{ stepNumber: 1, phase: 1, phaseLabel: "Opening", url: "https://example.com",
      nextGoal: "Navigate", actions: [], screenshotSaved: false,
      captchaDetected: false, stuckDetected: false, timestamp: "2026-03-28T00:00:00Z" }];
    const result = { success: true, message: "Done" };

    await saveRunSummary("/tmp/logs", steps, "task-1", "https://example.com/job", result);

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("run-summary.json"),
      expect.stringContaining("task-1")
    );
  });

  it("should log error on write failure", async () => {
    mockWriteFile.mockRejectedValueOnce(new Error("Disk full"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await saveRunSummary("/tmp/logs", [], "task-1", "https://example.com", { success: true, message: "Done" });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Error saving run summary"));
    errorSpy.mockRestore();
  });
});

describe("applyToJob", () => {
  it("should throw when BROWSER_USE_API is not set", async () => {
    delete process.env["BROWSER_USE_API"];

    await expect(applyToJob("https://linkedin.com/jobs/1", mockUserInfo, mockProfileId))
      .rejects.toThrow("BROWSER_USE_API environment variable is not set");
  });

  it("should iterate through steps and return success", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const steps = [
      mockStep({ number: 1, nextGoal: "Navigate to job page", url: "https://linkedin.com/jobs/view/123" }),
      mockStep({ number: 2, nextGoal: "Click Easy Apply button", url: "https://linkedin.com/jobs/view/123/apply" }),
      mockStep({ number: 3, nextGoal: "Fill in name field", actions: ["type name"], url: "https://linkedin.com/jobs/view/123/apply/form" }),
      mockStep({ number: 4, nextGoal: "Submit the application", url: "https://linkedin.com/jobs/view/123/apply/review" }),
    ];
    const result = {
      id: "task-1",
      status: "finished",
      output: "Application submitted",
      sessionId: "session-1",
    };
    mockRun.mockReturnValue(createMockTaskRun(result, "task-1", steps));

    const applicationResult = await applyToJob(
      "https://linkedin.com/jobs/view/123",
      mockUserInfo,
      mockProfileId,
      undefined,
      42,
    );

    expect(applicationResult.success).toBe(true);
    expect(applicationResult.message).toBe("Application submitted");
    expect(applicationResult.logDirectory).toBeDefined();
  });

  it("should return failure when task is stopped", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const result = {
      id: "task-stopped",
      status: "stopped",
      output: null,
      sessionId: "session-1",
    };
    mockRun.mockReturnValue(createMockTaskRun(result, "task-stopped"));

    const applicationResult = await applyToJob(
      "https://linkedin.com/jobs/view/123",
      mockUserInfo,
      mockProfileId,
    );

    expect(applicationResult.success).toBe(false);
    expect(applicationResult.message).toContain("failed");
  });

  it("should return failure when isSuccess is false", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const result = {
      id: "task-isSuccess-false",
      status: "finished",
      output: "Could not find the apply button",
      sessionId: "session-1",
      isSuccess: false,
    };
    mockRun.mockReturnValue(createMockTaskRun(result, "task-isSuccess-false"));

    const applicationResult = await applyToJob(
      "https://linkedin.com/jobs/view/123",
      mockUserInfo,
      mockProfileId,
    );

    expect(applicationResult.success).toBe(false);
    expect(applicationResult.message).toBe("Could not find the apply button");
  });

  it("should return success when isSuccess is true", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const result = {
      id: "task-isSuccess-true",
      status: "finished",
      output: "Application submitted!",
      sessionId: "session-1",
      isSuccess: true,
    };
    mockRun.mockReturnValue(createMockTaskRun(result, "task-isSuccess-true"));

    const applicationResult = await applyToJob(
      "https://linkedin.com/jobs/view/123",
      mockUserInfo,
      mockProfileId,
    );

    expect(applicationResult.success).toBe(true);
    expect(applicationResult.message).toBe("Application submitted!");
  });

  it("should include stepLogs in the result", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const steps = [
      mockStep({ number: 1, nextGoal: "Navigate to page" }),
      mockStep({ number: 2, nextGoal: "Click apply" }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-steplogs",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
      isSuccess: true,
    }, "task-steplogs", steps));

    const applicationResult = await applyToJob(
      "https://example.com/jobs/1",
      mockUserInfo,
      mockProfileId,
      undefined,
      50,
    );

    expect(applicationResult.stepLogs).toBeDefined();
    expect(applicationResult.stepLogs).toHaveLength(2);
    expect(applicationResult.stepLogs![0].stepNumber).toBe(1);
    expect(applicationResult.stepLogs![1].stepNumber).toBe(2);
  });

  it("should stop the task and session after successful application", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-cleanup",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-cleanup"));

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId);

    expect(mockTasksStopTaskAndSession).toHaveBeenCalledWith("task-cleanup");
  });

  it("should handle task stop failure gracefully with error log", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-stop-fail",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-stop-fail"));
    mockTasksStopTaskAndSession.mockRejectedValue(new Error("Already stopped"));

    const result = await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId);
    expect(result.success).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to stop task"));
    errorSpy.mockRestore();
  });

  it("should handle non-Error thrown during application with String conversion", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockTaskRun = {
      taskId: null,
      result: null,
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.reject("string error").then(onFulfilled, onRejected);
      },
      [Symbol.asyncIterator]() {
        return {
          next: () => Promise.reject("string error"),
          return: () => Promise.resolve({ value: undefined, done: true as const }),
          throw: () => Promise.reject("string error"),
        };
      },
    };
    mockRun.mockReturnValue(mockTaskRun);

    await expect(applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId))
      .rejects.toBe("string error");

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("APPLICATION FAILED"));
    errorSpy.mockRestore();
  });

  it("should handle non-Error thrown during task stop in finally", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-stop-nonError",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-stop-nonError"));
    mockTasksStopTaskAndSession.mockRejectedValue("non-error stop failure");

    const result = await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId);
    expect(result.success).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to stop task: non-error stop failure"));
    errorSpy.mockRestore();
  });

  it("should not call stopTaskAndSession when run fails before getting taskId", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    mockRun.mockReturnValue(createMockRejectedTaskRun(new Error("Network error")));

    await expect(applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId))
      .rejects.toThrow("Network error");

    expect(mockTasksStopTaskAndSession).not.toHaveBeenCalled();
  });

  it("should call onLiveUrlReady callback with the live URL when provided", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-live",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-live"));
    mockTasksGet.mockResolvedValue({ sessionId: "session-1" });
    mockSessionsGet.mockResolvedValue({ liveUrl: "https://live.browser-use.com/abc123" });

    const onLiveUrlReady = vi.fn();
    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, onLiveUrlReady);

    expect(mockTasksGet).toHaveBeenCalledWith("task-live");
    expect(mockSessionsGet).toHaveBeenCalledWith("session-1");
    expect(onLiveUrlReady).toHaveBeenCalledWith("https://live.browser-use.com/abc123");
  });

  it("should not call onLiveUrlReady when callback is not provided", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-no-cb",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-no-cb"));

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId);

    expect(mockTasksGet).not.toHaveBeenCalled();
    expect(mockSessionsGet).not.toHaveBeenCalled();
  });

  it("should log error when sessions.get fails fetching live URL", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-session-fail",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-session-fail"));
    mockTasksGet.mockResolvedValue({ sessionId: "session-1" });
    mockSessionsGet.mockRejectedValue(new Error("Session not found"));

    const onLiveUrlReady = vi.fn();
    const result = await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, onLiveUrlReady);

    expect(result.success).toBe(true);
    expect(onLiveUrlReady).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to fetch live URL"));
    errorSpy.mockRestore();
  });

  it("should not call onLiveUrlReady when session has no liveUrl", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-no-live",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-no-live"));
    mockTasksGet.mockResolvedValue({ sessionId: "session-1" });
    mockSessionsGet.mockResolvedValue({ liveUrl: null });

    const onLiveUrlReady = vi.fn();
    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, onLiveUrlReady);

    expect(onLiveUrlReady).not.toHaveBeenCalled();
  });

  it("should include all user info fields in the application prompt", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-prompt",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-prompt"));

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId);

    const prompt = mockRun.mock.calls[0][0] as string;
    expect(prompt).toContain(mockUserInfo.firstName);
    expect(prompt).toContain(mockUserInfo.lastName);
    expect(prompt).toContain(mockUserInfo.email);
    expect(prompt).toContain(mockUserInfo.phone);
    expect(prompt).toContain(mockUserInfo.github);
    expect(prompt).toContain(mockUserInfo.linkedin);
    expect(prompt).toContain(mockUserInfo.website);
    expect(prompt).toContain(mockUserInfo.resumeUrl);
  });

  it("should save screenshot on phase transition when screenshotUrl present", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }));
    const steps = [
      mockStep({ number: 1, nextGoal: "Navigate to page", url: "https://example.com/job" }),
      mockStep({ number: 2, nextGoal: "Click Easy Apply", url: "https://example.com/apply", screenshotUrl: "https://shots.example.com/phase2.png" }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-phase-shot",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
      isSuccess: true,
    }, "task-phase-shot", steps));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, undefined, 95);

    const logCalls = logSpy.mock.calls.map(c => c[0] as string);
    const hasPhaseScreenshotLog = logCalls.some(msg => msg.includes("Phase transition screenshot saving"));
    expect(hasPhaseScreenshotLog).toBe(true);

    // Screenshot was saved (phase transition + normal step = at least 1 write)
    const screenshotWrites = mockWriteFile.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("step-2.png")
    );
    expect(screenshotWrites.length).toBeGreaterThanOrEqual(1);
    logSpy.mockRestore();
  });

  it("should detect closed listing from step memory and return closedListing", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const steps = [
      mockStep({ number: 1, nextGoal: "Navigate to page", url: "https://linkedin.com/jobs/view/123" }),
      mockStep({ number: 2, nextGoal: "Check listing", url: "https://linkedin.com/jobs/view/123", memory: "The page says no longer accepting applications" }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-closed",
      status: "finished",
      output: "Listing closed",
      sessionId: "session-1",
    }, "task-closed", steps));

    const result = await applyToJob("https://linkedin.com/jobs/view/123", mockUserInfo, mockProfileId, undefined, 60);

    expect(result.success).toBe(false);
    expect(result.closedListing).toBe(true);
    expect(result.message).toContain("no longer accepting");
  });

  it("should detect closed listing from agent output after iteration", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-closed-output",
      status: "finished",
      output: "The position has been filled and is no longer available",
      sessionId: "session-1",
      isSuccess: false,
    }, "task-closed-output"));

    const result = await applyToJob("https://linkedin.com/jobs/view/456", mockUserInfo, mockProfileId);

    expect(result.success).toBe(false);
    expect(result.closedListing).toBe(true);
    expect(result.message).toContain("no longer available");
  });

  it("should not trigger stuck detection when steps have actions on same URL", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const sameUrl = "https://example.com/apply-form";
    // 5 steps all on the same URL but all with actions — should NOT trigger stuck
    const steps = [
      mockStep({ number: 1, url: sameUrl, nextGoal: "Open form", actions: ["click apply"] }),
      mockStep({ number: 2, url: sameUrl, nextGoal: "Type name", actions: ["type Khalah"] }),
      mockStep({ number: 3, url: sameUrl, nextGoal: "Type email", actions: ["type email@test.com"] }),
      mockStep({ number: 4, url: sameUrl, nextGoal: "Upload resume", actions: ["upload file"] }),
      mockStep({ number: 5, url: sameUrl, nextGoal: "Review form", actions: ["scroll down"] }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-active-same-url",
      status: "finished",
      output: "Submitted",
      sessionId: "session-1",
      isSuccess: true,
    }, "task-active-same-url", steps));

    const result = await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, undefined, 81);

    expect(result.success).toBe(true);
  });

  it("should log phase transitions during step iteration", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const steps = [
      mockStep({ number: 1, nextGoal: "Navigate to page" }),
      mockStep({ number: 2, nextGoal: "Click Easy Apply" }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-phases",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-phases", steps));

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId);

    const logCalls = logSpy.mock.calls.map(c => c[0] as string);
    const hasStepLog = logCalls.some(msg => msg.includes("Step 1:"));
    expect(hasStepLog).toBe(true);
    logSpy.mockRestore();
  });

  it("should warn on captcha detection during step iteration", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const steps = [
      mockStep({ number: 1, nextGoal: "Solve the CAPTCHA challenge", memory: "CAPTCHA detected" }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-captcha",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-captcha", steps));

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId);

    const warnCalls = warnSpy.mock.calls.map(c => c[0] as string);
    const hasCaptchaWarn = warnCalls.some(msg => msg.includes("CAPTCHA detected"));
    expect(hasCaptchaWarn).toBe(true);
    warnSpy.mockRestore();
  });

  it("should save screenshot on captcha detection when screenshotUrl present", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }));
    const steps = [
      mockStep({ number: 1, nextGoal: "Solve the CAPTCHA challenge", memory: "captcha visible", screenshotUrl: "https://shots.example.com/captcha.png" }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-captcha-shot",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-captcha-shot", steps));

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, undefined, 77);

    // Screenshot saved twice: once for captcha detection, once for normal step processing
    const writeFileCalls = mockWriteFile.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("step-1.png")
    );
    expect(writeFileCalls.length).toBeGreaterThanOrEqual(1);
    vi.mocked(console.warn).mockRestore();
  });

  it("should error out on stuck detection, save screenshot and run summary", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }));
    const sameUrl = "https://example.com/stuck-page";
    // Build 4 steps all at the same URL so the 4th triggers stuck detection (threshold=3)
    const steps = Array.from({ length: 4 }, (_, i) =>
      mockStep({ number: i + 1, url: sameUrl, nextGoal: "Try again", screenshotUrl: `https://shots.example.com/step-${i + 1}.png` })
    );
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-stuck-shot",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-stuck-shot", steps));

    await expect(applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, undefined, 78))
      .rejects.toThrow("Application got stuck");

    // Verify the stuck screenshot was saved (step 4 triggers stuck)
    const screenshotWriteCalls = mockWriteFile.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("step-4.png")
    );
    expect(screenshotWriteCalls.length).toBeGreaterThanOrEqual(1);

    // Verify run summary was saved with failure info
    const summaryWriteCalls = mockWriteFile.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("run-summary.json")
    );
    expect(summaryWriteCalls.length).toBe(1);
    const summaryContent = JSON.parse(summaryWriteCalls[0][1] as string);
    expect(summaryContent.result.success).toBe(false);
    expect(summaryContent.result.message).toContain("got stuck");

    // Verify error was logged
    const errorCalls = errorSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const hasStuckError = errorCalls.some(msg => msg.includes("STUCK"));
    expect(hasStuckError).toBe(true);

    errorSpy.mockRestore();
  });

  it("should save screenshots when screenshotUrl is present in steps", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }));
    const steps = [
      mockStep({ number: 1, screenshotUrl: "https://screenshots.example.com/step1.png" }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-screenshots",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-screenshots", steps));

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, undefined, 99);

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("step-1.png"),
      expect.any(Buffer)
    );
  });

  it("should warn and skip live URL when taskId is not available within timeout", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const originalSetTimeout = globalThis.setTimeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: any) => {
      return originalSetTimeout(fn, 0);
    });

    const mockTaskRun = {
      taskId: null as string | null,
      result: { id: "task-timeout", status: "finished", output: "Done", sessionId: "session-1" },
      then(onFulfilled: (value: Record<string, unknown>) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(this.result).then(onFulfilled, onRejected);
      },
      async *[Symbol.asyncIterator]() {
        // no steps
      },
    };
    mockRun.mockReturnValue(mockTaskRun);

    const onLiveUrlReady = vi.fn();
    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, onLiveUrlReady);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Task ID not available within timeout")
    );
    expect(onLiveUrlReady).not.toHaveBeenCalled();

    vi.mocked(globalThis.setTimeout).mockRestore();
    warnSpy.mockRestore();
  });

  it("should poll for taskId when it starts as null then becomes available", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    const mockTaskRun = {
      taskId: null as string | null,
      result: { id: "task-delayed", status: "finished", output: "Done", sessionId: "session-1" },
      then(onFulfilled: (value: Record<string, unknown>) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(this.result).then(onFulfilled, onRejected);
      },
      async *[Symbol.asyncIterator]() {
        // no steps
      },
    };
    mockRun.mockReturnValue(mockTaskRun);

    mockTasksGet.mockResolvedValue({ sessionId: "session-1" });
    mockSessionsGet.mockResolvedValue({ liveUrl: "https://live.example.com/delayed" });

    let callCount = 0;
    const originalSetTimeout = globalThis.setTimeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: any) => {
      callCount++;
      if (callCount >= 2) {
        mockTaskRun.taskId = "task-delayed";
      }
      return originalSetTimeout(fn, 0);
    });

    const onLiveUrlReady = vi.fn();
    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, onLiveUrlReady);

    expect(onLiveUrlReady).toHaveBeenCalledWith("https://live.example.com/delayed");

    vi.mocked(globalThis.setTimeout).mockRestore();
  });

  it("should fetch and save task log when log URL is available", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    mockTasksLogs.mockResolvedValue({ url: "https://logs.example.com/task-log.txt" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("Task log content here"),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-log-save",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-log-save"));

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, undefined, 88);

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("task-log.txt"),
      "Task log content here"
    );
  });

  it("should handle task log save failure gracefully", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockTasksLogs.mockRejectedValue(new Error("Logs not available"));
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-log-fail",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-log-fail"));

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Error saving task log"));
    errorSpy.mockRestore();
  });

  it("should handle null output in successful result", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-null-output",
      status: "finished",
      output: null,
      sessionId: "session-1",
    }, "task-null-output"));

    const result = await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Application submitted successfully");
  });

  it("should save task log in finally block when taskId is available and logDir is set", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    // This test verifies the finally block's if (logDir) branch.
    // Task stops with a taskId available, so saveTaskLog is called in finally.
    mockTasksLogs.mockResolvedValue({ url: "https://logs.example.com/final-log.txt" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("final log text"),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-finally",
      status: "stopped",
      output: null,
      sessionId: "session-1",
    }, "task-finally"));

    const result = await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, undefined, 100);

    expect(result.success).toBe(false);
    expect(mockTasksLogs).toHaveBeenCalledWith("task-finally");
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("task-log.txt"),
      "final log text"
    );
  });

  it("should treat null result as failure", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const mockTaskRun = {
      taskId: "task-null-result",
      result: null,
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(null).then(onFulfilled, onRejected);
      },
      async *[Symbol.asyncIterator]() {
        // no steps
      },
    };
    mockRun.mockReturnValue(mockTaskRun);

    const result = await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, undefined, 66);

    expect(result.success).toBe(false);
    expect(result.message).toContain("Application failed");
  });

  it("should treat status=finished with null isSuccess as success", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-finished-null",
      status: "finished",
      output: "I completed the task",
      sessionId: "session-1",
      isSuccess: null,
    }, "task-finished-null"));

    const result = await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId);

    expect(result.success).toBe(true);
    expect(result.message).toBe("I completed the task");
  });

  it("should save run summary after successful application", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-summary",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-summary"));

    await applyToJob("https://example.com/jobs/1", mockUserInfo, mockProfileId, undefined, 55);

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("run-summary.json"),
      expect.stringContaining("task-summary")
    );
  });

  it("should fire onSubmissionScreenshotSaved exactly once on first Phase-4 step with a screenshot", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }));

    const steps = [
      mockStep({ number: 1, nextGoal: "Navigate to job page", url: "https://example.com/jobs/1" }),
      mockStep({ number: 2, nextGoal: "Click Easy Apply", url: "https://example.com/apply" }),
      mockStep({ number: 3, nextGoal: "Fill in name field", url: "https://example.com/apply/form", actions: ["type name"] }),
      // First Phase-4 step WITH a screenshot — should fire the callback
      mockStep({ number: 4, nextGoal: "Review every field before submit", url: "https://example.com/apply/review", screenshotUrl: "https://shots.example.com/4.png" }),
      // Second Phase-4 step with another screenshot — must NOT fire again
      mockStep({ number: 5, nextGoal: "Review the form once more", url: "https://example.com/apply/review2", screenshotUrl: "https://shots.example.com/5.png" }),
      // Phase-5 step — must not fire
      mockStep({ number: 6, nextGoal: "Submit the application", url: "https://example.com/apply/submit" }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-cb",
      status: "finished",
      output: "Submitted!",
      sessionId: "session-1",
      isSuccess: true,
    }, "task-cb", steps));

    const onSubmissionScreenshotSaved = vi.fn();
    await applyToJob(
      "https://example.com/jobs/1",
      mockUserInfo,
      mockProfileId,
      undefined,
      100,
      onSubmissionScreenshotSaved,
    );

    expect(onSubmissionScreenshotSaved).toHaveBeenCalledTimes(1);
    expect(onSubmissionScreenshotSaved.mock.calls[0][0]).toContain("step-4.png");
  });

  it("should NOT fire onSubmissionScreenshotSaved when Phase 4 is never reached", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }));

    const steps = [
      mockStep({ number: 1, nextGoal: "Navigate to job page", url: "https://example.com/jobs/1", screenshotUrl: "https://shots.example.com/1.png" }),
      mockStep({ number: 2, nextGoal: "Click Easy Apply", url: "https://example.com/apply", screenshotUrl: "https://shots.example.com/2.png" }),
      mockStep({ number: 3, nextGoal: "Fill in name field", url: "https://example.com/apply/form", actions: ["type name"], screenshotUrl: "https://shots.example.com/3.png" }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-no-phase4",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-no-phase4", steps));

    const onSubmissionScreenshotSaved = vi.fn();
    await applyToJob(
      "https://example.com/jobs/1",
      mockUserInfo,
      mockProfileId,
      undefined,
      101,
      onSubmissionScreenshotSaved,
    );

    expect(onSubmissionScreenshotSaved).not.toHaveBeenCalled();
  });

  it("should NOT fire onSubmissionScreenshotSaved when Phase 4 happens without a screenshot", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    const steps = [
      mockStep({ number: 1, nextGoal: "Navigate to job page", url: "https://example.com/jobs/1" }),
      // Phase-4 step BUT no screenshotUrl — callback must not fire
      mockStep({ number: 2, nextGoal: "Review the form", url: "https://example.com/apply/review" }),
      mockStep({ number: 3, nextGoal: "Submit the application", url: "https://example.com/apply/submit" }),
    ];
    mockRun.mockReturnValue(createMockTaskRun({
      id: "task-no-shot",
      status: "finished",
      output: "Done",
      sessionId: "session-1",
    }, "task-no-shot", steps));

    const onSubmissionScreenshotSaved = vi.fn();
    await applyToJob(
      "https://example.com/jobs/1",
      mockUserInfo,
      mockProfileId,
      undefined,
      102,
      onSubmissionScreenshotSaved,
    );

    expect(onSubmissionScreenshotSaved).not.toHaveBeenCalled();
  });
});
