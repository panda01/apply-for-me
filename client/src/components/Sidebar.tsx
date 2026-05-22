import type { ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import SpaceDashboardOutlined from "@mui/icons-material/SpaceDashboardOutlined";
import WorkOutlineOutlined from "@mui/icons-material/WorkOutlineOutlined";
import AddOutlined from "@mui/icons-material/AddOutlined";
import PersonOutlineOutlined from "@mui/icons-material/PersonOutlineOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import ViewInArOutlined from "@mui/icons-material/ViewInArOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

/**
 * Hardcoded user block content used at the bottom of the sidebar in v1.
 * A future PR will wire these to the real authenticated user. They live as
 * a single const so the swap is mechanical.
 */
const SIDEBAR_USER = {
  name: "Sofia Reyes",
  email: "sofia.reyes@hey.com",
  initials: "SR",
} as const;

/**
 * Describes a single navigable row in the sidebar.
 * - `id`     stable key used by React + the active-state lookup.
 * - `label`  human-visible row label (hidden in collapsed mode by CSS).
 * - `path`   react-router target — clicking the row pushes this onto history.
 * - `Icon`   MUI icon component rendered inside `.sb-icon`.
 * - `count`  optional numeric badge rendered as `.count` on the right side.
 *            Always `undefined` in v1; a future PR will wire jobs/profiles counts.
 */
interface SidebarNavItem {
  id: string;
  label: string;
  path: string;
  Icon: SvgIconComponent;
  count?: number;
}

/**
 * Optional props for `Sidebar`. The v1 sidebar renders without any props,
 * but `counts` is reserved on the public contract so a future PR can wire
 * jobs/profiles totals without changing the call-site signature.
 */
interface SidebarProps {
  counts?: {
    jobs?: number;
    profiles?: number;
  };
}

/**
 * Determines whether the given nav item should render in the "active" visual
 * state for the current location. Rules:
 *   - Default: exact pathname match.
 *   - `/jobs`: also active for `/jobs/[id]` and any nested `/jobs/[id]/...` path
 *     (covers `/jobs/:id/url-resolution`, `/jobs/:id/attempts`, etc.).
 *   - `/containers`: also active for `/containers/[id]`.
 *
 * @param itemPath     the nav item's target route (`item.path`).
 * @param pathname     the current `useLocation().pathname`.
 * @returns `true` when the item should be highlighted, `false` otherwise.
 */
function isNavItemActiveForPath(itemPath: string, pathname: string): boolean {
  if (pathname === itemPath) {
    return true;
  }
  if (itemPath === "/jobs" && pathname.startsWith("/jobs/")) {
    return true;
  }
  if (itemPath === "/containers" && pathname.startsWith("/containers/")) {
    return true;
  }
  return false;
}

/**
 * Left-hand application sidebar. Renders three labeled sections matching the
 * design package's structure:
 *
 *   Workspace — Dashboard (`/apply`), Jobs (`/jobs`), Add job (`/`)
 *   Library   — Profiles (`/profiles`), Settings (`/settings`)
 *   Admin     — Containers (`/containers`)
 *
 * Items are rendered as `react-router-dom` `<Link>` so users can cmd-click to
 * open routes in a new tab. The active row is signaled via `data-active="true"`
 * on `.sb-item`; the matching CSS lives in `client/src/theme/globalStyles.tsx`.
 *
 * Labels, section headings, counts, and the user-meta block are hidden when
 * the parent `.app` element carries `data-sidebar="collapsed"` — the sidebar
 * itself stays layout-passive and exposes no collapse state of its own.
 *
 * @param props.counts optional `{ jobs?, profiles? }` to populate the count
 *                     badge on the Jobs and Profiles rows. Omitted in v1.
 */
function Sidebar(props: SidebarProps = {}): ReactElement {
  const location = useLocation();
  const { counts } = props;

  const workspaceItems: SidebarNavItem[] = [
    { id: "dashboard", label: "Dashboard", path: "/apply", Icon: SpaceDashboardOutlined },
    { id: "jobs", label: "Jobs", path: "/jobs", Icon: WorkOutlineOutlined, count: counts?.jobs },
    { id: "add", label: "Add job", path: "/", Icon: AddOutlined },
  ];

  const libraryItems: SidebarNavItem[] = [
    { id: "profiles", label: "Profiles", path: "/profiles", Icon: PersonOutlineOutlined, count: counts?.profiles },
    { id: "settings", label: "Settings", path: "/settings", Icon: SettingsOutlined },
  ];

  const adminItems: SidebarNavItem[] = [
    { id: "containers", label: "Containers", path: "/containers", Icon: ViewInArOutlined },
  ];

  /**
   * Renders a single nav row as a `<Link>`. Pulled inline so we don't allocate
   * a new component per render, and so React can key by `item.id` directly.
   *
   * @param item nav item descriptor.
   * @returns the React element for the row.
   */
  const renderNavItem = (item: SidebarNavItem): ReactElement => {
    const isActive = isNavItemActiveForPath(item.path, location.pathname);
    const ItemIcon = item.Icon;
    return (
      <Link
        key={item.id}
        to={item.path}
        className="sb-item"
        data-active={isActive}
        title={item.label}
      >
        <span className="sb-icon">
          <ItemIcon sx={{ fontSize: 16 }} />
        </span>
        <span>{item.label}</span>
        {item.count != null && <span className="count">{item.count}</span>}
      </Link>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-logo">A</div>
        <span>Apply</span>
      </div>

      <div className="sb-section">Workspace</div>
      <nav className="sb-nav">
        {workspaceItems.map(renderNavItem)}
      </nav>

      <div className="sb-section">Library</div>
      <nav className="sb-nav">
        {libraryItems.map(renderNavItem)}
      </nav>

      <div className="sb-section">Admin</div>
      <nav className="sb-nav">
        {adminItems.map(renderNavItem)}
      </nav>

      <div className="sb-spacer" />

      <div className="sb-bottom">
        <div className="sb-user" title={SIDEBAR_USER.name}>
          <div className="avatar">{SIDEBAR_USER.initials}</div>
          <div className="meta">
            <span className="nm">{SIDEBAR_USER.name}</span>
            <span className="em">{SIDEBAR_USER.email}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
