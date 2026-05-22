import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FetchProgressPanel, {
  colorForStepStatus,
  deriveCurrentStep,
  formatElapsedMmSs,
  isCrashedTerminal,
} from "./FetchProgressPanel";
import {
  ApplicationUrlResolutionOutcome,
  ResolutionPhase,
  StepStatus,
  type LiveProgress,
  type LiveStep,
} from "../services/jobListingsApi";

vi.mock("../services/jobListingsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/jobListingsApi")>();
  return {
    ...actual,
    getLiveUrlResolution: vi.fn(),
  };
});

import { getLiveUrlResolution } from "../services/jobListingsApi";

/**
 * Builds a minimal LiveStep fixture with sane defaults so tests can override
 * only the fields under examination.
 *
 * @param {Partial<LiveStep>} [overrides] - Field overrides
 * @returns {LiveStep} A complete LiveStep fixture
 */
function buildStep(overrides: Partial<LiveStep> = {}): LiveStep {
  return {
    stepIndex: 0,
    phase: ResolutionPhase.BraveSearch,
    status: StepStatus.Running,
    message: "Searching the web",
    payload: {},
    startedAt: "2026-05-22T00:00:00.000Z",
    endedAt: null,
    durationMs: null,
    ...overrides,
  };
}

/**
 * Builds a LiveProgress fixture with sensible defaults.
 *
 * @param {Partial<LiveProgress>} [overrides] - Field overrides
 * @returns {LiveProgress} A complete LiveProgress fixture
 */
function buildProgress(overrides: Partial<LiveProgress> = {}): LiveProgress {
  return {
    logId: 100,
    jobListingId: 1,
    isFinished: false,
    startedAt: "2026-05-22T00:00:00.000Z",
    finishedAt: null,
    steps: [buildStep()],
    finalOutcome: null,
    finalApplicationUrl: null,
    reason: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FetchProgressPanel pure helpers", () => {
  it("colorForStepStatus maps every StepStatus value", () => {
    expect(colorForStepStatus(StepStatus.Running)).toBe("info");
    expect(colorForStepStatus(StepStatus.Succeeded)).toBe("success");
    expect(colorForStepStatus(StepStatus.Failed)).toBe("error");
    expect(colorForStepStatus(StepStatus.Skipped)).toBe("default");
  });

  it("formatElapsedMmSs renders MM:SS zero-padded and clamps negatives to 0", () => {
    expect(formatElapsedMmSs(0)).toBe("00:00");
    expect(formatElapsedMmSs(1_000)).toBe("00:01");
    expect(formatElapsedMmSs(42_000)).toBe("00:42");
    expect(formatElapsedMmSs(62_500)).toBe("01:02");
    expect(formatElapsedMmSs(-500)).toBe("00:00");
  });

  it("deriveCurrentStep returns last step or null", () => {
    expect(deriveCurrentStep(null)).toBeNull();
    expect(deriveCurrentStep(buildProgress({ steps: [] }))).toBeNull();
    const last = buildStep({ stepIndex: 3, message: "last" });
    const result = deriveCurrentStep(buildProgress({ steps: [buildStep({ stepIndex: 0 }), last] }));
    expect(result).toBe(last);
  });

  it("isCrashedTerminal detects only the synthesized terminal payload", () => {
    expect(isCrashedTerminal(null)).toBe(false);
    expect(isCrashedTerminal(buildProgress({ isFinished: false }))).toBe(false);
    expect(isCrashedTerminal(buildProgress({ isFinished: true, finalOutcome: ApplicationUrlResolutionOutcome.ResolvedViaSearch }))).toBe(false);
    expect(isCrashedTerminal(buildProgress({ isFinished: true, finalOutcome: null }))).toBe(true);
  });
});

