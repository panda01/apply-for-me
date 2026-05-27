import { useEffect, useState } from "react";

/**
 * Returns a value that updates only after `delayMs` has elapsed without
 * `value` changing again. Useful for debouncing user input before firing
 * network requests so the request rate is bounded.
 *
 * The initial value is returned synchronously on first render — the delay
 * only applies to subsequent changes.
 *
 * @template T The type of the value being debounced.
 * @param {T} value - The latest value to debounce.
 * @param {number} delayMs - Milliseconds to wait after the last change
 *   before emitting the new value.
 * @returns {T} The debounced value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
