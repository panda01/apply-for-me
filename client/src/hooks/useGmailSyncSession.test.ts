import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const {
  getActiveScanSessionMock,
  getScanSessionMock,
  scanInboxMock,
} = vi.hoisted(() => ({
  getActiveScanSessionMock: vi.fn(),
  getScanSessionMock: vi.fn(),
  scanInboxMock: vi.fn(),
}));

vi.mock("../services/inboxApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/inboxApi")>();
  return {
    ...actual,
    getActiveScanSession: getActiveScanSessionMock,
    getScanSession: getScanSessionMock,
    scanInbox: scanInboxMock,
  };
});

import { useGmailSyncSession } from "./useGmailSyncSession";
import { ScanAlreadyRunningError } from "../services/inboxApi";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Builds a session-shaped fixture used by the hook's mocked endpoints.
 *
 * @param {Record<string, unknown>} overrides - Fields to override
 * @returns {Record<string, unknown>} A GmailSyncSessionResponse-shaped object
 */
function buildSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    gmailConnectionId: 1,
    status: "running",
    currentStep: null,
    startedAt: "2026-05-27T12:00:00.000Z",
    finishedAt: null,
    daysRequested: 14,
    lastError: null,
    result: null,
    logs: [],
    ...overrides,
  };
}

describe("useGmailSyncSession", () => {
  it("returns no running session on mount when /active is null", async () => {
    getActiveScanSessionMock.mockResolvedValue(null);
    const { result } = renderHook(() => useGmailSyncSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isRunning).toBe(false);
    expect(result.current.session).toBeNull();
  });

  it("reflects a running session on mount when /active returns one", async () => {
    getActiveScanSessionMock.mockResolvedValue(buildSession({ status: "running" }));
    const { result } = renderHook(() => useGmailSyncSession());
    await waitFor(() => expect(result.current.isRunning).toBe(true));
    expect(result.current.session?.status).toBe("running");
  });

  it("start(days) calls scanInbox, then polls getScanSession until succeeded, then fires onSettled", async () => {
    getActiveScanSessionMock.mockResolvedValue(null);
    scanInboxMock.mockResolvedValue({ sessionId: 5, status: "running", reused: false });
    const runningSession = buildSession({ id: 5, status: "running", currentStep: "fetching_emails" });
    const succeededSession = buildSession({
      id: 5,
      status: "succeeded",
      currentStep: null,
      finishedAt: "2026-05-27T12:00:30.000Z",
      result: { scanned: 4, found: 2, newDiscoveries: 1 },
    });
    // First getScanSession is the post-start read; subsequent calls are polling.
    getScanSessionMock
      .mockResolvedValueOnce(runningSession)
      .mockResolvedValue(succeededSession);

    vi.useFakeTimers();
    const onSettled = vi.fn();
    const { result } = renderHook(() => useGmailSyncSession({ pollIntervalMs: 50, onSettled }));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.start(14);
    });
    expect(scanInboxMock).toHaveBeenCalledWith(14);
    expect(result.current.isRunning).toBe(true);

    // Advance fake timers to trigger one poll tick.
    await act(async () => {
      vi.advanceTimersByTime(60);
      // Flush pending microtasks created by the timer's async callback.
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
    expect((onSettled.mock.calls[0]?.[0] as { status: string }).status).toBe("succeeded");
    expect(result.current.isRunning).toBe(false);
  });

  it("transparently joins an existing scan when scanInbox throws ScanAlreadyRunningError", async () => {
    getActiveScanSessionMock.mockResolvedValue(null);
    scanInboxMock.mockRejectedValue(new ScanAlreadyRunningError(42));
    const existingSession = buildSession({ id: 42, status: "running" });
    getScanSessionMock.mockResolvedValue(existingSession);

    const { result } = renderHook(() => useGmailSyncSession({ pollIntervalMs: 9999 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start(7);
    });
    expect(getScanSessionMock).toHaveBeenCalledWith(42);
    expect(result.current.session?.id).toBe(42);
    expect(result.current.isRunning).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("falls back to /active when the 409 body had no sessionId", async () => {
    getActiveScanSessionMock.mockResolvedValueOnce(null);
    scanInboxMock.mockRejectedValue(new ScanAlreadyRunningError(0));
    const recoveredSession = buildSession({ id: 100, status: "running" });
    getActiveScanSessionMock.mockResolvedValueOnce(recoveredSession);

    const { result } = renderHook(() => useGmailSyncSession({ pollIntervalMs: 9999 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start(7);
    });
    expect(result.current.session?.id).toBe(100);
  });

  it("sets error when scanInbox rejects with a non-409 error", async () => {
    getActiveScanSessionMock.mockResolvedValue(null);
    scanInboxMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useGmailSyncSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start(7);
    });
    expect(result.current.error).toBe("boom");
    expect(result.current.isRunning).toBe(false);
  });

  it("falls back to 'Failed to start scan' on non-Error scanInbox rejection", async () => {
    getActiveScanSessionMock.mockResolvedValue(null);
    scanInboxMock.mockRejectedValue({ random: "object" });

    const { result } = renderHook(() => useGmailSyncSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start(7);
    });
    expect(result.current.error).toBe("Failed to start scan");
  });

  it("sets error during 409 recovery when joining the existing session fails", async () => {
    getActiveScanSessionMock.mockResolvedValueOnce(null);
    scanInboxMock.mockRejectedValue(new ScanAlreadyRunningError(42));
    getScanSessionMock.mockRejectedValue(new Error("recovery boom"));

    const { result } = renderHook(() => useGmailSyncSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start(7);
    });
    expect(result.current.error).toBe("recovery boom");
  });

  it("falls back to 'Failed to join running scan' on a non-Error 409 recovery rejection", async () => {
    getActiveScanSessionMock.mockResolvedValueOnce(null);
    scanInboxMock.mockRejectedValue(new ScanAlreadyRunningError(42));
    getScanSessionMock.mockRejectedValue("recovery-not-error");

    const { result } = renderHook(() => useGmailSyncSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start(7);
    });
    expect(result.current.error).toBe("Failed to join running scan");
  });

  it("sets error when the initial /active fetch rejects", async () => {
    getActiveScanSessionMock.mockRejectedValue(new Error("active-failed"));

    const { result } = renderHook(() => useGmailSyncSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("active-failed");
  });

  it("falls back to 'Failed to load active scan session' on a non-Error initial fetch rejection", async () => {
    getActiveScanSessionMock.mockRejectedValue("not-an-error-value");

    const { result } = renderHook(() => useGmailSyncSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Failed to load active scan session");
  });

  it("refresh() is a no-op when nothing is tracked", async () => {
    getActiveScanSessionMock.mockResolvedValue(null);
    const { result } = renderHook(() => useGmailSyncSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Should not throw, should not call getScanSession.
    await act(async () => {
      await result.current.refresh();
    });
    expect(getScanSessionMock).not.toHaveBeenCalled();
  });

  it("refresh() reads the currently-tracked session once when something is being tracked", async () => {
    const sessionRunning = buildSession({ id: 5, status: "running" });
    getActiveScanSessionMock.mockResolvedValue(sessionRunning);
    getScanSessionMock.mockResolvedValue(sessionRunning);

    const { result } = renderHook(() => useGmailSyncSession({ pollIntervalMs: 9999 }));
    await waitFor(() => expect(result.current.isRunning).toBe(true));

    const callsBeforeRefresh = getScanSessionMock.mock.calls.length;
    await act(async () => {
      await result.current.refresh();
    });
    expect(getScanSessionMock.mock.calls.length).toBe(callsBeforeRefresh + 1);
  });

  it("fires onSettled immediately when the started session is already non-running", async () => {
    getActiveScanSessionMock.mockResolvedValue(null);
    scanInboxMock.mockResolvedValue({ sessionId: 5, status: "running", reused: false });
    const succeededImmediately = buildSession({
      id: 5,
      status: "succeeded",
      result: { scanned: 0, found: 0, newDiscoveries: 0 },
    });
    getScanSessionMock.mockResolvedValue(succeededImmediately);

    const onSettled = vi.fn();
    const { result } = renderHook(() => useGmailSyncSession({ onSettled }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start(7);
    });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(result.current.isRunning).toBe(false);
  });

  it("works without an onSettled callback (no-throw when one is not provided)", async () => {
    getActiveScanSessionMock.mockResolvedValue(null);
    scanInboxMock.mockResolvedValue({ sessionId: 6, status: "running", reused: false });
    const succeededImmediately = buildSession({ id: 6, status: "succeeded" });
    getScanSessionMock.mockResolvedValue(succeededImmediately);

    // No onSettled option — the hook must still not throw when polling settles.
    const { result } = renderHook(() => useGmailSyncSession());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start(7);
    });
    expect(result.current.isRunning).toBe(false);
  });

  it("guards against onSettled double-fire across multiple poll observations", async () => {
    const settledSession = buildSession({ id: 9, status: "succeeded" });
    getActiveScanSessionMock.mockResolvedValue(settledSession);
    getScanSessionMock.mockResolvedValue(settledSession);

    const onSettled = vi.fn();
    renderHook(() => useGmailSyncSession({ onSettled }));
    await vi.waitFor(() => {
      expect(onSettled).toHaveBeenCalledTimes(1);
    });
    // Already-settled session on mount should fire exactly once; the hook
    // marks the session id as fired so a re-render or refresh cannot
    // double-invoke the callback.
  });

  it("recovers gracefully when a poll tick fails (does not stop the loop)", async () => {
    getActiveScanSessionMock.mockResolvedValue(buildSession({ id: 5, status: "running" }));
    // First poll fails; the hook should keep the loop alive and the session as-is.
    getScanSessionMock.mockRejectedValue(new Error("transient failure"));

    vi.useFakeTimers();
    const { result } = renderHook(() => useGmailSyncSession({ pollIntervalMs: 50 }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(60);
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(result.current.error).toBe("transient failure");
    });
    // Session unchanged — the hook didn't clear it.
    expect(result.current.session?.id).toBe(5);
  });
});