describe("FetchProgressPanel render branches", () => {
  it("renders nothing when isActive=false", () => {
    render(<FetchProgressPanel jobId={1} isActive={false} sinceLogId={null} onRetry={vi.fn()} />);
    expect(screen.queryByTestId("fetch-progress-panel")).toBeNull();
    expect(getLiveUrlResolution).not.toHaveBeenCalled();
  });

  it("renders nothing when jobId is NaN even with isActive=true", () => {
    render(<FetchProgressPanel jobId={NaN} isActive={true} sinceLogId={null} onRetry={vi.fn()} />);
    expect(screen.queryByTestId("fetch-progress-panel")).toBeNull();
  });

  it("renders the Starting state when getLiveUrlResolution returns null", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(null);
    render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("fetch-progress-starting")).toBeDefined();
    });
    expect(screen.getByTestId("fetch-progress-bar")).toBeDefined();
    expect(screen.queryByTestId("fetch-progress-phase-chip")).toBeNull();
  });

  it("renders the live state with phase chip, step counter, and message", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(buildProgress({
      steps: [
        buildStep({ stepIndex: 0 }),
        buildStep({ stepIndex: 1, phase: ResolutionPhase.AIPageClassify, status: StepStatus.Running, message: "Reading page 2 of 5" }),
      ],
    }));
    render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("fetch-progress-phase-chip")).toBeDefined();
    });
    expect(screen.getByText("Reading candidate pages with AI")).toBeDefined();
    expect(screen.getByTestId("fetch-progress-step-counter").textContent).toContain("Step 2 of 2");
    expect(screen.getByText("Reading page 2 of 5")).toBeDefined();
    expect(screen.getByTestId("fetch-progress-bar")).toBeDefined();
  });

  it("renders the crashed Alert with Retry button when finalOutcome is null", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(buildProgress({
      isFinished: true,
      finalOutcome: null,
      reason: "Container unreachable",
    }));
    const onRetry = vi.fn();
    render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={onRetry} />);
    await waitFor(() => {
      expect(screen.getByTestId("fetch-progress-crashed")).toBeDefined();
    });
    expect(screen.getByText("Container unreachable")).toBeDefined();
    expect(screen.queryByTestId("fetch-progress-bar")).toBeNull();
    expect(screen.getByTestId("fetch-progress-retry-button")).toBeDefined();
  });

  it("falls back to a generic message on a crashed Alert when reason is null", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(buildProgress({
      isFinished: true,
      finalOutcome: null,
      reason: null,
    }));
    render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("The resolver attempt did not finish.")).toBeDefined();
    });
  });

  it("clicking Retry invokes onRetry", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(buildProgress({ isFinished: true, finalOutcome: null, reason: "x" }));
    const onRetry = vi.fn();
    render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={onRetry} />);
    await waitFor(() => {
      expect(screen.getByTestId("fetch-progress-retry-button")).toBeDefined();
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("fetch-progress-retry-button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides the LinearProgress when isFinished and finalOutcome is non-null (terminal non-crashed)", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(buildProgress({
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.ResolvedViaSearch,
    }));
    render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("fetch-progress-phase-chip")).toBeDefined();
    });
    expect(screen.queryByTestId("fetch-progress-bar")).toBeNull();
  });
});

describe("FetchProgressPanel polling lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
  });

  it("polls on the configured interval and stops polling when isActive flips false", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(null);
    let rerenderFn: (ui: ReactElement) => void = () => {};
    await act(async () => {
      const { rerender } = render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={vi.fn()} />);
      rerenderFn = rerender;
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(3);

    await act(async () => {
      rerenderFn(<FetchProgressPanel jobId={1} isActive={false} sinceLogId={null} onRetry={vi.fn()} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(3);
  });

  it("stops polling on unmount", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(null);
    let unmountFn: () => void = () => {};
    await act(async () => {
      const { unmount } = render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={vi.fn()} />);
      unmountFn = unmount;
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(1);

    await act(async () => { unmountFn(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(1);
  });

  it("stops the poll interval on terminal non-crashed payload but keeps the panel rendered", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(buildProgress({
      isFinished: true,
      finalOutcome: ApplicationUrlResolutionOutcome.ResolvedViaSearch,
    }));
    await act(async () => {
      render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={vi.fn()} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByTestId("fetch-progress-panel")).toBeDefined();
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(1);
  });

  it("elapsed-time counter advances at the tick interval", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(null);
    await act(async () => {
      render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={vi.fn()} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("fetch-progress-elapsed").textContent).toBe("00:00");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByTestId("fetch-progress-elapsed").textContent).toBe("00:01");
    await act(async () => { await vi.advanceTimersByTimeAsync(41_000); });
    expect(screen.getByTestId("fetch-progress-elapsed").textContent).toBe("00:42");
  });
});

describe("FetchProgressPanel sinceLogId stale-payload filtering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
  });

  it("ignores payloads whose logId <= sinceLogId (panel stays in Starting state)", async () => {
    vi.mocked(getLiveUrlResolution).mockResolvedValue(buildProgress({
      logId: 50,
      isFinished: true,
      finalOutcome: null,
      reason: "stale crash",
    }));
    await act(async () => {
      render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={50} onRetry={vi.fn()} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getLiveUrlResolution).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("fetch-progress-starting")).toBeDefined();
    expect(screen.queryByTestId("fetch-progress-crashed")).toBeNull();
  });

  it("transitions to live state when a payload with logId > sinceLogId arrives", async () => {
    vi.mocked(getLiveUrlResolution)
      .mockResolvedValueOnce(buildProgress({ logId: 50, isFinished: true, finalOutcome: null, reason: "stale" }))
      .mockResolvedValue(buildProgress({ logId: 51, isFinished: false, steps: [buildStep({ phase: ResolutionPhase.BraveSearch })] }));
    await act(async () => {
      render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={50} onRetry={vi.fn()} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("fetch-progress-starting")).toBeDefined();

    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByTestId("fetch-progress-phase-chip")).toBeDefined();
    expect(screen.queryByTestId("fetch-progress-starting")).toBeNull();
  });
});

describe("FetchProgressPanel fetch errors", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
  });

  it("silently swallows non-404 fetch errors and keeps prior render visible", async () => {
    vi.mocked(getLiveUrlResolution)
      .mockResolvedValueOnce(buildProgress({ steps: [buildStep({ phase: ResolutionPhase.BraveSearch, message: "first" })] }))
      .mockRejectedValueOnce(new Error("transient"));
    await act(async () => {
      render(<FetchProgressPanel jobId={1} isActive={true} sinceLogId={null} onRetry={vi.fn()} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("first")).toBeDefined();

    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByText("first")).toBeDefined();
    expect(screen.queryByText("transient")).toBeNull();
  });
});
