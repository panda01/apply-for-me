import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the initial value synchronously on first render", () => {
    const { result } = renderHook(() => useDebouncedValue("initial", 300));
    expect(result.current).toBe("initial");
  });

  it("does not emit the new value before the delay elapses", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: "first" },
    });
    rerender({ value: "second" });
    expect(result.current).toBe("first");
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe("first");
  });

  it("emits only the final value when changes occur rapidly within the delay window", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: "a" },
    });
    rerender({ value: "b" });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: "c" });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: "d" });
    expect(result.current).toBe("a");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe("d");
  });

  it("emits the value after the full delay elapses with no further changes", () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "before" },
    });
    rerender({ value: "after" });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe("after");
  });

  it("cancels the pending timer on unmount to avoid setState-on-unmounted warnings", () => {
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: "x" },
    });
    rerender({ value: "y" });
    unmount();
    expect(() => {
      vi.advanceTimersByTime(500);
    }).not.toThrow();
  });
});
