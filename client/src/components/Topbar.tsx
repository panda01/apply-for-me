import type { ReactElement } from "react";
import { useLocation } from "react-router-dom";
import IconButton from "@mui/material/IconButton";
import {
  ViewSidebarOutlined,
  SearchOutlined,
  NotificationsOutlined,
} from "@mui/icons-material";

/**
 * Props for the Topbar component.
 * @property {() => void} onToggleSidebar - Handler invoked when the sidebar toggle icon button is clicked. Owner (AppShell) flips between expanded/collapsed sidebar state.
 */
interface TopbarProps {
  onToggleSidebar: () => void;
}

/**
 * Map a current route's pathname to the page title shown in the topbar.
 *
 * Route → label rules:
 *   /                              → "Add job"
 *   /jobs                          → "Jobs"
 *   /jobs/:id  (numeric id)        → "Jobs"
 *   /jobs/:id/url-resolution       → "URL Resolution"
 *   /jobs/:id/attempts             → "Attempts"
 *   /apply                         → "Dashboard"
 *   /profiles                      → "Profiles"
 *   /settings                      → "Settings"
 *   /containers, /containers/:id   → "Containers"
 *   anything else                  → "Apply For Me"
 *
 * @param {string} pathname - The current location.pathname value from React Router.
 * @returns {string} A human-readable page title for the topbar.
 */
function getPageTitle(pathname: string): string {
  if (pathname === "/") {
    return "Add job";
  }
  if (pathname === "/jobs") {
    return "Jobs";
  }
  const jobUrlResolutionMatch = /^\/jobs\/\d+\/url-resolution\/?$/.test(pathname);
  if (jobUrlResolutionMatch) {
    return "URL Resolution";
  }
  const jobAttemptsMatch = /^\/jobs\/\d+\/attempts\/?$/.test(pathname);
  if (jobAttemptsMatch) {
    return "Attempts";
  }
  const jobDetailMatch = /^\/jobs\/\d+\/?$/.test(pathname);
  if (jobDetailMatch) {
    return "Jobs";
  }
  if (pathname === "/apply") {
    return "Dashboard";
  }
  if (pathname === "/profiles") {
    return "Profiles";
  }
  if (pathname === "/settings") {
    return "Settings";
  }
  const isContainersRoute = pathname === "/containers" || /^\/containers\/[^/]+\/?$/.test(pathname);
  if (isContainersRoute) {
    return "Containers";
  }
  return "Apply For Me";
}

/**
 * Topbar — the horizontal bar across the top of the main column. It contains:
 *   1. A sidebar-toggle icon button (left).
 *   2. The current page title (derived from the active route).
 *   3. A visual-only search box with a ⌘K hint and a notifications bell (right).
 *
 * The page title is computed internally from `useLocation()` via {@link getPageTitle},
 * so callers only need to provide the sidebar toggle handler.
 *
 * The search input is intentionally non-functional in Phase 1.1 — it carries no value/onChange.
 *
 * @param {TopbarProps} props - Component props (see {@link TopbarProps}).
 * @returns {ReactElement} The topbar element.
 */
function Topbar({ onToggleSidebar }: TopbarProps): ReactElement {
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  return (
    <div className="topbar">
      <IconButton
        onClick={onToggleSidebar}
        className="icon-btn"
        title="Toggle sidebar"
        size="small"
      >
        <ViewSidebarOutlined fontSize="small" />
      </IconButton>
      <span className="tb-title">{pageTitle}</span>
      <div className="tb-actions">
        <div className="searchbox">
          <SearchOutlined fontSize="small" />
          <input placeholder="Search jobs, companies…" />
          <span className="kbd">⌘ K</span>
        </div>
        <IconButton className="icon-btn" title="Notifications" size="small">
          <NotificationsOutlined fontSize="small" />
        </IconButton>
      </div>
    </div>
  );
}

export default Topbar;
