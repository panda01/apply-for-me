/**
 * React hook that owns the Gmail-sync session lifecycle on the inbox page.
 *
 * Responsibilities:
 *   - On mount, fetches `/api/inbox/scan/active`. If a session is running,
 *     the hook reflects it in `session` + `isRunning` so the page can render
 *     the persistent "Syncing…" state on first paint after a reload.
 *   - While `session.status === "running"`, polls `/api/inbox/scan/:id`
 *     every `pollIntervalMs` (default 1500ms). The poll stops as soon as
 *     the status leaves `running`.
 *   - `start(days)` calls POST /api/inbox/scan. On 409 Conflict, transparently
 *     adopts the existing running session id (so a double-click race in two
 *     tabs ends up watching the same scan instead of erroring).
 *   - When polling observes a `running → succeeded` or `running → failed`
 *     transition, fires the optional `onSettled` callback exactly once with
 *     the final session. The page uses this to pop the result snackbar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getActiveScanSession,
  getScanSession,
  scanInbox,
  ScanAlreadyRunningError,
  type GmailSyncSessionResponse,
} from "../services/inboxApi";

/**
 * Default poll cadence while a scan is running. 1500ms balances perceived
 * responsiveness against polling traffic — the worker writes step
 * transitions far less often than that, so a tighter loop is wasted work.
 */
const DEFAULT_POLL_INTERVAL_MS = 1500;

/**
 * Configuration for {@link useGmailSyncSession}. Both fields are optional;
 * callers that don't pass any can rely on the defaults.
 */
export interface UseGmailSyncSessionOptions {
  /** Poll cadence in milliseconds while a session is `running`. Defaults to 1500. */
  pollIntervalMs?: number;
  /** Fired exactly once when polling observes `running → succeeded/failed`. */
  onSettled?: (finalSession: GmailSyncSessionResponse) => void;
}

/**
 * The shape returned to consumers of the hook.
 */
export interface UseGmailSyncSessionResult {
  /** The current session being tracked, or null when no scan is in flight. */
  session: GmailSyncSessionResponse | null;
  /** True iff `session !== null && session.status === "running"`. */
  isRunning: boolean;
  /** True only during the initial mount-time fetch of /scan/active. */
  isLoading: boolean;
  /** Most recent error message from start()/poll, or null. */
  error: string | null;
  /**
   * Starts a new scan for the given window and begins polling. On 409
   * Conflict (another scan already running), adopts the existing session id.
   *
   * @param {number} days - Lower bound on email received-at, in days back from now
   * @returns {Promise<void>}
   */
  start: (days: number) => Promise<void>;
  /**
   * One-shot re-read of the currently-tracked session. Useful for callers
   * that need the latest snapshot without waiting for the next poll tick.
   *
   * @returns {Promise<void>}
   */
  refresh: () => Promise<void>;
}

/**
 * Hook that fetches the active GmailSyncSession on mount and polls it while
 * it's running. See module header for full behavior contract.
 *
 * @param {UseGmailSyncSessionOptions} [options] - Optional configuration
 * @returns {UseGmailSyncSessionResult} The hook's reactive state + actions
 */
