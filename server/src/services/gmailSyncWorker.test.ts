import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getFirstConnectionIdMock,
  runScanWorkInlineMock,
  transitionStepMock,
  finishSucceededMock,
  finishFailedMock,
  getLastSucceededSessionMock,
  loggerLogMock,
  loggerErrorMock,
  createSyncLoggerMock,
} = vi.hoisted(() => ({
  getFirstConnectionIdMock: vi.fn(),
  runScanWorkInlineMock: vi.fn(),
  transitionStepMock: vi.fn(),
  finishSucceededMock: vi.fn(),
  finishFailedMock: vi.fn(),
  getLastSucceededSessionMock: vi.fn(),
  loggerLogMock: vi.fn().mockResolvedValue(undefined),
  loggerErrorMock: vi.fn().mockResolvedValue(undefined),
  createSyncLoggerMock: vi.fn(),
}));

vi.mock("./gmailMessageReaderService.js", () => ({
  getFirstConnectionId: getFirstConnectionIdMock,
}));

vi.mock("./discoveredJobsService.js", () => ({
  runScanWorkInline: runScanWorkInlineMock,
}));

vi.mock("./gmailSyncSessionService.js", () => ({
  transitionStep: transitionStepMock,
  finishSucceeded: finishSucceededMock,
  finishFailed: finishFailedMock,
  getLastSucceededSession: getLastSucceededSessionMock,
}));

vi.mock("./syncLogger.js", () => ({
  createSyncLogger: createSyncLoggerMock,
}));

import { startScanWorker } from "./gmailSyncWorker.js";

beforeEach(() => {
  vi.clearAllMocks();
  createSyncLoggerMock.mockReturnValue({ log: loggerLogMock, error: loggerErrorMock });
  loggerLogMock.mockResolvedValue(undefined);
  loggerErrorMock.mockResolvedValue(undefined);
  // Default: no prior successful scan exists, so happy-path tests fall
  // through to the period-window fallback.
  getLastSucceededSessionMock.mockResolvedValue(null);
});

describe("startScanWorker — happy path", () => {
  it("transitions through fetching_emails → finding_jobs → saving_jobs in order and finishes succeeded", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    const scanResult = { scanned: 4, found: 3, newDiscoveries: 2 };
    runScanWorkInlineMock.mockResolvedValue(scanResult);

    await startScanWorker(99, 7);

    const transitionOrder = transitionStepMock.mock.calls.map((call) => call[1] as string);
    expect(transitionOrder).toEqual(["fetching_emails", "finding_jobs", "saving_jobs"]);
    expect(transitionStepMock.mock.calls.every((call) => (call[0] as number) === 99)).toBe(true);

    expect(runScanWorkInlineMock).toHaveBeenCalledTimes(1);
    const inlineArgs = runScanWorkInlineMock.mock.calls[0]?.[0] as {
      connectionId: number;
      sinceDate: Date;
      logger: unknown;
    };
    expect(inlineArgs.connectionId).toBe(1);
    expect(inlineArgs.sinceDate).toBeInstanceOf(Date);
    expect(inlineArgs.logger).toBeDefined();

    expect(finishSucceededMock).toHaveBeenCalledWith(99, scanResult);
    expect(finishFailedMock).not.toHaveBeenCalled();
  });

  it("emits at least one info log line per step", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    runScanWorkInlineMock.mockResolvedValue({ scanned: 0, found: 0, newDiscoveries: 0 });

    await startScanWorker(99, 7);

    const stepsLogged = loggerLogMock.mock.calls.map((call) => call[0] as string | null);
    expect(stepsLogged).toContain("fetching_emails");
    expect(stepsLogged).toContain("finding_jobs");
    expect(stepsLogged).toContain("saving_jobs");
  });
});

