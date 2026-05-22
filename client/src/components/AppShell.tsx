import { useState, useEffect, useCallback } from "react";
import type { ReactNode, ReactElement } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

/**
 * The two valid sidebar states. `expanded` shows the sidebar at full width with labels;
 * `collapsed` shows the icon-only narrow rail.
 */
type SidebarState = "expanded" | "collapsed";

/** localStorage key used to persist the user's preferred sidebar state across reloads. */
const SIDEBAR_STORAGE_KEY = "afm:sidebar";

/**
 * Props for the AppShell component.
 * @property {ReactNode} children - The routed page content rendered inside the main column's scrolling area.
 */
interface AppShellProps {
  children: ReactNode;
}

/**
 * Read the persisted sidebar state from localStorage, falling back to "expanded"
 * when storage is unavailable (SSR, private mode, etc.) or holds an invalid value.
 *
 * @returns {SidebarState} The initial sidebar state to use on mount.
 */
function readInitialSidebarState(): SidebarState {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return "expanded";
  }
  const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (stored === "expanded" || stored === "collapsed") {
    return stored;
  }
  return "expanded";
}

/**
 * AppShell — the top-level layout wrapper for the authenticated app surface.
 *
 * Renders the two-column grid (sidebar + main column). The main column hosts the
 * Topbar plus a scrolling content region into which the routed page is injected
 * via `children`. The component owns the sidebar collapse state, persisting it
 * to localStorage under the key {@link SIDEBAR_STORAGE_KEY} so the user's
 * preference survives page reloads.
 *
 * The Sidebar component is rendered as a sibling — AppShell does not pass it any
 * collapse-related props; the global CSS keyed off `data-sidebar` on the outer
 * `.app` element handles the visual collapse animation.
 *
 * @param {AppShellProps} props - Component props (see {@link AppShellProps}).
 * @returns {ReactElement} The app shell layout.
 */
function AppShell({ children }: AppShellProps): ReactElement {
  const [sidebarState, setSidebarState] = useState<SidebarState>(readInitialSidebarState);

  // Persist sidebar state on change so reloads restore the user's preference.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return;
    }
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarState);
  }, [sidebarState]);

  /**
   * Toggle the sidebar between expanded and collapsed.
   * Passed down to Topbar's sidebar-toggle icon button.
   */
  const handleToggleSidebar = useCallback(() => {
    setSidebarState((previousState) => (previousState === "expanded" ? "collapsed" : "expanded"));
  }, []);

  return (
    <div className="app" data-sidebar={sidebarState}>
      <Sidebar />
      <main className="main">
        <Topbar onToggleSidebar={handleToggleSidebar} />
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export default AppShell;