export function useGmailSyncSession(
  options: UseGmailSyncSessionOptions = {}
): UseGmailSyncSessionResult {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const onSettled = options.onSettled;

  const [session, setSession] = useState<GmailSyncSessionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refs (not state) so the polling loop can read the latest values without
  // re-creating the interval on every tick.
  const pollIntervalHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackedSessionIdRef = useRef<number | null>(null);
  const settledFiredForSessionRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  /**
   * Stops the active poll loop if one is running. Idempotent.
   */
  const stopPolling = useCallback((): void => {
    if (pollIntervalHandleRef.current !== null) {
      clearInterval(pollIntervalHandleRef.current);
      pollIntervalHandleRef.current = null;
    }
  }, []);

  /**
   * Fires onSettled at most once per session id. The polling loop calls
   * this whenever a fetched session is non-running; the ref-based guard
   * prevents a "two ticks observed the same finished state" double-fire.
   *
   * @param {GmailSyncSessionResponse} finalSession - The settled session
   */
  const maybeFireSettled = useCallback(
    (finalSession: GmailSyncSessionResponse): void => {
      const alreadyFired = settledFiredForSessionRef.current === finalSession.id;
      if (alreadyFired) {
        return;
      }
      settledFiredForSessionRef.current = finalSession.id;
      if (onSettled !== undefined) {
        onSettled(finalSession);
      }
    },
    [onSettled]
  );

  /**
   * Polls the tracked session id once. When the response shows the session
   * has left `running`, stops the loop and fires onSettled.
   */
  const pollOnce = useCallback(async (): Promise<void> => {
    const sessionIdBeingTracked = trackedSessionIdRef.current;
    if (sessionIdBeingTracked === null) {
      stopPolling();
      return;
    }
    try {
      const fresh = await getScanSession(sessionIdBeingTracked);
      if (!isMountedRef.current) {
        return;
      }
      setSession(fresh);
      const sessionHasSettled = fresh.status !== "running";
      if (sessionHasSettled) {
        stopPolling();
        maybeFireSettled(fresh);
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "polling failed";
      if (isMountedRef.current) {
        setError(errorText);
      }
      // Don't stop polling on transient errors — the next tick may succeed.
      // If the session genuinely vanished (404), the error will keep firing
      // and the caller can surface it.
    }
  }, [maybeFireSettled, stopPolling]);

  /**
   * Sets the tracked session id and (re-)starts the poll interval. Safe to
   * call multiple times — clears any prior interval first.
   *
   * @param {GmailSyncSessionResponse} sessionToTrack - The session to poll
   */
  const beginTracking = useCallback(
    (sessionToTrack: GmailSyncSessionResponse): void => {
      trackedSessionIdRef.current = sessionToTrack.id;
      settledFiredForSessionRef.current = null;
      setSession(sessionToTrack);
      stopPolling();
      const sessionIsAlreadySettled = sessionToTrack.status !== "running";
      if (sessionIsAlreadySettled) {
        maybeFireSettled(sessionToTrack);
        return;
      }
      pollIntervalHandleRef.current = setInterval(() => {
        void pollOnce();
      }, pollIntervalMs);
    },
    [maybeFireSettled, pollIntervalMs, pollOnce, stopPolling]
  );

  /**
   * Reads the currently-tracked session once. No-ops when nothing is being
   * tracked.
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (trackedSessionIdRef.current === null) {
      return;
    }
    await pollOnce();
  }, [pollOnce]);

  /**
   * Starts a new scan. On 409 Conflict, transparently adopts the existing
   * running session so the UI shows the same step indicator without
   * surfacing an error.
   *
   * @param {number} days - Lower bound on email received-at, in days back from now
   */
  const start = useCallback(
    async (days: number): Promise<void> => {
      setError(null);
      try {
        const startResponse = await scanInbox(days);
        const startedSession = await getScanSession(startResponse.sessionId);
        if (!isMountedRef.current) {
          return;
        }
        beginTracking(startedSession);
      } catch (err) {
        if (err instanceof ScanAlreadyRunningError) {
          // Server already had a running session for this connection. If we
          // got a usable id, jump straight to polling it; otherwise fall
          // back to /active.
          const conflictSessionId = err.sessionId;
          const isUsableSessionId = conflictSessionId > 0;
          try {
            const existing = isUsableSessionId
              ? await getScanSession(conflictSessionId)
              : await getActiveScanSession();
            if (!isMountedRef.current) {
              return;
            }
            if (existing !== null) {
              beginTracking(existing);
            }
          } catch (recoveryErr) {
            const errorText =
              recoveryErr instanceof Error
                ? recoveryErr.message
                : "Failed to join running scan";
            if (isMountedRef.current) {
              setError(errorText);
            }
          }
          return;
        }
        const errorText = err instanceof Error ? err.message : "Failed to start scan";
        if (isMountedRef.current) {
          setError(errorText);
        }
      }
    },
    [beginTracking]
  );

  // Mount: fetch the active session (if any) so the UI reflects an
  // in-flight scan on the very first paint after a reload.
  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const active = await getActiveScanSession();
        if (cancelled || !isMountedRef.current) {
          return;
        }
        if (active !== null) {
          beginTracking(active);
        }
      } catch (err) {
        const errorText =
          err instanceof Error ? err.message : "Failed to load active scan session";
        if (!cancelled && isMountedRef.current) {
          setError(errorText);
        }
      } finally {
        if (!cancelled && isMountedRef.current) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      isMountedRef.current = false;
      stopPolling();
    };
    // Intentionally empty deps — mount-only effect. beginTracking and
    // stopPolling are stable refs via useCallback; re-running on every
    // render would refire the /active fetch and is not desired.
  }, []);

  const isRunning = session !== null && session.status === "running";

  return {
    session,
    isRunning,
    isLoading,
    error,
    start,
    refresh,
  };
}