describe("startScanWorker — incremental sinceDate", () => {
  it("uses the period window when no prior successful scan exists", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    getLastSucceededSessionMock.mockResolvedValue(null);
    runScanWorkInlineMock.mockResolvedValue({ scanned: 0, found: 0, newDiscoveries: 0 });

    const beforeStart = Date.now();
    await startScanWorker(100, 7);
    const afterStart = Date.now();

    const inlineArgs = runScanWorkInlineMock.mock.calls[0]?.[0] as { sinceDate: Date };
    const sinceMs = inlineArgs.sinceDate.getTime();
    // 7 days back from "now" — confirm the value falls inside [now-7d - small slack, now-7d + small slack].
    const sevenDaysMs = 7 * 86400 * 1000;
    expect(sinceMs).toBeGreaterThanOrEqual(beforeStart - sevenDaysMs - 50);
    expect(sinceMs).toBeLessThanOrEqual(afterStart - sevenDaysMs + 50);

    // Strategy logged is period_window when no prior succeeded session.
    const fetchingLogs = loggerLogMock.mock.calls.filter(
      (call) =>
        call[0] === "fetching_emails" &&
        typeof call[1] === "string" &&
        (call[1] as string).startsWith("Fetching emails after ")
    );
    const detail = fetchingLogs[0]?.[2] as { syncStrategy: string };
    expect(detail.syncStrategy).toBe("period_window");
  });

  it("uses periodSinceDate with strategy=backfill when the user picks a wider window than the prior succeeded scan", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    const previousStartedAt = new Date(Date.now() - 3 * 3600 * 1000); // 3 hours ago
    getLastSucceededSessionMock.mockResolvedValue({
      id: 50,
      gmailConnectionId: 1,
      status: "succeeded",
      currentStep: null,
      startedAt: previousStartedAt.toISOString(),
      finishedAt: new Date(Date.now() - 3 * 3600 * 1000 + 60_000).toISOString(),
      daysRequested: 7,
      lastError: null,
      result: { scanned: 5, found: 3, newDiscoveries: 2 },
      logs: [],
    });
    runScanWorkInlineMock.mockResolvedValue({ scanned: 0, found: 0, newDiscoveries: 0 });

    const beforeStart = Date.now();
    await startScanWorker(101, 14); // user picks "Last 2 weeks" but prior scan was 3h ago — period is WIDER → backfill
    const afterStart = Date.now();

    const inlineArgs = runScanWorkInlineMock.mock.calls[0]?.[0] as { sinceDate: Date };
    const sinceMs = inlineArgs.sinceDate.getTime();
    // sinceDate should be the periodSinceDate (14 days ago), not the prior scan's startedAt.
    const fourteenDaysMs = 14 * 86400 * 1000;
    expect(sinceMs).toBeGreaterThanOrEqual(beforeStart - fourteenDaysMs - 50);
    expect(sinceMs).toBeLessThanOrEqual(afterStart - fourteenDaysMs + 50);

    const fetchingLogs = loggerLogMock.mock.calls.filter(
      (call) =>
        call[0] === "fetching_emails" &&
        typeof call[1] === "string" &&
        (call[1] as string).startsWith("Fetching emails after ")
    );
    const detail = fetchingLogs[0]?.[2] as {
      syncStrategy: string;
      previousSucceededSessionId: number | null;
    };
    expect(detail.syncStrategy).toBe("backfill");
    expect(detail.previousSucceededSessionId).toBe(50);
  });

  it("renders the since-date as a human-readable ISO timestamp in the log message body", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    getLastSucceededSessionMock.mockResolvedValue(null);
    runScanWorkInlineMock.mockResolvedValue({ scanned: 0, found: 0, newDiscoveries: 0 });

    await startScanWorker(103, 7);

    const fetchingMessages = loggerLogMock.mock.calls
      .filter((call) => call[0] === "fetching_emails")
      .map((call) => call[1] as string);
    const fetchingAfterLine = fetchingMessages.find((message) =>
      message.startsWith("Fetching emails after ")
    );
    expect(fetchingAfterLine).toBeDefined();
    // Message must include a parseable ISO 8601 timestamp + the strategy.
    expect(fetchingAfterLine).toMatch(
      /Fetching emails after \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \(strategy=period_window\)/
    );
  });

  it("uses lastSucceeded.startedAt with strategy=incremental when user's period is narrower than the gap to the prior scan", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    const previousStartedAt = new Date(Date.now() - 30 * 86400 * 1000); // 30 days ago
    getLastSucceededSessionMock.mockResolvedValue({
      id: 51,
      gmailConnectionId: 1,
      status: "succeeded",
      currentStep: null,
      startedAt: previousStartedAt.toISOString(),
      finishedAt: previousStartedAt.toISOString(),
      daysRequested: 30,
      lastError: null,
      result: null,
      logs: [],
    });
    runScanWorkInlineMock.mockResolvedValue({ scanned: 0, found: 0, newDiscoveries: 0 });

    await startScanWorker(102, 1); // user picks "Last day" — period is narrower than the 30-day gap → incremental

    const inlineArgs = runScanWorkInlineMock.mock.calls[0]?.[0] as { sinceDate: Date };
    // sinceDate must be anchored to the prior succeeded scan's startedAt.
    expect(inlineArgs.sinceDate.toISOString()).toBe(previousStartedAt.toISOString());

    const fetchingLogs = loggerLogMock.mock.calls.filter(
      (call) =>
        call[0] === "fetching_emails" &&
        typeof call[1] === "string" &&
        (call[1] as string).startsWith("Fetching emails after ")
    );
    const detail = fetchingLogs[0]?.[2] as {
      syncStrategy: string;
      previousSucceededSessionId: number | null;
    };
    expect(detail.syncStrategy).toBe("incremental");
    expect(detail.previousSucceededSessionId).toBe(51);
  });

  it("uses periodSinceDate with strategy=backfill when user picks a window older than the prior succeeded scan", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    const previousStartedAt = new Date(Date.now() - 3 * 86400 * 1000); // 3 days ago
    getLastSucceededSessionMock.mockResolvedValue({
      id: 52,
      gmailConnectionId: 1,
      status: "succeeded",
      currentStep: null,
      startedAt: previousStartedAt.toISOString(),
      finishedAt: previousStartedAt.toISOString(),
      daysRequested: 3,
      lastError: null,
      result: null,
      logs: [],
    });
    runScanWorkInlineMock.mockResolvedValue({ scanned: 0, found: 0, newDiscoveries: 0 });

    const beforeStart = Date.now();
    await startScanWorker(104, 30); // user picks "Last 30 days" — period is WIDER than 3-day gap → backfill
    const afterStart = Date.now();

    const inlineArgs = runScanWorkInlineMock.mock.calls[0]?.[0] as { sinceDate: Date };
    const sinceMs = inlineArgs.sinceDate.getTime();
    // sinceDate should be approximately 30 days ago (the periodSinceDate), not 3 days ago.
    const thirtyDaysMs = 30 * 86400 * 1000;
    expect(sinceMs).toBeGreaterThanOrEqual(beforeStart - thirtyDaysMs - 50);
    expect(sinceMs).toBeLessThanOrEqual(afterStart - thirtyDaysMs + 50);

    const fetchingLogs = loggerLogMock.mock.calls.filter(
      (call) =>
        call[0] === "fetching_emails" &&
        typeof call[1] === "string" &&
        (call[1] as string).startsWith("Fetching emails after ")
    );
    const detail = fetchingLogs[0]?.[2] as {
      syncStrategy: string;
      previousSucceededSessionId: number | null;
    };
    expect(detail.syncStrategy).toBe("backfill");
    expect(detail.previousSucceededSessionId).toBe(52);
  });
});

