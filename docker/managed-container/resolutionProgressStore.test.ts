import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  begin,
  recordStep,
  finalize,
  get,
  clear,
  clearAll,
} from "./resolutionProgressStore.js";
import {
  ResolutionPhase,
  StepStatus,
  ApplicationUrlResolutionOutcome,
} from "./resolutionTypes.js";

beforeEach(() => {
  clearAll();
});

afterEach(() => {
  clearAll();
  vi.useRealTimers();
});

describe("begin", () => {
  it("creates an entry with isFinished=false and an empty steps array", () => {
    begin(42, 7);
    const progress = get(42);
    expect(progress).not.toBeNull();
    expect(progress?.logId).toBe(42);
    expect(progress?.jobListingId).toBe(7);
    expect(progress?.isFinished).toBe(false);
    expect(progress?.steps).toEqual([]);
  });

  it("replaces any prior entry for the same logId", () => {
    begin(42, 7);
    recordStep(42, {
      stepIndex: 0,
      phase: ResolutionPhase.DirectCheck,
      status: StepStatus.Running,
      message: "first run",
      payload: {},
      startedAt: "2026-05-18T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
    });
    begin(42, 8); // second attempt — should reset
    const progress = get(42);
    expect(progress?.jobListingId).toBe(8);
    expect(progress?.steps).toEqual([]);
  });
});

describe("recordStep", () => {
  it("appends a new step when the index is unseen", () => {
    begin(42, 7);
    recordStep(42, {
      stepIndex: 0,
      phase: ResolutionPhase.BraveSearch,
      status: StepStatus.Running,
      message: "starting",
      payload: { query: "Acme" },
      startedAt: "2026-05-18T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
    });
    expect(get(42)?.steps).toHaveLength(1);
  });

  it("overwrites in place when an existing stepIndex is sent again", () => {
    begin(42, 7);
    const baseStep = {
      stepIndex: 0,
      phase: ResolutionPhase.BraveSearch,
      message: "starting",
      payload: {},
      startedAt: "2026-05-18T00:00:00.000Z",
    };
    recordStep(42, { ...baseStep, status: StepStatus.Running, endedAt: null, durationMs: null });
    recordStep(42, { ...baseStep, status: StepStatus.Succeeded, endedAt: "2026-05-18T00:00:02.000Z", durationMs: 2000, message: "done" });
    const steps = get(42)?.steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe(StepStatus.Succeeded);
    expect(steps[0].durationMs).toBe(2000);
    expect(steps[0].message).toBe("done");
  });

  it("synthesizes a placeholder progress entry when called before begin", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* swallow */ });
    recordStep(99, {
      stepIndex: 0,
      phase: ResolutionPhase.Finalize,
      status: StepStatus.Running,
      message: "orphan",
      payload: {},
      startedAt: "2026-05-18T00:00:00.000Z",
      endedAt: null,
      durationMs: null,
    });
    const progress = get(99);
    expect(progress).not.toBeNull();
    expect(progress?.jobListingId).toBe(-1);
    expect(progress?.steps).toHaveLength(1);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringMatching(/synthesizing placeholder/));
    consoleWarnSpy.mockRestore();
  });
});

describe("finalize", () => {
  it("flips isFinished and populates the terminal fields", () => {
    begin(42, 7);
    finalize(42, ApplicationUrlResolutionOutcome.ResolvedViaSearch, "https://acme.com/jobs/1", null);
    const progress = get(42);
    expect(progress?.isFinished).toBe(true);
    expect(progress?.finalOutcome).toBe(ApplicationUrlResolutionOutcome.ResolvedViaSearch);
    expect(progress?.finalApplicationUrl).toBe("https://acme.com/jobs/1");
    expect(progress?.finishedAt).not.toBeNull();
  });

  it("accepts a null finalOutcome (crashed terminal state)", () => {
    begin(42, 7);
    finalize(42, null, null, "crashed");
    const progress = get(42);
    expect(progress?.finalOutcome).toBeNull();
    expect(progress?.reason).toBe("crashed");
  });

  it("schedules an eviction after the TTL", () => {
    vi.useFakeTimers();
    begin(42, 7);
    finalize(42, ApplicationUrlResolutionOutcome.NotFound, null, "no match");
    expect(get(42)).not.toBeNull();
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(get(42)).toBeNull();
  });

  it("warns and ignores when called for an unknown logId", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* swallow */ });
    finalize(404, ApplicationUrlResolutionOutcome.NotFound, null, null);
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringMatching(/finalize for unknown logId/));
    consoleWarnSpy.mockRestore();
  });

  it("re-begin clears a pending eviction timer", () => {
    vi.useFakeTimers();
    begin(42, 7);
    finalize(42, ApplicationUrlResolutionOutcome.NotFound, null, null);
    begin(42, 7); // should clear the eviction timer scheduled above
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    // Entry still present because the second begin reset the timer to nothing.
    expect(get(42)).not.toBeNull();
  });
});

describe("get and clear", () => {
  it("returns null for an unknown logId", () => {
    expect(get(999)).toBeNull();
  });

  it("clear() removes the entry and cancels its timer", () => {
    vi.useFakeTimers();
    begin(42, 7);
    finalize(42, ApplicationUrlResolutionOutcome.Direct, "https://a.com", null);
    clear(42);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(get(42)).toBeNull();
  });

  it("clearAll() drops every entry", () => {
    begin(1, 1);
    begin(2, 2);
    clearAll();
    expect(get(1)).toBeNull();
    expect(get(2)).toBeNull();
  });
});