describe("startScanWorker — failure paths", () => {
  it("calls finishFailed when getFirstConnectionId throws", async () => {
    getFirstConnectionIdMock.mockRejectedValue(new Error("No Gmail account connected"));

    await startScanWorker(50, 14);

    expect(finishFailedMock).toHaveBeenCalledWith(50, "No Gmail account connected");
    expect(finishSucceededMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  it("calls finishFailed when runScanWorkInline throws", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    runScanWorkInlineMock.mockRejectedValue(new Error("Claude API timeout"));

    await startScanWorker(51, 14);

    expect(finishFailedMock).toHaveBeenCalledWith(51, "Claude API timeout");
  });

  it("never throws to its caller (fire-and-forget contract)", async () => {
    getFirstConnectionIdMock.mockRejectedValue(new Error("boom"));
    // The route invokes this as `void startScanWorker(...)` — it must never
    // reject so an unhandled rejection can't crash the Node process.
    await expect(startScanWorker(52, 14)).resolves.toBeUndefined();
  });

  it("survives a finishFailed throwing (e.g. row deleted mid-scan)", async () => {
    getFirstConnectionIdMock.mockRejectedValue(new Error("boom"));
    finishFailedMock.mockRejectedValue(new Error("row deleted"));
    await expect(startScanWorker(53, 14)).resolves.toBeUndefined();
  });

  it("survives logger.error throwing inside the catch branch", async () => {
    getFirstConnectionIdMock.mockRejectedValue(new Error("inside-error"));
    loggerErrorMock.mockRejectedValue(new Error("logger died"));
    // The worker's catch path attaches .catch() on the logger.error promise
    // so a failing logger never masks the original error path.
    await expect(startScanWorker(54, 14)).resolves.toBeUndefined();
    expect(finishFailedMock).toHaveBeenCalledWith(54, "inside-error");
  });

  it("stringifies non-Error throws when finalizing as failed", async () => {
    getFirstConnectionIdMock.mockRejectedValue("string-not-error");
    await startScanWorker(55, 14);
    expect(finishFailedMock).toHaveBeenCalledWith(55, "string-not-error");
  });
});
