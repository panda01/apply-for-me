# AI Journal

## 2026-05-22 11:54 EDT: UI rewrite — orchestration + Phase 0 theme + Phase 2 pixel diff

### Intent
End-to-end re-skin of the React+MUI client to match the design package shipped from Claude Design at `claude_tmp/design_package/apply-for-me/project/`. User direction: (a) rebuild the shell + sidebar + topbar + Jobs page + Job View page first, (b) lean on the MUI theme + a single global CSS layer so individual page code doesn't repeat colors/radii/typography, (c) verify visual fidelity with ImageMagick `magick compare` using section-by-section crops and Gaussian blur up to ~10 px so we measure structural match rather than pixel-perfect identity, (d) keep using real backend status values — never invent new ones to fit the design, (e) when the design lacks a screen (e.g. Profiles edit), open it as a separate route page rather than an inline dialog. The work was fanned out to five parallel agents (1.1 AppShell+Topbar, 1.2 Sidebar, 1.3 Jobs list, 1.4 Job View, 1.5 Profiles list + Edit page) after a single-agent Phase 0 laid down the MUI theme and global stylesheet they all depend on.

### Files Modified
- **`client/src/theme/theme.ts`** (new, orchestrator) — Single MUI theme via `createTheme({ cssVariables: { cssVarPrefix: "afm" }, … })`. Exports a `DESIGN_TOKENS` const that downstream code (and `globalStyles.tsx`) imports so colors/radii/font stacks have exactly one source of truth. Palette maps the design's warm-near-white surface system (`bg`, `surface`, `surfaceSunk`, `surfaceHover`, `border`, `borderStrong`, `text`, `textMuted`, `textFaint`, `accent`, `accentFg`, `accentTint`) to MUI's `palette.background/text/divider/primary/secondary`. Status colorways (`saved`, `applied`, `interview`, `offer`, `rejected`, `review`) live as a sibling `status` block — page code reaches them through `globalStyles.tsx`'s `.pill[data-status=...]` rules. Typography uses Geist (sans) + Geist Mono Variable (mono) at 13.5px base, with `h1=24px / 600 / -0.018em` matching the design's `.page-title`. Component overrides on `MuiCssBaseline` (font features), `MuiButton` (sized 30/26 px height per `size` prop, plus a custom `color="secondary" + variant="contained"` accent variant), `MuiIconButton` (matches `.icon-btn`), `MuiPaper`/`MuiCard`/`MuiCardHeader`/`MuiCardContent` (1px border + 10px radius, no shadow), `MuiTable`/`MuiTableCell`/`MuiTableRow` (sticky `surfaceSunk` header + 1px row separators + hover tint + `data-selected` accent-tint highlight), `MuiOutlinedInput`/`MuiInputLabel` (34px height, accent focus ring), `MuiCheckbox` (compact, accent fill), `MuiTabs`/`MuiTab` (1px underline indicator, text-only labels at 12.5px), `MuiChip` (22px pill base styling used by the design's tags), `MuiTooltip`, `MuiAlert` (rounded 10px + design-tone borders), `MuiLink` (text-color default + dotted-underline hover).
- **`client/src/theme/globalStyles.tsx`** (new, orchestrator) — `<GlobalStyles>` component encoding everything the theme can't do via component overrides: the `:root` CSS custom properties (so children can reference `var(--accent)`, `var(--text-muted)`, etc. and density attrs cascade), the app-shell grid (`.app { display: grid; grid-template-columns: var(--sidebar-w) 1fr }`) with the `[data-sidebar='collapsed']` collapse animation, `.sidebar` + `.sb-*` rules covering brand/section/nav-item/icon/count/spacer/bottom/user/avatar, the collapsed-mode label-hiding rules (`.app[data-sidebar='collapsed'] .sb-item span:not(.sb-icon) { display: none }` and friends), the topbar internals (`.tb-title`, `.tb-actions`, `.searchbox`, `.kbd`), page-head/page-title/page-sub typography, `.pill[data-status=...]` colorways for the six design pill variants, the design's `.tabs` filter row, card head/body, section head, `.tag` chips, the bulk-action bar, job-detail grid (`.job-detail-grid` with `1fr 300px` columns + sticky `.job-detail-side`), `.company-logo` placeholder, `.req-list`, `.meta-list`/`.meta-item`/`.meta-key`/`.meta-val`, `.manage-list`/`.manage-row` (+ danger variant), the full attempt timeline (`.attempts-list`, `.attempt-row`, `.attempt-rail`, `.attempt-dot`, `.attempt-line`, `.attempt-body`, `.attempt-head`, `.attempt-time`, `.attempt-stats`, `.attempt-desc`, `.attempt-note`, `.attempt-pill`, `.att-ok`/`.att-err`/`.att-warn`/`.att-mut`), `.col-title`/`.col-co`/`.cbx-cell` for the Jobs table, and a single mobile `@media (max-width: 720px)` block (consolidated from four separate blocks to satisfy TS's no-duplicate-keys rule). The Phase 1.5 agent later appended `.profile-row*`, `.form-split`/`.form-col`/`.form-preview-col`, `.file-chip*`, `.file-empty*`, `.danger-zone`, `.form-actions`, and `.row-2`/`.row-3` rules to this same file. Every rule reads colors/radii/fonts from `DESIGN_TOKENS` — no hex literals in the global sheet.
- **`client/src/main.tsx`** (modified, orchestrator) — Added side-effect imports for `@fontsource/geist/{400,500,600,700}.css` and `@fontsource-variable/geist-mono`. Otherwise unchanged.
- **`client/src/App.tsx`** (modified, orchestrator) — Wrapped `<Routes>` in `<ThemeProvider theme={theme}> <CssBaseline /> <AppGlobalStyles /> <BrowserRouter>…`; Phase 1.1 + 1.5 agents later layered `<AppShell>` around `<Routes>` and added the two profile-edit routes. The legacy `<NavMenu />` mount was removed by Phase 1.1.
- **`package.json` / `package-lock.json`** (modified, orchestrator) — `npm install @fontsource/geist @fontsource-variable/geist-mono`. Five packages added.
- **`tests/playwright/__design_refs__/capture-refs.mts`** (new, orchestrator) — Renders the design's HTML prototype (served via a one-shot `python3 -m http.server 8765 --directory claude_tmp/design_package/apply-for-me/project`) in headless Chromium at 1440×900 and captures four named PNGs: `shell.png` (dashboard / sidebar expanded), `sidebar-collapsed.png` (after toggling the topbar's icon button), `jobs.png` (Jobs page with seed data), `job-detail.png` (after clicking the first row). Console + page-error listeners surface failures during capture. The script needs the design served over HTTP because the prototype's `<script type="text/babel" src="…">` tags would be CORS-blocked from `file://`.
- **`tests/playwright/__design_refs__/{shell,sidebar-collapsed,jobs,job-detail}.png`** (new, orchestrator) — Captured reference screenshots. Sizes 1440×900.
- **`tests/playwright/__design_refs__/capture-impl.mts`** (new, orchestrator) — Mirror of the design-capture script for the live implementation: drives Chromium against the running dev server at `$CLIENT_PORT` (read from `.env`), navigates `/jobs` for `shell.png`/`jobs.png`, clicks the topbar toggle for `sidebar-collapsed.png`, clicks the first table row for `job-detail.png`. Output → `claude_tmp/impl_screenshots/`.
- **`tests/playwright/__design_refs__/diff-sections.mts`** (new, orchestrator) — The pixel-diff harness. Defines `SURFACES: SurfaceDef[]` keyed by surface name with per-surface `crops: CropDef[]` (each a `WxH+X+Y` ImageMagick geometry string). For each surface the script crops both the reference and the implementation PNGs into named sections (`sidebar`, `topbar`, `page-head`, `tabs`, `table`, `header`, `main-col`, `side-col`, `content`), then for each section runs `magick compare -metric AE -fuzz 3%` at Gaussian blur sigmas of 0/2/4/6/8/10 px. `magick compare` doesn't accept `-blur` inside its argument list, so the script first materializes a blurred copy of each cropped section with `magick "$src" -blur 0x$sigma "$blurred"` and feeds those temp files into compare. AE counts are parsed from compare's stderr (redirected via `2>&1`) with a regex matching the leading numeric token. Verdicts: ✅ match when AE@σ10 < 5% of section pixel count; ✅ structure-ok-text-differs when AE falls monotonically with blur and AE@σ10 < 50% of AE@σ0 (structure aligned, only content differs — the expected case when seed data ≠ real data); △ partial; ⚠️ structure-differs when AE stays flat or rises (the blurred shapes don't line up). Output: per-section ref/impl/diff PNGs in `claude_tmp/diff/<surface>/<section>__blur<σ>.png` plus an aggregate markdown report at `claude_tmp/design_diff_report.md`.
- **`claude_tmp/impl_screenshots/{shell,sidebar-collapsed,jobs,job-detail}.png`** (new, orchestrator) — Implementation screenshots from the running dev server.
- **`claude_tmp/design_diff_report.md`** (new, orchestrator) — Aggregate diff table. Sidebar and topbar sections match cleanly across all four surfaces (jobs/topbar AE@σ10 = 0 — pixel-perfect). Content sections diverge because the design reference uses the design's seed dataset (Sofia Reyes / Northwind Labs / 10 rich rows) while the implementation runs against the real backend (47 mostly-`example.com` rows from earlier development), so AE there is content-divergence noise, not styling failure.
- **`claude_tmp/diff/**`** (new, orchestrator) — Per-section ref/impl/diff PNGs at every blur sigma. Useful for eyeballing exactly where two crops disagree.
- **AI_JOURNAL.md** (this entry, orchestrator) — Top-level orchestration summary. Each parallel agent (Phase 1.1 / 1.2 / 1.3 / 1.4 / 1.5) wrote its own detailed entry below this one — those are the authoritative per-component changelogs.

### Verification
- `npx tsc --noEmit -p client/tsconfig.json` — clean (0 errors) after all five parallel agents merged.
- `magick compare` diff harness — sidebar and topbar match across all four surfaces (jobs/topbar AE@σ10 = 0). Content-area sections show expected seed-data-vs-real-data divergence; see `claude_tmp/design_diff_report.md` for the per-section table.
- Visual sanity check — `claude_tmp/impl_screenshots/shell.png` placed side-by-side with `tests/playwright/__design_refs__/shell.png` shows the sidebar (brand + Workspace/Library/Admin sections + user block), topbar (toggle + title + search + bell), table styling, status pills, button styling, and typography are visually indistinguishable from the design at eye-test level.
- Vitest suite — initially failed in 4 files (`App.test.tsx`, `JobsListPage.test.tsx`, `JobViewPage.test.tsx`, `ApplicationProfilesPage.test.tsx`) because the underlying UI changed (NavMenu removed, dialog replaced with route, two-column job detail, etc.) and the existing assertions still targeted the legacy UI. A follow-up agent rewrote the failing tests against the new UI (separate journal entry).

### Pitfalls / Notes for the next agent
- **AppShell reads `window.localStorage["afm:sidebar"]` during its `useState` initializer.** Any vitest test that mounts a page wrapped in AppShell — i.e. every page — needs the jsdom-localStorage stub from `client/src/pages/ApplicationDashboardPage.test.tsx` near the top of the file BEFORE the component import. The configured jsdom env doesn't expose a real `Storage`. This caught the parallel agent that wrote the Topbar tests, and will catch any future test author who doesn't know about the project-memory note.
- **The diff harness pre-blurs into temp files** rather than using `magick`'s `\(…-blur…\)` form. The latter only works for the standalone `magick` tool (not `magick compare`), and the syntax is fragile under bash escaping. If you adapt the harness for new surfaces, follow the pre-blur pattern.
- **The four reference screenshots are 1440×900.** Implementation captures must use the same viewport (the diff geometry strings hardcode `1208x848` for the content region, computed from `1440 - 232` for an expanded sidebar). If a future change shifts the sidebar widths, update both `DESIGN_TOKENS.sidebar` AND the geometries in `diff-sections.mts`.
- **Don't lower the 93% coverage threshold in `vitest.config.ts`.** Project memory: "Coverage threshold meet, don't lower" — write more tests instead. The Phase 2 test-fixer agent should keep this in mind.
- **`NavMenu.tsx` and `NavMenu.test.tsx` are unused after Phase 1.1** but still in `client/src/components/`. A future cleanup pass can delete them.

## 2026-05-22 (late evening): UI rewrite Phase 1.5 — Profiles list + standalone Edit page

### Intent
Phase 1.5 of the client re-skin. Migrates the Application Profiles surface from a single page with an inline MUI `Dialog` to (a) a list-only page that matches the design's `.profile-row` layout, and (b) a brand-new standalone create/edit page reachable at `/profiles/new` and `/profiles/:id/edit`. Per user directive ("profiles should also change the navigation and open in a new page"), New / Edit no longer use a Dialog — they navigate. The existing `<ApplicationProfileForm />` is reused verbatim inside the new page; no form fields were duplicated. All new presentation classes (`.profile-row*`, `.form-split`, `.form-col`, `.form-preview-col`, `.row-2`, `.row-3`, `.file-chip*`, `.file-empty*`, `.danger-zone`, `.form-actions .save-status`) live in `globalStyles.tsx` as global CSS keyed off `DESIGN_TOKENS`, not in per-page `sx` props.

### Files Modified
- **`client/src/theme/globalStyles.tsx`** (modified) — Appended profile-list (`.profile-row`, `.profile-row-avatar`, `.profile-row-label`, `.profile-row-meta`, `.profile-row-stat`, `.profile-row-actions`), profile-form-layout (`.form-page`, `.form-split`, `.form-col`, `.form-preview-col`, `.row-2`, `.row-3`, `.field label .opt`, `.form-actions`, `.form-actions .save-status`), file-picker chip (`.file-chip`, `.file-chip-icon`, `.file-chip-name`, `.file-chip-meta`, `.file-empty`, `.file-empty:hover`, `.file-empty-hint`), and `.danger-zone` rules. Merged `.form-split` and `.form-preview-col` responsive overrides into the existing `@media (max-width: 980px)` block (rather than declaring a duplicate key, per the prompt's warning) and added new `@media (max-width: 700px)` (for `.row-3`) and `@media (max-width: 600px)` (for `.row-2`) blocks. All colors and radii pull from `DESIGN_TOKENS` (`color.*`, `radius.*`, `font.*`) — no hardcoded hex.
- **`client/src/pages/ApplicationProfilesPage.tsx`** (rewrite) — Replaces the `Container` + `Table` + `Dialog` UI with the design's `.page-head` + `.card-head` + stack-of-`.profile-row`s layout. Removed: `DialogState`, `openCreateDialog`, `openEditDialog`, `closeDialog`, `handleSubmit`, every Dialog/Table/`Container` import. Added: `useNavigate` for `/profiles/new` and `/profiles/:id/edit` routing, an internal `ProfileRow` subcomponent (props: `profile`, `onEdit`, `onDelete`, `isDeleting`) that renders the four-column grid, and a `getInitials(profile)` helper. The data-flow functions `listApplicationProfiles`, `deleteApplicationProfile` are preserved unchanged. The "Set default" button is rendered for every row but disabled with a tooltip "Default profiles not yet wired up" — backend has no `isDefault` column. The "applications" stat column shows an em-dash because there's no usage counter on the API yet.
- **`client/src/pages/ApplicationProfileEditPage.tsx`** (new) — Default-exports `ApplicationProfileEditPage`. Reads `useParams<{ id?: string }>()` and derives `isEditMode` from `Number.isInteger(parsed) && parsed > 0`. In EDIT mode, `loadProfile(id)` calls `getApplicationProfile` (the single-record GET that already exists in the API service) and hydrates a local `initialValues` state; in CREATE mode it skips the fetch and the form renders blank. `handleSubmit` dispatches to either `createApplicationProfile` (then `navigate("/profiles")`) or `updateApplicationProfile` (then sets `saveStatus = "Saved just now"` and stays on the page). `handleDelete` (EDIT-only) confirms via `window.confirm`, calls `deleteApplicationProfile`, then `navigate("/profiles")`. Renders the `.form-split` layout with `<ApplicationProfileForm />` inside `.form-col` and a static `<Paper className="form-preview-col">` placeholder card on the right ("Document previews coming soon" — the design's faux resume/cover-letter previews are deferred to a later phase). Danger zone is rendered only in EDIT mode beneath the form.
- **`client/src/App.tsx`** (modified) — Added `import ApplicationProfileEditPage from "./pages/ApplicationProfileEditPage";` and two routes (`/profiles/new` and `/profiles/:id/edit`) directly after the existing `/profiles` route. Nothing else changed; ThemeProvider/CssBaseline/AppGlobalStyles/BrowserRouter/AppShell wrapper from the parallel agent left intact.
- **`tests/playwright/profilesDesign.spec.ts`** (new) — Three smoke tests: (1) list page renders the heading, sub-line, and "New profile" button which navigates to `/profiles/new`; (2) full create flow from `/profiles/new` lands back on `/profiles` with the new `.profile-row-label`; (3) clicking Edit on a row navigates to `/profiles/:id/edit` with hydrated form values and a working danger-zone Delete. Each test cleans up after itself by deleting the test profile via the row's delete button.

### Verification
- `npx tsc --noEmit -p client/tsconfig.json` — clean (0 errors). The parallel JobView agent's in-flight changes did not surface; if any do later they're not in files this task owns.
- Manual runtime/lint/tests deferred to the orchestrator's Phase 2 step per the prompt.

### Pitfalls / Notes for the next agent
- The old `tests/playwright/applicationProfiles.spec.ts` still expects the Dialog flow ("Application Profiles" heading capitalization + `role=dialog`). It will fail under the new UI — leaving it for the orchestrator's Phase 2 cleanup since the prompt told me not to delete tests.
- The form's `<ApplicationProfileForm />` was deliberately NOT modified — it still ships its own MUI submit + cancel buttons, so the design's "save-status indicator + sticky Save button in `.form-actions`" pattern is partially fulfilled: the EDIT mode's `saveStatus` ("Saved just now") renders in a separate `.form-actions` strip *below* the form. A later phase that hoists the submit button into a page-level `.form-actions` would need to refactor `ApplicationProfileForm` to accept a `formId` prop and remove its internal buttons.
- `WORK_AUTHORIZATION_LABELS` is imported as the value-table on the API service — the design's `WORK_AUTH_OPTIONS` shape was not introduced; we reuse the existing record map.
- The "Set default" button is render-only (disabled). When the backend grows an `isDefault` boolean, the Tooltip wrapper + `disabled` prop are the only line to update — search for "Default profiles not yet wired up".



### Intent
Phase 1.1 of the client re-skin to match the design package at `claude_tmp/design_package/apply-for-me/project/`. Replaces the legacy `<NavMenu>` AppBar with a two-column shell (sidebar + main column) keyed off the design's CSS that already exists in `client/src/theme/globalStyles.tsx` (`.app`, `.main`, `.topbar`, `.content`, `.tb-title`, `.tb-actions`, `.searchbox`, `.kbd`). The Sidebar component itself was authored in parallel by another agent (Phase 1.2) — this change just imports and slots it in. AppShell owns the sidebar-collapse state and persists it to `localStorage` under `afm:sidebar`. The Topbar derives its page title from `useLocation()` so App.tsx doesn't need a route → title map. The topbar search input is intentionally non-functional (no value/onChange) — visual scaffolding only for this phase.

### Files Modified
- **`client/src/components/AppShell.tsx`** (new) — Default-exports `AppShell({ children })`. Owns `sidebarState: "expanded" | "collapsed"`, initialized from `localStorage["afm:sidebar"]` via the helper `readInitialSidebarState()` (guards SSR/private-mode by returning `"expanded"` when storage is unavailable). A `useEffect` writes the state back on every change. Exposes `handleToggleSidebar` (a `useCallback` flipping the state) which is passed down to `Topbar`. Renders `<div className="app" data-sidebar={sidebarState}><Sidebar /><main className="main"><Topbar onToggleSidebar={…} /><div className="content">{children}</div></main></div>`. Constant `SIDEBAR_STORAGE_KEY = "afm:sidebar"`. Types: `SidebarState`, `AppShellProps`. Strict TS, no `any`.
- **`client/src/components/Topbar.tsx`** (new) — Default-exports `Topbar({ onToggleSidebar })`. Calls `useLocation()` internally and computes the page title via the pure helper `getPageTitle(pathname)`. Route → label rules: `/` → "Add job"; `/jobs` → "Jobs"; `/jobs/\d+` → "Jobs"; `/jobs/\d+/url-resolution` → "URL Resolution"; `/jobs/\d+/attempts` → "Attempts"; `/apply` → "Dashboard"; `/profiles` → "Profiles"; `/settings` → "Settings"; `/containers` and `/containers/:id` → "Containers"; fallback "Apply For Me". Renders `<div className="topbar">` with three children: a sidebar-toggle `IconButton` (className `icon-btn`) wrapping `<ViewSidebarOutlined fontSize="small" />`, a `<span className="tb-title">{pageTitle}</span>`, and `<div className="tb-actions">` containing the `.searchbox` (with `SearchOutlined`, a plain `<input placeholder="Search jobs, companies…" />`, and `<span className="kbd">⌘ K</span>`) plus a notifications `IconButton` with `NotificationsOutlined`. Type: `TopbarProps`.
- **`client/src/App.tsx`** (modified) — Removed `import NavMenu from "./components/NavMenu";` and the `<NavMenu />` render. Added `import AppShell from "./components/AppShell";`. Wrapped the existing `<Routes>` block inside `<AppShell>…</AppShell>`. `ThemeProvider`, `CssBaseline`, `AppGlobalStyles`, `BrowserRouter` left untouched and in the same order. Indentation of the route table tightened to match the new nesting.

### Verification
- `npx tsc --noEmit -p client/tsconfig.json` — zero errors across the whole client (Sidebar.tsx was authored by the parallel Phase 1.2 agent between the start and end of this task, so no filter was needed).
- Manual runtime check, lint, and tests are out of scope for Phase 1.1 — the orchestration plan defers them to a later phase.

### Pitfalls / Notes for the next agent
- The prompt's "API contract for Topbar" included a `pageTitle: string` prop, but the prompt also explicitly said "the route map for page title should live in `Topbar.tsx` (it reads `useLocation`)." I chose the latter (single source of truth, no redundant prop) — if a later phase wants to override the title for special states, that's where to thread it back in.
- `.icon-btn` is referenced by className but not defined in the current `globalStyles.tsx` (it lives in the design package's `styles.css`). MUI's `IconButton` already provides reasonable visuals, so this is cosmetic-only and can be tightened later by adding the `.icon-btn` rule to `globalStyles.tsx` if needed.
- `NavMenu.tsx` and `NavMenu.test.tsx` are now unused but still present — left in place since the prompt explicitly limited me to App.tsx + the two new files. A cleanup pass can delete them.
- The TaskUpdate tool referenced in the prompt is not exposed in this environment, so task #4 status could not be flipped programmatically.

## 2026-05-22 (evening): Sidebar component — Phase 1.2 of the UI re-skin

### Intent
Phase 1.2 of the broader UI rewrite that re-skins the React+MUI client to match the design package under `claude_tmp/design_package/apply-for-me/project/`. Adds the left-hand sidebar exactly as the design's `sidebar.jsx` lays it out, but ported to strict TypeScript, react-router `<Link>`s (so users can cmd-click rows to open routes in a new tab), and MUI icons in place of the design's inline SVG stroke icons. Three sections per the user's locked nav decision: Workspace (Dashboard `/apply`, Jobs `/jobs`, Add job `/`), Library (Profiles `/profiles`, Settings `/settings`), Admin (Containers `/containers`). The Jobs row is also active for `/jobs/:id` and any deeper `/jobs/:id/...`; Containers is active for `/containers/:id`. The sidebar itself stays layout-passive — the collapsed state is owned by the parent `.app` element via the `data-sidebar="collapsed"` attribute that the `globalStyles.tsx` CSS already keys off, so all labels/section-headings/counts/user-meta hide automatically without the component needing to know about it. All styling comes from the pre-existing `.sidebar`, `.sb-brand`, `.sb-logo`, `.sb-section`, `.sb-nav`, `.sb-item`, `.sb-icon`, `.count`, `.sb-spacer`, `.sb-bottom`, `.sb-user`, `.avatar`, `.meta` classNames in `client/src/theme/globalStyles.tsx`; no new inline styles. User block at the bottom is hardcoded (Sofia Reyes / sofia.reyes@hey.com / SR initials) as a single top-of-file `SIDEBAR_USER` const for an easy future swap. An optional `counts?: { jobs?, profiles? }` prop is on the public contract so a future PR can wire badges without changing the call-site.

### Files Modified
- **`client/src/components/Sidebar.tsx`** (new) — Exported default `function Sidebar(props: SidebarProps = {}): ReactElement`. Top-of-file `SIDEBAR_USER` const carries the v1 user block. `SidebarNavItem` interface (`id`, `label`, `path`, `Icon: SvgIconComponent`, optional `count`) plus a `SidebarProps` interface holding the optional `counts` future-prop. Exported helper `isNavItemActiveForPath(itemPath, pathname)` encodes the active-state rules (exact match, plus the `/jobs/...` and `/containers/...` prefix exceptions). Inline `renderNavItem` closure renders each row as a `<Link>` with `data-active={isActive}`, the icon wrapped in `<span className="sb-icon">` (required by the CSS that hides non-`sb-icon` spans in collapsed mode), and an optional `<span className="count">{item.count}</span>` only when defined. Three `<nav className="sb-nav">` lists for Workspace / Library / Admin, separated by `<div className="sb-section">` headings. `.sb-spacer` pushes the `.sb-bottom` user block to the bottom. MUI icon mapping per the spec: SpaceDashboardOutlined, WorkOutlineOutlined, AddOutlined, PersonOutlineOutlined, SettingsOutlined, ViewInArOutlined. Icons sized via `sx={{ fontSize: 16 }}` to match the `.sb-icon { width:16; height:16 }` box.

### Verification
- `npx tsc --noEmit -p client/tsconfig.json 2>&1 | grep -E "(Sidebar|error)"` — zero errors in Sidebar.tsx. The only remaining error in the filtered output is `App.tsx(38,10): Cannot find name 'NavMenu'`, which is a parallel agent's in-progress AppShell wiring and out of scope for this task.
- The Sidebar component is not yet mounted in `App.tsx` (the AppShell agent owns that wiring), so no runtime verification of the full shell is possible from this task alone. The structural contract — DOM shape, classNames, data-active values, `<Link>` `to` targets — matches the spec exactly.

## 2026-05-22 (afternoon): Inline FetchProgressPanel — surface resolver progress on the job view page

### Intent
The "Fetch Data" button on `/jobs/:id` ran a multi-stage background flow (scrape → begin resolution log → resolver pipeline → finalize) but the UI only had an indefinite spinner inside the button. Users staring at a 30+ second resolver run had zero visibility, and a crashed resolver container produced a permanent spinner with no recovery path. The server already exposes a rich live-progress payload at `GET /api/job-listings/:id/url-resolution/live` (with a server-synthesized "crashed terminal" payload — `isFinished:true, finalOutcome:null, reason:<why>` — when the container is unreachable). The fix is purely frontend: a self-contained MUI panel rendered inline on the job view page that polls that endpoint and shows the resolver's current phase, message, step count, elapsed time, indeterminate progress bar, and (on crash) an Alert plus a Retry button. Two non-obvious bugs surfaced during manual verification and were fixed in the same PR: (1) the page's job-row poll stopped once `isFetchingData` cleared, so the cached `resolution_in_progress` stayed `true` forever and the panel never dismissed — fixed by adding `isResolutionStillInProgress` to the poll condition. (2) Clicking Retry on a crashed panel hit the live endpoint before the background scraper had inserted a new log row, so the panel locked on the stale crashed terminal — fixed by a `sinceLogId` prop on the panel plus a `fetchSinceLogId` state snapshot in the parent that filters out any payload with `logId <= sinceLogId`. The panel is also force-remounted on every Retry via a `fetchRetryKey` so its internal state resets even when `isActive` would otherwise never toggle.

### Files Modified
- **`client/src/services/jobListingsApi.ts`** — Added exported `RESOLUTION_PHASE_LABELS: Record<ResolutionPhase, string>` mapping every `ResolutionPhase` enum value to its user-facing prose label ("Searching the web", "Reading candidate pages with AI", etc.). Placed next to the enum so future consumers don't have to look up the prose elsewhere.
- **`client/src/services/jobListingsApi.test.ts`** — New `describe("RESOLUTION_PHASE_LABELS")` block: enumerates every `ResolutionPhase` value and asserts a non-empty label exists for each; spot-checks a few labels against the spec for regression detection.
- **`client/src/components/FetchProgressPanel.tsx`** (new) — Self-contained MUI panel with four render branches: inactive (null), starting (CircularProgress + "Starting…" + LinearProgress), live (phase Chip + message + step counter + elapsed + LinearProgress), crashed (red Alert with reason + Retry button). Props: `jobId`, `isActive`, `sinceLogId`, `onRetry`. Owns two intervals — a 1500 ms poll and a 1000 ms tick — both torn down on unmount, on `isActive=false`, and on terminal-non-crashed payloads. Exports pure helpers `colorForStepStatus`, `formatElapsedMmSs`, `deriveCurrentStep`, `isCrashedTerminal` for test reuse. Silently swallows non-404 fetch errors so transient blips don't flash Alerts.
- **`client/src/components/FetchProgressPanel.test.tsx`** (new) — 19 tests across four describe blocks: pure-helper unit tests, render-branch tests (real timers + waitFor), polling-lifecycle tests (fake timers + `vi.advanceTimersByTimeAsync` with the act-then-flush-microtasks pattern from `UrlResolutionTracePage.test.tsx`), and sinceLogId filtering + transient-error swallowing tests.
- **`client/src/pages/JobViewPage.tsx`** — Added state `fetchRetryKey` (incremented on every Fetch Data click) and `fetchSinceLogId` (snapshot of the prior `latest_resolution_log_id` at click time). Rendered `<FetchProgressPanel key={fetchRetryKey} jobId={…} isActive={isFetchingData || isResolutionInProgress} sinceLogId={fetchSinceLogId} onRetry={handleFetchData} />` between the action-buttons Paper and the applying Paper. Extended the `shouldPoll` condition in the existing job-row polling effect to ALSO include `jobListing?.resolution_in_progress === true` so the row keeps re-fetching even after `isFetchingData` clears — necessary for the cached `resolution_in_progress` to actually transition false→ when the server settles. Updated the top-of-file JSDoc to mention the new panel.
- **`client/src/pages/JobViewPage.test.tsx`** — Replaced the `vi.mock` factory with one that uses `importOriginal` so the real `RESOLUTION_PHASE_LABELS` / `ResolutionPhase` exports are still available; added `getLiveUrlResolution` to the mocked surface. Added two new test cases: (a) clicking Fetch Data mounts `[data-testid="fetch-progress-panel"]`; (b) loading a row with `resolution_in_progress=true` mounts the panel without any user action.
- **`tests/playwright/fetchProgressPanel.spec.ts`** (new) — Two scenarios using `page.route()` to mock the live-progress endpoint deterministically: (a) live in-progress payload renders the phase chip ("Searching the web"), step counter ("Step 1 of 1"), and LinearProgress; (b) crashed terminal payload renders the Alert with the reason text and the Retry button, no LinearProgress.
- **`AI_JOURNAL.md`** — This entry.

### Verification
- Manual verification via `manual-verifier` agent: three rounds.
  - Round 1: confirmed live phase transitions on the user-supplied LinkedIn URL (`https://www.linkedin.com/jobs/view/4416313447/?…`) — "Acquiring browser container" → "Searching the web" → "Reading candidate pages with AI" → "Harvesting careers-page links" → "Scraping a candidate page" → "Wrapping up". Step counter went past Step 16. Elapsed clock advanced past 02:00. Caught two bugs: panel didn't dismiss after settle (BUG 1) and Retry didn't reset the crashed Alert (BUG 2).
  - Round 2: confirmed BUG 1 fix (panel dismissed within one 3-second poll cycle after `resolution_in_progress` flipped false). Caught a deeper race: BUG 2's `fetchRetryKey` remount fired the first poll BEFORE the background scraper inserted a new log row, so the live endpoint returned the stale crashed log → panel locked on it.
  - Round 3: confirmed the `sinceLogId` fix — clicking Retry on the seeded crashed job transitioned the panel from the crashed Alert to "Starting…" within 2 seconds, then on to live phases when the new log row appeared.
- `npm test` — 786 tests pass across 41 files.
- `npm run test:coverage` — branches 93.2% / statements 98% / lines 98.7% / functions 98.12%. Above the 93% global threshold across all four metrics.
- `npm run check:duplication` — exits 0.
- `npm run lint` — only the two pre-existing errors in `docker/managed-container/server.ts` and `server/src/services/applicationUrlResolverService.ts` (neither touched).
- `npm run tsc` — only pre-existing errors in unrelated files; zero new errors in any file modified by this change.
- `npx playwright test tests/playwright/fetchProgressPanel.spec.ts` — both scenarios pass.

## 2026-05-22 (early morning): Per-attempt screenshots + per-job attempts history + click-through detail UI

### Intent
Improve the apply interface in two coordinated ways. First, make dashboard rows clickable so the user can drill into a per-job attempt history (`/jobs/:id/attempts`) and a per-attempt detail page (`/applications/:attemptId?jobId=N`) — both readable surfaces for the previously-invisible attempt history. Second, capture a deterministic "what the agent was about to submit" screenshot by inserting a new Phase 4 "Reviewing application" between Phase 3 (Filling out form) and the now-Phase-5 "Submitting application". The first Phase-4 step with a saved screenshot becomes the canonical submission_screenshot_path on the ApplicationAttemptLogs row, and each attempt's per-step PNGs are also viewable inline on the detail page. The `ApplicationAttemptLogs` model itself was overhauled: the previously-undocumented row now has a JSDoc-style schema comment, a proper relation back to JobListing with `onDelete: Cascade`, an index on `(job_listing_id, created_date)`, and `end_response` was promoted from a free-text String to a new `ApplicationAttemptOutcome` enum so the UI can render typed status chips instead of raw prose. Manual verification ran an actual end-to-end apply against a real Ashby job; both the new Phase 4/5 split (13 review steps → 5 submit steps in the run summary) and the persisted screenshot rendered correctly.

### Files Modified
- **`server/prisma/schema.prisma`** — Added `enum ApplicationAttemptOutcome { applied | failed | closed_listing | captcha_blocked | stuck }` with a schema comment block explaining each value. Overhauled `model ApplicationAttemptLogs`: added a multi-paragraph JSDoc-style schema comment, changed `end_response` from `String` to `ApplicationAttemptOutcome`, added nullable `submission_screenshot_path String?` (canonical Phase-4 image path on disk), added nullable `log_directory String?` (per-run logs folder so per-step PNGs can be served), added the previously-missing `job_listing JobListing @relation(fields: [job_listing_id], references: [id], onDelete: Cascade)` plus the reciprocal `application_attempt_logs ApplicationAttemptLogs[]` on JobListing, and added `@@index([job_listing_id, created_date])`. Migration was non-empty-table-safe: `DELETE FROM application_attempt_logs;` first, then `npx prisma db push` + `npx prisma generate`.
- **`server/src/services/jobApplicationService.ts`** — Widened `ApplicationPhase.phase` from `1 | 2 | 3 | 4` to `1 | 2 | 3 | 4 | 5`. Added `REVIEW_KEYWORDS = /review|verify|double[-\s]?check|confirm\s*before\s*submit|check\s*that/i` (Phase 4). Removed `review\s*application` from `SUBMIT_KEYWORDS` (now matches `/submit|confirm|send\s*application|finish/i`, Phase 5). Reordered `classifyApplicationPhase` to REVIEW > SUBMIT > FORM > APPLY so combined review+submit wording wins Phase 4. Expanded `phaseLabels` to include `4: "Reviewing application"` and `5: "Submitting application"`. Updated `[Phase x/4]` log strings to `/5`. Modified `saveStepScreenshot` to return `Promise<string | null>` (the saved file path or null on failure). Modified `applyToJob` to accept an optional sixth parameter `onSubmissionScreenshotSaved?: (filePath: string) => void | Promise<void>`; fires exactly once on the first Phase-4 step that produces a saved screenshot via a `didFireSubmissionCallback` guard in the per-step loop. Updated `buildApplicationPrompt` to append a "STOP and carefully review every field" instruction before "Proceed carefully through each step." so the agent emits Phase-4-classifiable wording before clicking submit.
- **`server/src/routes/jobApplications.ts`** — Added exported `deriveAttemptOutcome(result: ApplicationResult): ApplicationAttemptOutcome` helper (precedence: closed_listing > captcha_blocked > stuck > applied > failed). Rewrote `saveAttemptLog` to accept the full `ApplicationResult` + the `submissionScreenshotPath: string | null`, deriving `end_response` via `deriveAttemptOutcome` and persisting `submission_screenshot_path` + `log_directory` (from `result.logDirectory`). Wired the new screenshot callback through both `applyToSingleJob` and `runBatchApply`; both paths capture the path into a per-iteration closure variable and pass it into `saveAttemptLog`. On the catch branch both paths build a synthetic `ApplicationResult` so the outcome derivation runs consistently. Updated imports (removed unused `StepLog`, added `ApplicationResult` and the `ApplicationAttemptOutcome` enum type).
- **`server/src/routes/jobListings.ts`** — Added four new routes: `GET /:id/attempts` (returns the job + parsed attempts array with `has_submission_screenshot` boolean instead of leaking the raw filesystem path), `GET /:jobId/attempts/:attemptId` (single attempt detail + a minimal `job_listing` block for the detail page's back link), `GET /:jobId/attempts/:attemptId/submission-screenshot` (streams the canonical Phase-4 PNG with `Content-Type: image/png`, `Cache-Control: private, no-store`, hangup cleanup via `req.on("close", () => stream.destroy())`), and `GET /:jobId/attempts/:attemptId/steps/:stepNumber/screenshot` (streams `{log_directory}/step-{n}.png`). Added exported `parseAttemptLogRow` helper (safe JSON parse for the `logs` column, derives `has_submission_screenshot`). Added module-internal `parsePositiveIntegerParamOrSend400` and `streamScreenshotOrSend404` helpers. Added imports for `node:fs/createReadStream`, `node:fs/promises/access`, `node:path/resolve`, `StepLog` type, and `ApplicationAttemptOutcome` type.
- **`server/src/routes/jobApplications.test.ts`** — Updated the default `applicationAttemptLogs.create` mock to satisfy the new schema (`end_response: "failed"`, `submission_screenshot_path: null`, `log_directory: null`). Updated the apply-route mock-call signature to expect the new sixth `onSubmissionScreenshotSaved` callback. Rewrote the "attempt log on success" and "attempt log on failure" assertions to use the new enum values and to verify the two new persisted fields. Added a new test asserting that when `applyToJob` fires the screenshot callback, the attempt-log INSERT carries both the path and `log_directory`. Added a new `describe("deriveAttemptOutcome", ...)` block covering all five enum branches plus the closed_listing-over-captcha and captcha-over-stuck precedence cases.
- **`server/src/routes/jobListings.test.ts`** — Added mocks for `prisma.applicationAttemptLogs.findMany` and `.findUnique`. Imported `node:path/resolve` and defined `FIXTURE_PNG_PATH` / `MISSING_FILE_PATH` constants pointing at real files under `claude_tmp/` (so the streaming-route tests don't need to mock `fs`). Added new describe blocks covering `parseAttemptLogRow` (well-formed JSON, malformed JSON, non-array JSON, has_submission_screenshot derivation), `GET /:id/attempts` (200 + ordering, 200 with empty array, 404), `GET /:jobId/attempts/:attemptId` (200, 400 on bad id, 404 missing, 404 cross-job), `GET /:jobId/attempts/:attemptId/submission-screenshot` (200 stream + headers, 404 null path, 404 missing file, 404 cross-job), `GET /:jobId/attempts/:attemptId/steps/:stepNumber/screenshot` (200 stream, 400 on bad step number, 404 null log_directory, 404 missing file). Added `buildMockAttemptRow` fixture helper.
- **`server/src/services/jobApplicationService.test.ts`** — Updated the classifier tests: existing "submit" → 4 case became → 5; added Phase-4 cases for review/verify/double-check; added Phase-5 cases for submit/send-application; added a combined-keyword case asserting REVIEW > SUBMIT ordering; added a never-go-backward-from-5 case. Updated `saveStepScreenshot` tests to assert the new return value (string path on success, null on failure). Added new `applyToJob` tests covering the one-fire callback semantics: fires exactly once on the first Phase-4 step with a screenshot; does NOT fire on subsequent Phase-4 steps; does NOT fire when Phase 4 is never reached; does NOT fire when Phase 4 happens without a `screenshotUrl`.
- **`client/src/services/jobListingsApi.ts`** — Added `enum ApplicationAttemptOutcome` (mirror of server). Added interfaces `AttemptStepLog`, `ApplicationAttemptSummary`, `JobAttemptsResponse`, `ApplicationAttemptDetail`. Added functions `getJobAttempts(jobId)`, `getApplicationAttempt(jobId, attemptId)`, `buildSubmissionScreenshotUrl(jobId, attemptId)`, `buildStepScreenshotUrl(jobId, attemptId, stepNumber)` — the URL builders return strings for use as `<img src>`, not Promises.
- **`client/src/services/jobListingsApi.test.ts`** — Added test blocks covering `getJobAttempts` happy + error paths, `getApplicationAttempt` happy path, and both `buildSubmissionScreenshotUrl` / `buildStepScreenshotUrl` URL builders.
- **`client/src/components/JobRow.tsx`** — Added optional `onClick?: (id: number) => void` prop. When set, the row body is wrapped in a MUI `ListItemButton` (clickable as a whole); when unset, the legacy `<Box>` renders unchanged so non-navigating sections (currently unused, but the contract is preserved) keep their current behavior. Added `event.stopPropagation()` on both the external-URL `<Typography component="a">` and the Apply/Retry `<Button>` so neither bubbles to the row's onClick. Updated JSDoc.
- **`client/src/components/JobRow.test.tsx`** (new) — Tests the new propagation contract: row body click fires `onClick(id)`; ListItemButton absent when `onClick` is omitted; external-URL link click does NOT fire `onClick`; Apply button click fires `action.onClick` but NOT `onClick`; empty-title fallback renders the URL as the row title.
- **`client/src/pages/ApplicationDashboardPage.tsx`** — Imported `useNavigate` from `react-router-dom`. Added `handleRowClick` (useCallback) that navigates to `/jobs/${id}/attempts`. Wired `onClick={handleRowClick}` to every JobRow in the init, applied, closed, and errors sections.
- **`client/src/pages/JobAttemptsPage.tsx`** (new) — Renders the per-job attempt history at `/jobs/:id/attempts`. Header carries the job metadata, status chip, "View Full Job Details" link, and a conditional Apply button (same disabled logic as the dashboard, reads the same `afm:selectedApplicationProfileId` localStorage key). Lists every attempt newest-first with `<AttemptListRow>` showing an outcome chip color-coded by enum value (success/error/default/warning), formatted timestamp, step count, and a thumbnail PNG via the new streaming endpoint when `has_submission_screenshot === true`. Empty state when no attempts exist. Local `getOutcomeChipConfig` + `getJobStatusChipConfig` helpers centralize the chip color/label mappings.
- **`client/src/pages/JobAttemptsPage.test.tsx`** (new) — 13 tests covering header rendering, empty state, conditional Apply button, error Alert on fetch failure, invalid ID guard, every `ApplicationAttemptOutcome` enum value (chip mapping for each), the Apply button flow (no-stored-profile error, success + refresh, error Alert on apply rejection, generic message on non-Error rejection), the action-error Alert dismissal via its close button, the singular "step" vs plural "steps" pluralization, and the Untitled + Unknown post-date fallbacks. Includes the inline localStorage stub per the project's jsdom-localStorage gotcha.
- **`client/src/pages/ApplicationAttemptDetailPage.tsx`** (new) — Renders the read-only per-attempt detail at `/applications/:id?jobId=N` (the `jobId` query param is required because all routes are namespaced under the parent job). Reads `id` from `useParams` + `jobId` from `useSearchParams`. Three panels: header (outcome chip + timestamp + parent-job link), submission screenshot with `onError` fallback to "No submission screenshot for this attempt.", and a step log list where each `<StepRow>` shows the step number, phase chip, nextGoal, URL, actions, captcha/stuck chips when set, and an inline per-step screenshot (with its own `onError` fallback) when `screenshotSaved === true`. Back link returns to `/jobs/{jobId}/attempts`.
- **`client/src/pages/ApplicationAttemptDetailPage.test.tsx`** (new) — Tests cover all five outcome enum values' chip mapping, the submission-screenshot fallback when has_submission_screenshot is false, the submission-screenshot fallback when the img errors, the per-step screenshot's onError hiding behavior, the step-log empty state, the missing-jobId error, the invalid-attempt-ID error, the API error in an Alert, the captcha/stuck step chips, the empty-job-title URL fallback, and the non-Error fetch rejection generic message.
- **`client/src/App.tsx`** — Imported `JobAttemptsPage` and `ApplicationAttemptDetailPage`. Added routes `/jobs/:id/attempts` and `/applications/:id`. Updated the route-list JSDoc.
- **`tests/playwright/jobAttemptsAndDetail.spec.ts`** (new) — Four Playwright cases: dashboard row click → `/jobs/:id/attempts`; empty attempts state; `/applications/:id` without `?jobId` shows the missing-jobId Alert; `/applications/abc?jobId=1` shows the invalid-attempt-ID Alert. Reads the new job's id from the post-create redirect URL via regex.
- **`claude_tmp/test-screenshot.png`** + **`claude_tmp/step-4.png`** — Tiny PNG fixtures used by the streaming-route tests in jobListings.test.ts.
- **`AI_JOURNAL.md`** — This entry.

### Verification
- `npm test` — 767 tests pass across 39 files.
- `npm run test:coverage` — branches 93.11% / statements 97.94% / lines 98.67% / functions 98.06%. Meets the 93% global threshold across all four metrics.
- `npm run check:duplication` — exits 0.
- Manual verification via `manual-verifier`: ran a real Browser-Use apply against an Ashby job, confirmed the run summary shows 13 "Reviewing application" steps + 5 "Submitting application" steps, the new ApplicationAttemptLogs row has `end_response = "applied"`, `submission_screenshot_path` non-null with the file present on disk, and `log_directory` non-null. Full UI walk-through: dashboard row → `/jobs/:id/attempts` (Applied chip, thumbnail visible) → `/applications/:id?jobId=N` (full-size submission screenshot served 200, all 18 per-step screenshots served 200). Propagation guards verified: external-URL link opens a new tab without SPA navigation; Apply button kicks off the apply without navigating.
- `npm run lint` — two pre-existing errors in `docker/managed-container/server.ts` and `server/src/services/applicationUrlResolverService.ts` remain (neither touched by this change); no new lint violations.
- `npm run tsc` — six pre-existing errors in unrelated files remain; no new TS errors in any file modified by this change.

## 2026-05-21 (evening): Introduce ApplicationProfile CRUD and gate the apply flow on a selected profile

### Intent
The apply flow read every applicant identity field from a single `server/src/scripts/user_info.json` on disk at the moment of every apply call. That meant the user had no way to keep multiple identities (different cover letters per role type, different work-authorization story, different desired salary), and switching identities required hand-editing a JSON file. This change makes the identity a database row the user can edit through the UI: a new `application_profiles` table, full CRUD via `/api/application-profiles` (+ `/profiles` page), and a gate on the apply dashboard requiring the user to pick a profile before kicking off any application. On first server boot after the migration, an "Default" profile is seeded from the existing `user_info.json` so the current workflow keeps working.

Three new optional fields rounded out the model based on the user's pick list: `coverLetterUrl` (URL to a hosted cover letter the agent can open mid-form), `workAuthorization` (US-only enum: us_citizen / permanent_resident / authorized_no_sponsorship_needed / authorized_future_sponsorship_needed / sponsorship_required), and `desiredSalaryMin` (whole USD, no max — the user noted forms don't ask for a max). All three are optional and only emitted into the Browser-Use prompt when set, so the agent never sees "Cover Letter URL: null" style noise.

### Files Modified
- **`server/prisma/schema.prisma`** — Added `enum WorkAuthorization` (5 US-only values) and `model ApplicationProfile` mapping to `application_profiles` (id, unique name, firstName, middleName?, lastName, email, phone, github?, linkedin?, website?, resumeUrl?, coverLetterUrl?, workAuthorization?, desiredSalaryMin? Int, created_date, updated_date). Ran `npx prisma db push` + `npx prisma generate`.
- **`server/src/services/applicationProfileSeed.ts`** (new) — `seedDefaultProfileIfEmpty()`: when the table is empty and `user_info.json` is readable, inserts a "Default" row from the JSON fields. Best-effort; logs and continues on any error.
- **`server/src/index.ts`** — Invokes `seedDefaultProfileIfEmpty()` after `verifyDatabaseConnection()` and before `app.listen()`, wrapped in a `.catch` so a seed failure can't block server boot.
- **`server/src/routes/applicationProfiles.ts`** (new) — Router mounted at `/api/application-profiles` with GET `/`, GET `/:id`, POST `/`, PUT `/:id`, DELETE `/:id`. Validates required + optional fields, emits 400 with an `errors` array on validation failure, 409 on unique-name conflict (`P2002`). Helpers `readNonEmptyString` / `readOptionalString` / `readOptionalUrl` / `readOptionalEnum` / `readOptionalPositiveInt` for clean, testable validation. Local constant `WORK_AUTHORIZATION_VALUES` mirrors the Prisma enum because Prisma's generator emits enums as TS types only (no runtime values).
- **`server/src/routes/applicationProfiles.test.ts`** (new) — 18 tests covering happy paths, missing required fields, malformed email, malformed optional URL, invalid enum, invalid salary, 409 unique violation on both POST and PUT, 404 on GET/PUT/DELETE missing rows.
- **`server/src/app.ts`** — Imported `applicationProfilesRouter` and mounted at `/api/application-profiles`.
- **`server/src/services/jobApplicationService.ts`** — `UserInfo` interface gained `coverLetterUrl: string | null`, `workAuthorization: WorkAuthorization | null`, `desiredSalaryMin: number | null` (and all previously-required optional links became nullable). Added `WorkAuthorization` exported type, `WORK_AUTHORIZATION_LABELS` Record, and helper `buildOptionalLine()` / `buildFullName()`. Rewrote `buildApplicationPrompt()` so it only emits lines for fields that are set; appends a US-positions hint and an optional cover-letter-URL hint that points the agent at the URL for cover-letter form fields.
- **`server/src/routes/jobApplications.ts`** — Removed the `readUserInfo()`/`getProfileId()` JSON-file path. New `parseApplicationProfileIdOrSend400()` reads `applicationProfileId` from the JSON body. New `loadUserInfoFromProfile(id)` hits Prisma and maps the row to `UserInfo`. `loadConfigOrSend400()` now takes `req` plus `res`, resolves the chosen profile, returns `{ userInfo, browserUseProfileId }` (renamed for clarity — `browserUseProfileId` is the env-derived Browser-Use session id, distinct from the new application profile id). Both POST `/:id/apply` and POST `/apply-batch` now require `applicationProfileId` in their request bodies; they 400 with a useful message when it's missing or points at a non-existent profile.
- **`server/src/routes/jobApplications.test.ts`** — Rewrote the test fixtures to mock `prisma.applicationProfile.findUnique` instead of `readFile` from `node:fs/promises`. Every `/apply` / `/apply-batch` request now sends `{ applicationProfileId: 1 }` in the body. Added new cases asserting 400 when the id is missing and 400 when the id points at a non-existent profile. `buildTestUserInfo()` helper centralises the new `UserInfo` shape (now with three new nullable fields).
- **`server/src/services/jobApplicationService.test.ts`** — Extended `mockUserInfo` with `coverLetterUrl: null`, `workAuthorization: null`, `desiredSalaryMin: null` so the prompt builder doesn't throw on `.toLocaleString()` of `undefined`.
- **`client/src/services/applicationProfilesApi.ts`** (new) — Typed CRUD wrappers + `WorkAuthorization` union + `WORK_AUTHORIZATION_LABELS` Record (mirrors the server). Exports `ApplicationProfileResponse`, `ApplicationProfileInput`.
- **`client/src/services/applicationProfilesApi.test.ts`** (new) — Covers all five CRUD wrappers and the labels constant.
- **`client/src/services/jobListingsApi.ts`** — `applyToJob(id, applicationProfileId)` and `startBatchApply(applicationProfileId)` now serialize the profile id into the POST body. Updated `jobListingsApi.test.ts` to assert the new payload.
- **`client/src/components/ApplicationProfileForm.tsx`** (new) — Shared create/edit form: required identity fields, optional URL/auth/salary fields, client-side validation mirroring server rules (URL parse, email format, positive integer salary), aggregated error Alert that combines client + server validation messages. Optional fields normalize empty strings to `null` before submit.
- **`client/src/pages/ApplicationProfilesPage.tsx`** (new) — `/profiles` route: lists profiles in an MUI table with edit/delete IconButtons, opens an MUI Dialog around `ApplicationProfileForm` for create + edit. Delete uses `window.confirm`. Empty-state CTA when the table is empty.
- **`client/src/App.tsx`** — Imported `ApplicationProfilesPage` and registered the `/profiles` route. Updated the routes block doc-comment.
- **`client/src/components/NavMenu.tsx`** — Added a "Profiles" link between "Apply" and "Containers". Updated `NavMenu.test.tsx` accordingly.
- **`client/src/pages/ApplicationDashboardPage.tsx`** — New `<Paper>` panel at the top of the dashboard with a `<TextField select>` profile picker. Loads `listApplicationProfiles()` on mount; persists the last-used id to `localStorage` under `afm:selectedApplicationProfileId` and restores it on the next visit. Shows the empty-state CTA (link to `/profiles`) when no profiles exist. Gates the Apply per-row button, the Retry per-row button, and the Apply to All button on `selectedProfileId !== null`. `handleApplyToJob` / `handleStartBatchApply` send the selected profile id to the API.
- **`client/src/pages/JobViewPage.tsx`** — `handleApply()` now reads the same `afm:selectedApplicationProfileId` localStorage key; if no profile is selected, surfaces "Pick an application profile on the Apply dashboard before applying." rather than calling the API.
- **`client/src/pages/ApplicationDashboardPage.test.tsx`** + **`client/src/pages/JobViewPage.test.tsx`** — Both files now polyfill `window.localStorage` at the top of the file with an in-memory `Map`-backed Storage stub, because the configured jsdom env doesn't expose a real Storage. Added cases asserting the new gating behavior (no-profiles empty state, disabled buttons until a profile loads, localStorage restore picks the prior selection, JobViewPage's "pick a profile" guard fires when localStorage is empty).
- **`tests/playwright/applicationProfiles.spec.ts`** (new) — End-to-end: opens `/profiles`, creates a profile via the dialog, edits it, confirms the renamed profile appears in the `/apply` dashboard picker, deletes it, then asserts the dashboard always shows either the picker or the empty-state CTA.

### Verification
- `npx vitest run server/src/routes/applicationProfiles.test.ts` → 18/18 passing.
- `npx vitest run server/src/routes/jobApplications.test.ts server/src/services/jobApplicationService.test.ts` → 88/88 passing under the new profile-required regime.
- `npx vitest run client` → 232/232 passing including the new dashboard / JobView gating cases and the new applicationProfilesApi unit tests.
- `npm run dev:claude` → boots cleanly; the seed creates "Default" from `user_info.json` on first run (visible at `GET /api/application-profiles`).
- Manual MCP-driven Playwright session against the live dev server: `/profiles` lists the seeded Default, opens the New Profile dialog, fills out fields including selecting "US Citizen" from the work-auth dropdown, saves, the new row appears in the table, `/apply` auto-selects the just-created profile in the picker, the picker dropdown shows both options, the delete confirmation works and the row disappears. No console errors other than the unrelated favicon 404.
- `npm run playwright:test -- tests/playwright/applicationProfiles.spec.ts` → 2/2 passing.
- After running `npx playwright install chromium` because the cached binary path was missing on this machine (separate from MCP's bundled browser).

---

## 2026-05-21 (later): Ship `resolutionProgressStore.ts` + `resolutionTypes.ts` into the managed-container image

### Intent
Reproduced the playwright test failures (`managedContainers.spec.ts`, `screenshotContainer.spec.ts`, all three `jobBoardBypass.spec.ts` cases) by spawning a container in a real Playwright-driven browser session. The host API returned 500 / readiness-timed-out at the spawn step; running the same image manually with `docker run` showed the real cause in the container's stdout: `Error: Cannot find module './resolutionProgressStore.js'` from `/app/server.ts`. The two new TypeScript files added in the live-admin-trace work (`resolutionProgressStore.ts`, `resolutionTypes.ts`) were referenced by `server.ts` and `resolutionProgressStore.ts` but were not being copied into the image, so the container's `npm start` crashed before Express could bind port 3000, the host's readiness poll timed out after 45 s, and `runContainer` rolled the container back. Fixed by copying both files in the Dockerfile and adding them to the dockerode build context's `src` array so `ensureImageBuilt` ships them on first call too.

### Files Modified
- **`docker/managed-container/Dockerfile`** — Added `COPY resolutionProgressStore.ts ./` and `COPY resolutionTypes.ts ./` between the existing `COPY smartproxy.ts ./` line and the `COPY entrypoint.sh /usr/local/bin/entrypoint.sh` line, so both modules land in `/app` alongside `server.ts` and `agent.ts`. No image stage / base / install change — only the COPY surface widened.
- **`server/src/services/dockerContainerService.ts`** — In `ensureImageBuilt`, added `"resolutionProgressStore.ts"` and `"resolutionTypes.ts"` to the `src: [...]` array passed to `docker.buildImage`. Without this, dockerode would tar up only the previous file list when building the image in-process from a fresh `npm run dev` boot (matching the Dockerfile is necessary but not sufficient — the dockerode call has its own explicit allowlist). No build-context path or image tag change.

### Verification
- Manual Playwright browser session: `/containers` → "New Container" → spawn now succeeds in <40 s, table shows the running container with a host port assigned, delete button removes it cleanly.
- `npm run docker:build` from a clean state: image builds with the two new files included (visible in the build output as `[14/17] COPY resolutionProgressStore.ts ./` and `[15/17] COPY resolutionTypes.ts ./`).
- `npm run playwright:test` end-to-end: the 5 previously-failing infrastructure tests (`managedContainers`, `screenshotContainer`, all 3 `jobBoardBypass`) now pass. 9 of 10 tests pass overall. The 1 remaining failure (`addAndViewJob.spec.ts:43` — "should show job in the jobs list after adding") is unrelated test-data accumulation: the test inserts the same URL `https://example.com/jobs/list-test` into the dev SQLite each run and `getByText` later trips strict-mode once the URL is present multiple times. Pre-existing flake, not caused by this change.

---

## 2026-05-21: Point `playwright:test` npm script at its config file

### Intent
The `playwright:test` script in `package.json` invoked `npx playwright test` from the repo root with no `-c` flag. The Playwright config lives at `tests/playwright.config.ts`, not at the project root, so Playwright silently ignored it, defaulted to scanning the cwd, and tried to execute every vitest `.test.tsx` file as a Playwright test. Those files import from `vitest`, which is ESM-only, so Playwright's CommonJS loader crashed with "Vitest cannot be imported in a CommonJS module using require()". Fixed by passing `-c tests/playwright.config.ts` to the command so Playwright loads the correct config and only runs files under `tests/playwright/`.

### Files Changed
- `package.json` — updated the `playwright:test` script from `npx playwright test` to `npx playwright test -c tests/playwright.config.ts`.

## 2026-05-21: npm scripts for rebuilding the managed-container Docker image

### Intent
Give the user a one-shot way to rebuild the managed-container Docker image from the host shell so that the next `npm run dev` (which internally calls `ensureImageBuilt` in `server/src/services/dockerContainerService.ts`) picks up the fresh image. Two scripts: a normal build that respects Docker's layer cache (fast, common case after editing one file) and a `--no-cache` rebuild (slow, used when something outside the COPY list — e.g. apt or `npx patchright install` — needs to be re-run).

### Files Modified
- **`package.json`** — Added two scripts under `"scripts"`: `"docker:build": "docker build -t afm-managed-container:latest ./docker/managed-container"` and `"docker:rebuild": "docker build --no-cache -t afm-managed-container:latest ./docker/managed-container"`. Image tag and build-context path match the constants `IMAGE_TAG` and `IMAGE_BUILD_CONTEXT` in `server/src/services/dockerContainerService.ts` so the resulting image is what dockerode will use when the dev server spawns a managed container.

## 2026-05-18: Live admin trace page for the application-URL resolver

### Intent
Today the resolver runs fire-and-forget in the server, persists a single `ApplicationUrlResolutionLog` row at the end, and the UI infers completion only by polling `application_url` / `status`. There is no live surface for an admin to watch the multi-step process (direct-host check → apply-button scrape → Brave search → per-candidate scrape + match → finalize). This change adds an admin-facing page at `/jobs/:id/url-resolution` that shows every step as it happens, with raw payloads expandable per row. The container hosts the live progress map (the server pushes step events to it as each phase runs); the durable post-mortem still lives in `application_url_resolution_logs`. The "Retry Find Application URL" button on `JobViewPage` now navigates to the trace page after triggering the resolver, and is replaced by a "View Resolution Progress" link whenever an in-progress attempt is detected (via a new `resolution_in_progress` field on `GET /:id`).

### Files Added
- **`docker/managed-container/resolutionTypes.ts`** — TS enums mirrored from the server's source-of-truth: `ResolutionPhase`, `StepStatus`, `ApplicationUrlResolutionOutcome`. Three guards (`isResolutionPhase`, `isStepStatus`, `isApplicationUrlResolutionOutcome`) HTTP handlers use to validate inbound wire values.
- **`docker/managed-container/resolutionProgressStore.ts`** — In-memory progress map keyed by `logId`. Exports `begin(logId, jobListingId)`, `recordStep(logId, step)`, `finalize(logId, outcome, applicationUrl, reason)`, `get(logId)`, `clear(logId)`, `clearAll()`. Schedules a 10-minute eviction timer on `finalize`. Every call emits a structured `[resolver:step ...]` / `[resolver:attempt ...]` stdout line so admins can follow along via `docker logs`.
- **`docker/managed-container/resolutionProgressStore.test.ts`** — 13 vitest cases: begin/replace, recordStep insert+overwrite, placeholder synthesis on missing begin, finalize state + TTL eviction (fake timers), unknown-logId warn, re-begin clears the eviction timer, clear/clearAll behavior.
- **`client/src/pages/UrlResolutionTracePage.tsx`** — New admin trace page at `/jobs/:id/url-resolution`. Polls `GET /api/job-listings/:id/url-resolution/live` every 1 s while `isFinished === false`. Renders a header card (status chip, log id, elapsed, step count, resolved URL or reason), then a steps timeline rendered as MUI `Accordion` rows that expand to a `<pre>` JSON dump of the step payload. Includes helpers `colorForStepStatus`, `colorForFinalOutcome`, `formatElapsed`, `StepRow`.
- **`client/src/pages/UrlResolutionTracePage.test.tsx`** — 20 vitest cases: empty state, in-progress header, step rendering, accordion expand reveals payload, polling stops on terminal, reason banner, error paths (Error + non-Error), elapsed formatting for ms / s / unparseable, every status-chip variant, invalid id, JobListing fetch failure silently tolerated, empty-payload row.

### Files Modified
- **`server/prisma/schema.prisma`** — `ApplicationUrlResolutionLog`: `outcome` becomes nullable (null while running); new `managed_container_id Int?` + `managed_container ManagedContainer? @relation` with `onDelete: SetNull`; existing loose `job_listing_id` upgraded to a real `@relation` with `onDelete: Cascade`. Added reverse `resolution_logs ApplicationUrlResolutionLog[]` collections on `JobListing` and `ManagedContainer`. Ran `npx prisma db push && npx prisma generate`.
- **`server/src/services/applicationUrlResolverService.ts`** — Added exported enums `ResolutionPhase` and `StepStatus` (string-valued, JSON-safe). Added optional `progressReporter: ResolverProgressReporter` to `ResolverInput`; the interface exposes `startStep / endStep / finalize`. The resolver body now wraps every phase in a `safeStartStep` / `safeEndStep` pair (helpers that catch+log reporter errors so a flaky sink can't abort the resolution), and ends every code path with a `safeFinalize` call. Added new helper `createContainerProgressReporter(hostPort, logId)` that maps each reporter call into an HTTP POST against `/resolution-progress/:logId/*`, with a local monotonic stepIndex and per-step timing/payload merge. Existing returning shape is unchanged so callers that don't pass a reporter behave exactly as before.
- **`server/src/services/applicationUrlResolverService.test.ts`** — Added 17 new tests in two new describe blocks: `resolveApplicationUrl with progressReporter` (asserts the expected sequence of `startStep/endStep/finalize` for every outcome path — direct, redirect, search-hit, not-found, malformed URL, no-container, apply-button-scrape failure, build_query failure, brave-search failure, candidate-scrape failure, and progressReporter throw-suppression), and `createContainerProgressReporter` (asserts POST URLs, body shapes, durationMs, payload merge, fallback message, unknown-stepIndex defaults, network-error suppression). New `makeStubReporter()` helper. Added `afterEach` import.
- **`server/src/routes/jobListings.ts`** — 
  - Replaced `persistResolutionLog` with two new helpers: `beginResolutionLog(jobListingId, container)` (INSERTs the log row with `managed_container_id` and `outcome: null` up-front, then best-effort POSTs `/resolution-progress/:logId/begin` to the container) and `finalizeResolutionLog(logId, outcome, trace)` (UPDATEs the existing row with the terminal fields).
  - `scrapeAndUpdateJobListing` now takes the full container object (`{id, hostPort}`) instead of just `hostPort`, threads the chosen container into the new log lifecycle, and passes a `createContainerProgressReporter`-built reporter into the resolver.
  - `runResolverForExistingListing` now takes both the container and a pre-allocated `logId` parameter (so the retry route can INSERT the row synchronously before returning 202, avoiding a race where the frontend's first poll lands before the resolver starts).
  - `POST /:id/resolve-application-url` no longer mutates `JobListing.status` to "init" — in-progress state is now signaled by the freshly-inserted log row's `outcome=null`. Returns 202 with `{ ...jobListing, latest_resolution_log_id: logId }`.
  - `GET /:id` now augments the response with `resolution_in_progress: boolean` and `latest_resolution_log_id: number | null`, both derived from a `findFirst` on the log table for this listing.
  - New endpoint **`GET /api/job-listings/:id/url-resolution/live`** that returns a `LiveProgress` JSON. While the latest log row has `outcome=null`, it proxies the container's `GET /resolution-progress/:logId`. On terminal log rows, it returns a synthesized `LiveProgress` built from the durable fields via new helper `buildTerminalLiveProgressFromLog`. On a missing container, unreachable container, 404 from container, or non-2xx from container, it returns a "crashed" payload built via new helper `buildCrashedLiveProgressPayload` so the trace page can exit its polling loop cleanly.
  - `ParsedResolutionLog` interface extended with `managed_container_id: number | null`; `outcome` widened to `string | null`. `parseResolutionLogRow` updated to surface the new column.
- **`server/src/routes/jobListings.test.ts`** — Added `applicationUrlResolutionLog.update` / `findFirst` and `managedContainer.findUnique` to the Prisma mock factory. Added `createContainerProgressReporter` to the resolver-service mock (stubbed to no-op). New `beforeEach` defaults populate sensible return values for the new mocks and stub global `fetch`. Updated the existing log-persist tests to match the new INSERT-first / UPDATE-on-finalize flow (5 cases). Added 4 new cases under `POST /:id/resolve-application-url` (placeholder INSERT, non-Error spawn rejection, container `/begin` POST failure). Added 3 new cases under `GET /:id` for the `resolution_in_progress` field. New `GET /:id/url-resolution/live` describe block with 11 cases covering the in-progress proxy path, terminal synthesis, 404 paths, container-unreachable / 404 / 500 fallback variants, missing-container, malformed JSON tolerance, non-array JSON tolerance, candidate-defaulting, and the finalize-step message fallback for null `reason`.
- **`docker/managed-container/server.ts`** — Added four endpoints under `/resolution-progress/:logId/*`: `POST /begin` (calls `begin(logId, jobListingId)`), `POST /step` (calls `recordStep(logId, ...)` with full enum validation on `phase` and `status`), `POST /finalize` (calls `finalize(logId, ...)` with enum validation on `finalOutcome`), and `GET /` (returns the LiveProgress JSON or 404). New `parseLogIdParam(req, res)` helper centralizes the integer/positivity guard. New imports from `resolutionTypes.js` and `resolutionProgressStore.js`.
- **`docker/managed-container/tsconfig.json`** — Added `resolutionProgressStore.ts`, `resolutionTypes.ts`, and `*.test.ts` to `include`; set `types: ["vitest/globals"]` so the lint config's projectService can resolve vitest symbols.
- **`client/src/services/jobListingsApi.ts`** — Extended `JobListingResponse` with `resolution_in_progress: boolean` and `latest_resolution_log_id: number | null`. Added mirrored enums `ResolutionPhase`, `StepStatus`, `ApplicationUrlResolutionOutcome`. Added types `LiveStep`, `LiveProgress`. Added method `getLiveUrlResolution(id)` that returns the LiveProgress JSON or `null` when the server reports no resolution attempts (404 body recognized by message text).
- **`client/src/services/jobListingsApi.test.ts`** — Added `resolution_in_progress` and `latest_resolution_log_id` to the `mockListing` fixture so it matches the extended interface. Added a new `getLiveUrlResolution` describe block with 4 cases (happy path, 404→null mapping, non-404 error rethrow, non-Error rejection rethrow).
- **`client/src/App.tsx`** — Added `<Route path="/jobs/:id/url-resolution" element={<UrlResolutionTracePage />} />` and imported the new page.
- **`client/src/pages/JobViewPage.tsx`** — Imported `useNavigate` + `Link as RouterLink` from react-router-dom and the MUI `Timeline` icon. Added `isResolutionInProgress` derived from `jobListing.resolution_in_progress`. When true, renders a `<Button component={RouterLink}>` ("View Resolution Progress") in place of the Retry button. When false and a past attempt exists (`latest_resolution_log_id !== null`), renders an additional "View Resolver Trace" link button. `handleRetryResolveApplicationUrl` now `navigate(...)`s to `/jobs/:id/url-resolution` after the resolver POST succeeds.
- **`client/src/pages/JobViewPage.test.tsx`** — Added `resolution_in_progress: false` and `latest_resolution_log_id: null` to every fixture (replace_all). 3 new cases in `JobViewPage — application_url resolution UI`: link replaces retry when in-progress, retry click navigates to the trace page (mounted in a second route), and "View Resolver Trace" link renders when a past attempt exists.
- **`client/src/components/JobList.test.tsx`**, **`client/src/pages/JobsListPage.test.tsx`**, **`client/src/components/AddJobForm.test.tsx`**, **`client/src/pages/AddJobPage.test.tsx`** — Added the two new fields to every JobListingResponse fixture so TypeScript compiles cleanly.
- **`tests/playwright/applicationUrlResolution.spec.ts`** — Added a third test: navigate to the trace page on a fresh job, assert the empty-state copy and the "Back to Job View" link are visible.

### Behavioral notes
- The container is the source of truth for live progress for as long as the attempt is running (and 10 minutes after it finishes). After the eviction TTL or a container restart, the trace page falls back to a synthesized LiveProgress built from the durable log row's `brave_results` and `inspected_candidates` columns — so the page still renders meaningfully even after the in-memory entry is gone. If the latest log row has `outcome=null` but the container can't be reached / 404s / 500s, the server returns a synthesized terminal "crashed" payload (`finalOutcome: null`, descriptive `reason`) so the polling client exits its loop cleanly rather than spinning forever.
- Step events are pushed best-effort from the server to the container: any failure (timeout, container down, 500) is caught and logged with a `[resolver:reporter] ...` warning but never aborts the resolution. This is important because the resolver's HTTP delegation goes through the *same* container for both scrapes and progress; a transient blip on one shouldn't kill the other.
- The `safeStartStep` / `safeEndStep` / `safeFinalize` wrappers around the optional reporter mean that omitting the reporter entirely (the unit-test path and any direct programmatic caller) yields identical behavior to today, while flaky reporters never disrupt the resolution. `safeStartStep` returns `-1` as a sentinel when the reporter is missing or threw; subsequent `safeEndStep` calls with that sentinel are no-ops.
- The two new schema relations (`job_listing` and `managed_container`) tighten referential integrity. `onDelete: Cascade` on `job_listing` matches the semantics of the other per-job tables (when a job is deleted, its history should go with it). `onDelete: SetNull` on `managed_container` preserves the resolver history even if the operator deletes the container that ran the attempt — the log row sticks around for audit purposes.

### Coverage
After all changes: 590 tests across 29 files, all passing. `npm run test:coverage` shows statements 98.62, branches 93.24, functions 98.20, lines 99.03 — all above the configured thresholds (98 / 93 / 98 / 98). No threshold lowered. `npm run lint` clean.

---

## 2026-05-17 (later): Auto-spawn a managed container when one isn't running on Fetch Data / Retry

### Intent
The fetch and resolve-application-url routes previously returned `503` when no managed container was running, forcing the user to go to the Containers page first and click "New Container" manually. That's friction: Fetch Data needs a container as an implementation detail, not as a user-visible concept. Now both routes auto-spawn a container synchronously if none exists, so clicking Fetch Data Just Works™.

### Files Added
- **`server/src/services/managedContainerService.ts`** — New service module that consolidates the high-level container lifecycle.
  - `spawnAndRegisterContainer(name?)` — extracted from the body of `POST /api/managed-containers`. Generates a name (or uses the provided one), validates, checks DB uniqueness, calls `runContainer`, persists the row, rolls back the docker container on DB-insert failure. Returns the full `ManagedContainer` Prisma row.
  - `findOrSpawnRunningContainer()` — the convenience wrapper the fetch + resolve routes use. Returns the first running container's `{id, hostPort}` if any exist, otherwise calls `spawnAndRegisterContainer()` and returns the new row.
  - `SpawnContainerError` class with a `kind` discriminator (`"invalid_name" | "name_taken" | "docker_failed" | "db_failed"`) so route handlers can map structured failures to the right HTTP status without parsing error strings.
  - `isPrismaUniqueViolation(err)` — exported helper (was previously private to the route).
- **`server/src/services/managedContainerService.test.ts`** — 17 tests covering `isPrismaUniqueViolation`, the `SpawnContainerError` shape, every spawn-failure mode (invalid name, name taken, docker reject, P2002 race, generic DB failure, rollback success, rollback failure), and `findOrSpawnRunningContainer`'s find-vs-spawn branches.

### Files Modified
- **`server/src/routes/managedContainers.ts`** — `POST /api/managed-containers` is now a thin wrapper over `spawnAndRegisterContainer`. Translates `SpawnContainerError.kind` → HTTP status via a new `spawnErrorToHttpStatus(kind)` helper. Imports trimmed: no longer pulls `generateContainerName / isValidContainerName / runContainer` directly. The old in-route `isPrismaUniqueViolation` private function is removed (now lives in the service).
- **`server/src/routes/jobListings.ts`** — `POST /:id/fetch` and `POST /:id/resolve-application-url` both call `findOrSpawnRunningContainer()` instead of `findFirstRunningContainer()`. On `SpawnContainerError` or any other rejection, return `503` with the underlying message. JSDoc updated to document the new auto-spawn behavior.
- **`server/src/routes/jobListings.test.ts`** — swapped mock module to `../services/managedContainerService.js` (with a class-in-mock-factory declaration of `SpawnContainerError` so `instanceof` checks resolve consistently). All `findFirstRunningContainer` mock setups replaced with `findOrSpawnRunningContainer`. Old "503 when no running container exists" tests replaced with three new tests: auto-spawn happy path, spawn-failure with `SpawnContainerError`, spawn-failure with a non-Error reason. Same pattern applied to the resolve-application-url route tests.
- **`client/src/components/AddJobForm.tsx`** — The "no managed container is running" alert was severity `warning` with copy implying the user had to spawn one manually. Flipped to severity `info` with friendlier copy: "Fetch Data will spin one up automatically the first time it runs (this may add ~30s on the first request)." Data-testid unchanged so existing tests still find it.

### Behavioral notes
- The auto-spawn is synchronous within the route handler — the 202 response is held until the container is registered and ready (per `runContainer`'s readiness poll, ~10s warm / ~30s+ cold). This is deliberate: returning 202 first and spawning async would mean the user sees "Fetch started" then later sees the row never updates, which is confusing.
- Race condition between two simultaneous fetches both seeing no container: each spawns one. The second spawn won by `name_taken` would actually fail because `generateContainerName()` uses 6 random bytes (collision astronomically unlikely). Worst case: one extra container the user can clean up manually. Not worth a lock yet.
- The resolver service still calls `findFirstRunningContainer` internally as a defensive check; with the route-level auto-spawn that branch should never fire in practice but provides belt-and-suspenders for direct service usage.

### Verification
- `npm run tsc`: clean (client + server)
- `npm run lint`: clean
- `npm run test`: **513 passing** (was 492; +17 new service tests, +4 route tests, -3 stale "503 no container" tests replaced with new spawn-failure tests)
- `npm run test:coverage`: **98.69 stmt / 93.52 branch / 98.38 func / 99.19 line** — clears 98/93/98/98

## 2026-05-17: Don't bail to not_found on apply-button re-scrape failure — fall through to web search

### Intent
The resolver was returning `not_found` with `"Failed to inspect apply button on the original page: fetch failed"` whenever the smart-proxy re-scrape of the original URL threw — observed against a real Indeed listing. The re-scrape failure is a soft signal (we lose the off-platform-redirect hint), not a hard one: the caller-supplied title + description are enough to run the Brave search step, which is what the user would do manually anyway. Bailing was hiding a recoverable failure mode.

### Files Modified
- **`server/src/services/applicationUrlResolverService.ts`** — In the apply-button re-scrape branch of `resolveApplicationUrl`, the `catch` block now logs a WARN (`[resolver] apply-button re-scrape failed; continuing to search: ...`), sets `applyButtonUrlForDecision = null`, and falls through to the existing search step. The function no longer early-returns `not_found` on this failure. Updated the surrounding comment to document the intentional non-fatal behavior.
- **`server/src/services/applicationUrlResolverService.test.ts`** — Removed the prior `"returns 'not_found' when the re-scrape of the original URL throws"` assertion (the behavior it locked in is now wrong). Replaced with two new tests:
  1. `"falls through to web search when the re-scrape of the original URL throws (does not bail)"` — mocks `scrapeJobViaContainer` to reject on the first call (the re-scrape) and resolve on the second (the candidate inspection), asserts the outcome is `resolved_via_search` and that `trace.applyButtonUrlConsidered` is null.
  2. `"still produces a not_found outcome when re-scrape fails AND search yields no match"` — covers the combined-failure case, asserts the reason now reflects the search step (`/Inspected/`) rather than the re-scrape failure.

### Verification
- `npm run tsc`: clean
- `npm run lint`: clean
- `npm run test`: **492 passing** (was 491; one assertion replaced by two new ones)
- `npm run test:coverage`: **98.74 stmt / 94.22 branch / 98.35 func / 99.24 line** — unchanged, still clears the 98/93/98/98 thresholds

## 2026-05-16 12:20 EDT: Persist application-URL resolution traces; surface Brave results + per-candidate verdicts in the UI

### Intent
The first end-to-end run of the resolver against a real LinkedIn URL surfaced the limitation that we only inspect the static `href` attribute on the apply button — and that LinkedIn/Indeed wrap their apply CTAs in same-domain redirects, so the `resolved_via_redirect` branch is effectively dead for those platforms. When a job falls through to `resolved_via_search` (or worse, `not_found`), there was no way to inspect what the resolver actually saw: which Brave results came back, which candidates were inspected, and why each was accepted/rejected. This change adds a persistent per-attempt trace and a UI panel to render it.

### Schema (`server/prisma/schema.prisma`)
- New enum `ApplicationUrlResolutionOutcome { direct, resolved_via_redirect, resolved_via_search, not_found }` — mirrors the discriminated `ResolverOutcome` so queries are type-safe.
- New model `ApplicationUrlResolutionLog` with columns: `id`, `job_listing_id`, `outcome`, `search_query` (nullable when resolver short-circuited before search), `brave_results` (TEXT, JSON-encoded `BraveSearchResult[]`), `inspected_candidates` (TEXT, JSON-encoded `InspectedCandidate[]`), `final_application_url` (nullable), `reason` (free-text, populated on not_found), `created_date`. Indexed on `(job_listing_id, created_date)` for fast latest-log lookups.
- JSON-as-TEXT (rather than Prisma's `Json`) matches the existing `ApplicationAttemptLogs.logs` convention; route layer parses to structured arrays before responding to clients.
- Ran `npx prisma db push` + `npx prisma generate`.

### Resolver (`server/src/services/applicationUrlResolverService.ts`) — substantial rewrite
- New interfaces `InspectedCandidate { url, scrapedTitle, matched, rejectionReason }`, `ResolutionTrace { applyButtonUrlConsidered, searchQuery, braveResults, inspectedCandidates }`, `ResolveApplicationUrlResult { outcome, trace }`.
- `resolveApplicationUrl` return type changed from `ResolverOutcome` → `ResolveApplicationUrlResult`. Builds the trace progressively as it executes each step. The early-exit paths (malformed URL, no container available, missing search query) all return a fully-populated shape with empty trace collections.
- Per-step `console.log` at INFO level (per CLAUDE.md "name what you're checking" style): `[resolver] outcome=direct host=acme.com`, `[resolver] applyButtonUrl=...`, `[resolver] searching brave query="..."`, `[resolver] brave returned=N result(s)`, `[resolver] candidate=URL scrapedTitle="..." verdict=accept|reject reason="..."`, `[resolver] outcome=not_found inspected=N candidate(s) without a match`. Watching the dev server now lets you follow the resolver step-by-step.
- Candidate-scrape failures are now recorded in the trace as a candidate with `matched: false` and `rejectionReason: "scrape failed: ..."` rather than silently skipped — visible in the UI.
- Now imports `evaluateJobMatch` (new — see `jobMatchService.ts` below) instead of `isSameJob` so per-candidate rejection reasons can be persisted verbatim.

### Match service (`server/src/services/jobMatchService.ts`)
- Added `evaluateJobMatch(input)` returning `{ matched, reason }`. The `reason` field surfaces:
  - `"original title is empty after normalization"`
  - `"candidate title is empty after normalization"`
  - `"title mismatch (original=\"X\", candidate=\"Y\")"`
  - `"description token overlap 23% below 40% threshold"`
  - `"title matched and description overlap 60% >= 40%"` (success case)
- `isSameJob` is now a one-line boolean wrapper around `evaluateJobMatch().matched` for backwards-compat call sites that don't need the reason. No external behavior change.

### Route (`server/src/routes/jobListings.ts`)
- New helper `persistResolutionLog(jobListingId, outcome, trace)` — inserts one row into `application_url_resolution_logs`, JSON-stringifying the two array columns. Best-effort: a persist failure is logged and swallowed so it doesn't block the actual `JobListing.application_url` update.
- Both call sites (initial-fetch `scrapeAndUpdateJobListing` and retry `runResolverForExistingListing`) now destructure `{ outcome, trace }` from the resolver result and persist the log before applying the outcome to the row.
- New `GET /api/job-listings/:id/resolution-logs` route — returns every attempt for the job, newest first. Parses the two JSON columns server-side via the new `parseResolutionLogRow` helper, which tolerates malformed historical rows by falling back to `[]` (one corrupt row never breaks the whole list).

### Frontend
- `client/src/services/jobListingsApi.ts` — new `ResolutionLog`, `ResolutionLogBraveResult`, `ResolutionLogInspectedCandidate` interfaces; new `getResolutionLogs(id)` function calling the new endpoint.
- New component `client/src/components/ResolutionTracePanel.tsx`. Always rendered on `JobViewPage`, collapsed by default. Expanded view shows: outcome chip + timestamp; the search query (or "Search was skipped" for the direct path); the adopted URL (when present); the not_found reason; the full Brave results list as clickable links; the inspected candidates list with per-candidate verdict chip ("matched" / "rejected") + scraped title + rejection reason. Earlier attempts collapse to a single-line summary beneath the latest.
- `JobViewPage` — new `traceRefreshToken` state. Two `useEffect`s bump the token when:
  - the resolver retry finishes (`application_url` filled OR status flipped to `missing_form_url`)
  - the initial Fetch Data resolver finishes (title becomes non-empty after the fetch flag clears)
  
  The token prop on `ResolutionTracePanel` triggers a re-fetch so the panel reflects the new attempt without a manual reload.

### Test plan + verification
- Rewrote `applicationUrlResolverService.test.ts` for the new return shape (24 → 24 tests, all `result.outcome.outcome` now). New tests verify the trace contents on each outcome path (matched candidate recorded, gated candidates skipped but counted in brave_results, scrape-failure rejection reason, candidate cap).
- Added 6 new tests to `jobMatchService.test.ts` for `evaluateJobMatch` covering each rejection-reason branch + the success case.
- Added 3 test blocks to `jobListings.test.ts`: persistResolutionLog success (verifies the create-call shape including JSON-stringified columns), not_found persistence, log-persist failure swallow (Error + non-Error), GET resolution-logs route (200/404/400/empty array), and `parseResolutionLogRow` (valid JSON, malformed JSON, non-array JSON).
- New component test file `client/src/components/ResolutionTracePanel.test.tsx` — 9 tests covering: collapsed default state, expansion shows query/results/candidates, not_found reason renders, "Search was skipped" message on direct path, earlier-attempts list, empty state, fetch-error Error/non-Error paths, refreshToken triggers re-fetch.
- Added `getResolutionLogs` tests to `jobListingsApi.test.ts`.

### Final gauntlet
- `npm run tsc`: clean (client + server)
- `npm run lint`: clean
- `npm run test`: **491 passing** (was 463 before this change)
- `npm run test:coverage`: **98.74 stmt / 94.22 branch / 98.35 func / 99.24 line** — clears thresholds (98 / 93 / 98 / 98)
- Manual end-to-end verification: deferred (the previous-day run against the Giga LinkedIn URL exercised the same resolver code path; the trace persistence is additive and will be visible on the next live run)

## 2026-05-16 08:30 EDT: Resolve off-platform application_url for Indeed/LinkedIn jobs; replace Browser-Use scraper with smart-proxy

### Intent
Indeed and LinkedIn job postings frequently route the user through a login wall or a host-specific apply flow, blocking the auto-apply pipeline. Added a resolver that finds the real off-platform application form for each job and stores it on a new `application_url` column. The resolver inspects the apply button on the original page; if that points off-platform, adopt it; otherwise web-search for the company+role and inspect each non-gated candidate via the smart-proxy `/analyze` until one matches the original title + description. When nothing matches, the JobListing status flips to a new `missing_form_url` value, which surfaces a warning callout and a Retry button on the view page and blocks the apply pipeline until resolved.

In the same pass, the smart-proxy `/analyze` agent replaces the Browser-Use SDK scraper end-to-end — the agent's `report` tool now returns structured `title / company / description / salary / post_date / apply_button_url` alongside the existing verdict fields. Browser-Use is still used for the actual application flow (filling out forms) but is no longer used for the description scrape.

### Algorithm (server/src/services/applicationUrlResolverService.ts)
1. If `originalUrl`'s host is not linkedin.com / indeed.com → `direct`, `application_url = originalUrl`.
2. Inspect the apply button URL from the smart-proxy scrape. If it points off-platform → `resolved_via_redirect`.
3. Otherwise web-search `"{company} {title}"` via Brave Search API; for each non-gated candidate URL (capped at 5), run `/analyze` and call `isSameJob` (exact title match + ≥40% description token overlap with stop-word filter). First match → `resolved_via_search`.
4. No match → `not_found`; caller flips `JobListing.status` to `missing_form_url`.

### Files Added
- **`server/src/services/braveSearchService.ts`** — `searchWeb(query, limit)`. Reads `BRAVE_SEARCH_API_KEY` env, uses `AbortSignal.timeout(8000)`. Filters malformed/non-http(s) results.
- **`server/src/services/braveSearchService.test.ts`** — 11 tests: missing/empty key, empty query, happy path, filtered results, missing description default, missing `web.results`, non-2xx, fetch-thrown-Error, fetch-thrown-non-Error, count param.
- **`server/src/services/jobMatchService.ts`** — `normalizeForMatch`, `tokenizeDescription` (stop-word filter, drops <3-char tokens), `computeOverlapRatio` (asymmetric — denominator is the original set), `isSameJob`. Constant `MIN_DESCRIPTION_TOKEN_OVERLAP_RATIO = 0.40`.
- **`server/src/services/jobMatchService.test.ts`** — 17 tests covering normalize/tokenize/overlap/isSameJob edge cases.
- **`server/src/services/smartProxyScraperService.ts`** — `findFirstRunningContainer()` (Prisma query, ordered by id), `scrapeJobViaContainer(hostPort, url, useProxy=true)` (POSTs to `http://127.0.0.1:{hostPort}/analyze`, uses `AbortSignal.timeout(120000)`).
- **`server/src/services/smartProxyScraperService.test.ts`** — 6 tests: findFirst happy/null, POST shape, useProxy override, non-2xx with JSON error, non-2xx without JSON body.
- **`server/src/services/applicationUrlResolverService.ts`** — exports `resolveApplicationUrl`, `isGatedHost`, `tryGetHostname`, `buildSearchQuery`. Accepts an optional pre-scraped `originalApplyButtonUrl` so the initial-fetch path avoids a redundant scrape; the retry path omits it and forces a re-scrape.
- **`server/src/services/applicationUrlResolverService.test.ts`** — 17 tests covering all four outcomes + edge cases (malformed URLs, gated apply-button hint, missing container, search failure with Error and non-Error, candidate cap, candidate-scrape failure recovery, empty-query short-circuit).
- **`tests/playwright/applicationUrlResolution.spec.ts`** — 2 tests: apply button hidden on fresh add (the gate), source-url link present with `target="_blank"`.

### Files Modified
- **`server/prisma/schema.prisma`** — Added `application_url String?` to `JobListing` and `missing_form_url` to the `JobStatus` enum. Ran `npx prisma db push` + `npx prisma generate`.
- **`docker/managed-container/agent.ts`** — Extended `AnalyzeResult` with `title / company / description / salary / post_date / apply_button_url`. Extended the `report` tool's `input_schema` to require LLM-extracted `title / company / salary / post_date` (the description comes from container-side `mainText`; `apply_button_url` comes from container-side parsing of `applyButtons[0].href` — the LLM doesn't do URL math). Added `PageSnapshot` type + `parsePageSnapshot` helper; `runAnalyzeAgent` now stashes the latest snapshot after each `get_page_summary` and merges it into the final report. `SUMMARY_HELPER_SCRIPT` now resolves applyButton hrefs to absolute via `new URL(rawHref, location.href)` and bumps `mainText` cap from 600 to 10000 chars to fit a full description. System prompt updated with extraction guidance.
- **`docker/managed-container/server.ts`** — Updated `/analyze` JSDoc to reflect the new response shape.
- **`server/src/routes/managedContainers.ts`** — Updated `/api/managed-containers/:id/analyze` JSDoc.
- **`client/src/services/managedContainersApi.ts`** — Extended `AnalyzeResponse` interface with the 6 new fields.
- **`server/src/routes/jobListings.ts`** (substantial rewrite) — `scrapeAndUpdateJobListing` now uses `scrapeJobViaContainer` (no more Browser-Use SDK call, no LinkedIn credentials path); after scrape, calls `resolveApplicationUrl` and persists the outcome via new `applyResolverOutcomeToListing` helper. `POST /:id/fetch` validates a running container exists (returns 503 with actionable error if not) before kicking off async work. New `POST /:id/resolve-application-url` retry endpoint resets status to `init` and re-runs the resolver against the persisted title+description. New `splitFormattedTitle` helper splits stored `"Company - Title"` strings for the retry path.
- **`server/src/routes/jobApplications.ts`** — Apply gate: 400 when `application_url` is null/empty. `applyToJob` now drives the application against `application_url` (off-platform form), not the original posting. Batch flow's findMany filters on `application_url: { not: null }` and similarly uses `application_url` to drive each apply. Removed the dead `enrichJobListingDetails` helper (apply now requires the row to be scraped first, so post-apply enrichment was unreachable).
- **`server/src/routes/jobListings.test.ts`** (rewritten) — Mocks the new services; new tests for the 503 no-container path, 202 happy path, resolver-direct/redirect/not_found persistence, parsePostDate-null fallback, retry endpoint (400/404/503/202), scrape-failure swallow with Error and non-Error.
- **`server/src/routes/jobApplications.test.ts`** — Updated fixtures with `application_url`. New tests for the apply gate (null + empty-string + missing_form_url status). Updated batch tests to include `application_url` in job shape. Removed obsolete enrichment tests.
- **`client/src/services/jobListingsApi.ts`** — Added `application_url: string | null` to `JobListingResponse`; new `resolveApplicationUrl(id)` helper for the Retry button.
- **`client/src/components/JobList.tsx`** — Added `missing_form_url` to the chip config (`{ color: "warning", label: "No form URL" }`).
- **`client/src/pages/JobViewPage.tsx`** — New status chip config for `missing_form_url`. New "Application URL" link + Open Application button when `application_url` is set. Source URL link always shown (relabeled to "Source (job-details page)" when application_url exists). Warning Alert + Retry button when status is `missing_form_url`. New `handleRetryResolveApplicationUrl` handler + `isRetryingResolve` state; the poll effect now extends to keep polling while the retry is in flight; an effect clears `isRetryingResolve` once the row settles (either `application_url` populated or status returns to `missing_form_url`). Apply button is hidden unless `application_url` is set AND status is `init`/`error_applying`.
- **`client/src/components/AddJobForm.tsx`** — Probes `listManagedContainers()` on mount; renders an inline warning (`data-testid="no-container-warning"`) when none are running. Submission is still allowed — the warning is informational.
- **Several client test files** (JobList.test, JobsListPage.test, JobViewPage.test, AddJobPage.test, AddJobForm.test, ApplicationDashboardPage.test, jobListingsApi.test) — Added `application_url: null` to mock fixtures. JobViewPage tests rewritten where the old behavior assumed Apply was always visible; new tests assert the gate. New tests cover the Retry handler, missing-form-url alert, application/source link rendering, container-warning visibility.
- **`tests/playwright/addAndViewJob.spec.ts`** — Apply-button visibility assertion flipped to `toHaveCount(0)` to reflect the gate.

### Files Deleted
- **`server/src/services/jobListingScraperService.ts`** (Browser-Use scrape; replaced by smart-proxy)
- **`server/src/services/jobListingScraperService.test.ts`**
- **`server/src/scripts/fetchJobListing.ts`** (CLI script for the deleted service)
- **`server/src/scripts/linkedin_credentials.json`** (smart-proxy doesn't authenticate)
- **`server/src/scripts/linkedin_cookie.txt`**

The `browser-use-sdk` npm dependency stays — `jobApplicationService.ts` (the actual form-filling agent) still uses it.

### Verification
- `npm run tsc`: clean (client + server)
- `npm run lint`: clean
- `npm run test`: 449 passing → 480 passing after adding service + UI tests
- `npm run test:coverage`: **98.73 stmt / 93.99 branch / 98.21 func / 99.2 line** — clears thresholds (98 / 93 / 98 / 98)
- Manual end-to-end with a running container + Brave key: pending — needs a `BRAVE_SEARCH_API_KEY` set in `.env` and a spawned managed container. The Playwright spec exercises only the UI surfaces reachable without a container (apply gate + source link); the deeper flow (resolver outcome → DB → poll → UI) is for the manual-verifier agent against a live environment.



### Intent
On the single-container view page (`/containers/:id`), the green status `Chip` was hardcoded to the persisted DB `status` field and never reflected the container's actual liveness without the user clicking "Ping health". Now the page automatically fires a health ping after the container record loads, the Chip shows a loading state ("Checking..." with a small spinner) while a ping is in flight, turns green with the live status string on success, and turns red "unhealthy" on failure. Auto-ping failures stay silent in the Alert area (red chip only) so the page doesn't shout an error before the user has had a chance to interact; user-triggered ping failures additionally render the existing error Alert as before.

### Files changed
- **`client/src/pages/ContainerViewPage.tsx`**
  - Added `StatusChipProps` interface and `deriveStatusChipProps` pure selector with precedence: `isPinging` → loading; `pingError` → red "unhealthy"; `pingResult` → green with `pingResult.status`; otherwise fall back to `container.status`.
  - Added `hasUserPingedManually` state (default false) to gate the error Alert. Set to `true` only when the manual `handlePingHealth` runs.
  - Extracted the actual ping work into `runHealthPing(containerId, triggeredByUser)` via `useCallback` — shared by the auto-ping effect and the manual click.
  - Added a `useEffect` keyed on `[container, runHealthPing]` that fires `runHealthPing(container.id, false)` once the record loads. Re-runs if the loaded container's id changes (e.g. SPA-navigating between containers).
  - Reworked the `handlePingHealth` click handler to delegate to `runHealthPing` with `triggeredByUser=true`.
  - Replaced the static `<Chip color="success" label={container.status} />` with a dynamic `<Chip>` whose `color`, `label`, and `icon` come from `statusChipProps`. Added `data-testid="container-status-chip"` and `data-testid="container-status-spinner"` for testability.
  - Replaced `{pingError && <Alert ...>}` with `{shouldShowPingErrorAlert && <Alert ...>}` so auto-ping failures don't render the Alert.
- **`client/src/pages/ContainerViewPage.test.tsx`**
  - Added 4 tests: auto-ping happy path updates chip to "ok" with `colorSuccess`; auto-ping failure renders "unhealthy" with `colorError` and no Alert; manual ping loading shows spinner + "Checking..." (via a deferred Promise so the loading state is observable); manual ping failure shows BOTH the Alert and a red chip.
- **`tests/playwright/managedContainers.spec.ts`**
  - Added an assertion after navigating to the view page that `container-status-chip` shows "ok" within 30s, proving the auto-ping fires and updates the Chip without a click.

### Verification
- `npm run test`: 394 / 394 pass (22 files, 16 in `ContainerViewPage.test.tsx`).
- `npm run tsc`: clean.
- `npm run lint`: clean.
- `npm run test:coverage`: 98.83 stmt / 93.81 branch / 98.53 func / 99.2 line — clear of the project thresholds (98 / 93 / 98 / 98).
- `npm run check:duplication`: 21 pre-existing clones (all in `claude_tmp/`), no new clones.
- `/review`: no must-fix or should-fix items.
- Live browser verification: deferred — to be run by the user against a real managed container or by the `manual-verifier` agent.

## 2026-05-14 10:11 EDT: Shutdown cleanup sweeps every afm-image container, not just DB-tracked rows

### Intent
On SIGINT/SIGTERM the server previously only stopped + removed containers tracked in the `managed_containers` Prisma table, so a container spawned by `docker run` directly, one whose DB row was deleted out of band, or one that survived a previous unclean exit would outlive the server process. Expanded the cleanup to also stop+remove every container (running OR stopped) whose ancestor image is `afm-managed-container:latest`, deduped against the DB sweep. DB and Docker failures degrade independently so neither blocks the other.

### Files changed
- **`server/src/services/dockerContainerService.ts`**
  - Added `listContainerIdsForAfmImage()` — calls `docker.listContainers({ all: true, filters: { ancestor: [IMAGE_TAG] } })` and returns the `Id` field of every result. Returns `[]` when the image hasn't been built or no containers exist; propagates daemon errors to the caller.
- **`server/src/services/managedContainerCleanup.ts`** (substantial refactor)
  - Added type alias `ManagedContainerRow` derived via `NonNullable<Awaited<ReturnType<typeof prisma.managedContainer.findUnique>>>` so the row shape stays in sync with the schema without depending on generated-client paths.
  - Added type alias `ShutdownWorkSet = Map<string, ManagedContainerRow | null>`.
  - Added exported pure helper `buildShutdownWorkSet(dbRecords, imageContainerIds)` — seeds the map from image IDs with `null` values, then overrides entries with DB records so DB metadata always wins on collision.
  - Refactored `cleanupAllManagedContainers()` to run `prisma.managedContainer.findMany()` and `listContainerIdsForAfmImage()` in `Promise.allSettled`, merge results via `buildShutdownWorkSet`, log the count broken down by `DB-tracked` vs `image-only orphan(s)`, and dispatch per-container cleanup in parallel.
  - Added helpers `extractDbRecords`, `extractImageContainerIds`, `countDatabaseTrackedEntries`, `stopRemoveAndForgetSingleContainer` — the last one stops+removes a container and conditionally deletes its DB row only when the row existed and the stop/remove succeeded.
- **`server/src/services/dockerContainerService.test.ts`**
  - Added `mockListContainers` to the dockerode mock via `vi.hoisted`.
  - Added `describe("listContainerIdsForAfmImage")` block with 4 tests: returns `Id` field, passes `{ all: true, filters: { ancestor: ["afm-managed-container:latest"] } }`, returns `[]` for empty input, propagates daemon errors.
- **`server/src/services/managedContainerCleanup.test.ts`**
  - Mock now also returns `listContainerIdsForAfmImage`, defaulted to `[]` in `beforeEach` so legacy tests retain DB-only behavior.
  - Added `describe("buildShutdownWorkSet")` block with 5 tests covering empty inputs, DB-only, image-only, dedup with DB precedence, and merged disjoint set.
  - Added 8 new tests on `cleanupAllManagedContainers`: image-only orphan happy path, dedup (stop called once, row deleted), mixed set, daemon-down fallback, db-down fallback, image-only orphan stop failure, db-string rejection logging, docker-string rejection logging.
- **`eslint.config.mjs`** (user-edited mid-task) — added `claude_tmp` to the ignore list so pre-existing temp-script lint errors don't block the gauntlet.

### Verification
- `npm run test`: 390 / 390 pass (22 files, including 48 in the two service test files).
- `npm run tsc`: clean.
- `npm run lint`: clean (after user added `claude_tmp` to ignore list).
- `npm run test:coverage`: 98.81 stmt / 93.65 branch / 98.51 func / 99.19 line — clear of the project thresholds (98 / 93 / 98 / 98). `managedContainerCleanup.ts` itself reports 100 / 100 / 100 / 100.
- `npm run check:duplication`: zero new clones; existing 21 clones (all in `claude_tmp/`) unchanged.
- `/review`: no must-fix or should-fix items.
- Manual live-Docker verification (scenarios A–D from the planner's plan) deferred — to be run by the user or the `manual-verifier` agent against a real Docker daemon and signal-handled server process.

## 2026-05-14: Expand collapsed job descriptions before reporting in analyze agent

### Intent
When the analyze agent determines a page is a job description, the captured screenshot and `description_signals` should reflect the FULL job description — not the LinkedIn-style truncated preview. Previously the agent's system prompt only suggested clicking "Show more" via the generic `click_by_text` tool when the description "appeared collapsed", and the agent often skipped this step. The fix introduces a dedicated deterministic tool the agent must call before its final screenshot+report whenever signals suggest a job page.

### Files changed
- **`docker/managed-container/agent.ts`**
  - Added `EXPAND_HELPER_SCRIPT` constant — a JS helper executed via `page.evaluate()` that walks `button, [role='button'], a` elements, filters to visible elements whose trimmed accessible name (`aria-label` or `innerText`) matches one of:
    - `/show more|show full description/i` (contains-match, case-insensitive)
    - `/^(?:\.{3}|…)\s*more$/i` (exact-after-trim "...more" or "…more")
    - Clicks each match, swallows individual click errors so one bad element doesn't abort the sweep, and returns JSON `{ clicked: number, labels: string[] }`.
  - Added new tool `expand_collapsed_sections` to the `tools` array (no input arguments).
  - Added `case "expand_collapsed_sections":` to `dispatchTool`'s switch — runs the helper script and returns its result string.
  - Tweaked `click_by_text` tool description to redirect callers to `expand_collapsed_sections` for "Show more" expansion.
  - Updated `SYSTEM_PROMPT` step 3 from a soft "if the description appears collapsed" suggestion to an explicit "if preliminary signals suggest a job description page, call expand_collapsed_sections, then re-call get_page_summary so the final report reflects the expanded content." Renumbered steps 4–5 accordingly.

### Verification
Reproduced and fixed against `https://www.linkedin.com/jobs/view/software-engineer-new-grads-at-giga-4374834620/`. Before-fix screenshot shows the "About the job" section with a "Show more" button truncating the description; after-fix screenshot shows the full description (About Giga, The Role, What You'd Like to Do, You Might Be a Fit If…, Perks & Benefits) with the "Show less" affordance at the bottom of the expanded section.

## 2026-05-14: Default residential-proxy checkbox to checked in container panels

### Intent
Make the residential proxy (Smartproxy) the default for outbound screenshot and analyze requests so users no longer have to manually opt in for Cloudflare-protected sites. The checkbox remains visible and can still be unchecked to fall back to the WireGuard-only egress when desired.

### Files changed
- **`client/src/components/ScreenshotPanel.tsx`** — flipped initial `useProxy` state from `false` to `true` on line 24. Checkbox now renders checked on mount, so the first POST to `/api/managed-containers/:id/screenshot` carries `useProxy: true` unless the user unchecks it.
- **`client/src/components/AnalyzePanel.tsx`** — same change on line 28 for the analyze panel; first POST to `/api/managed-containers/:id/analyze` now carries `useProxy: true` by default.

No server-side, API service, or container-side behavior was modified — only the initial UI state. Callers that explicitly send `useProxy: false` (e.g. tests) continue to bypass the proxy.

## 2026-05-13: Persist health-check verdict to managed_containers DB row

### Intent
When the user clicks "Ping health" on the container view page, the existing `GET /api/managed-containers/:id/health` route only proxies the upstream probe and never writes the outcome back. The `status` column therefore stayed at whatever it was set to on create (`starting`/`running`) regardless of the container's actual state. Updated the route to map each probe outcome to a persistable status, await the prisma write, then respond — so a subsequent list/view fetch reflects the most recent probe.

### Outcome → status mapping
- upstream 2xx → `running`
- upstream non-2xx → `error`
- fetch threw (timeout / ECONNREFUSED / abort) → `stopped`

DB write is best-effort: a failed `prisma.update` is logged via `console.error` and swallowed so a flaky DB does not make a healthy container's Ping button appear broken.

### Files Modified
- `server/src/routes/managedContainers.ts`
  - Refactored `GET /:id/health` handler. Now calls `proxyContainerHealthCheck(record.hostPort)`, maps the outcome via `healthOutcomeToStatus`, awaits `persistHealthStatus(record.id, …)`, then sends the response.
  - Added `proxyContainerHealthCheck(hostPort: number): Promise<HealthProbeOutcome>` — the only place that distinguishes a non-OK upstream reply from a thrown fetch (so the caller can persist `error` vs `stopped` separately).
  - Added `HealthProbeOutcome` discriminated union: `{ outcome: "healthy"; body } | { outcome: "non_ok" } | { outcome: "unreachable"; errorMessage }`.
  - Added `healthOutcomeToStatus(outcome)` — pure mapping helper.
  - Added `PersistableHealthStatus = "running" | "error" | "stopped"` type alias.
  - Added `persistHealthStatus(id, status)` — wraps `prisma.managedContainer.update` in try/catch; logs and returns on failure.
  - Updated the route's JSDoc to document the side effect and the outcome→status mapping.
- `server/src/routes/managedContainers.test.ts`
  - Added `update: vi.fn()` to the prisma mock.
  - Rewrote the success test to also assert `prisma.managedContainer.update` is called with `{ status: "running" }`.
  - Rewrote the unreachable test to assert `{ status: "stopped" }`.
  - Rewrote the non-OK upstream test to assert `{ status: "error" }`.
  - Added a test that a `prisma.update` rejection (Error) still returns 200 + the probe body and logs to `console.error`.
  - Added a test that a `prisma.update` rejection with a non-Error (string) is stringified in the log line.
- `tests/playwright/managedContainers.spec.ts`
  - After the Ping health step, navigate back to `/containers` via the Back link and assert the row matching the container name contains the text `running`. Then re-open the container view to perform the existing delete step.

### Coverage work (same task)
The user had bumped `vitest.config.ts` thresholds from 90% → 98% on all four metrics during a prior session. Running coverage after the feature work failed at 91.55% branches / 95.91% functions. Per user direction ("meet it"), added tests across multiple files to lift coverage rather than reverting the bump:
- **`server/src/routes/managedContainers.test.ts`** — added 5 new health-status tests (success persists `running`, non-OK persists `error`, unreachable persists `stopped`, DB write failure still returns probe result, non-Error DB rejection stringified). Added one non-Error fetch rejection test each for health/screenshot/analyze unreachable paths. Added one non-Error rollback stringification test. Added 3 setTimeout-abort tests using a `fireSetTimeoutsImmediately()` shim that schedules timer callbacks on the next microtask (real fake timers conflicted with supertest's HTTP I/O). Total: 13 new tests, file now at 47 passing.
- **`server/src/services/dockerContainerService.test.ts`** — added a `findFreeHostPort` test that pre-binds port 41000 and forces `Math.random` to 0 so the in-use branch of `isPortAvailable`'s `server.once("error", …)` is hit. Added a readiness-polling test that returns 503 then 200 to cover `response.ok` FALSE branch. Added a `runContainer` cleanup-failure test where stopAndRemove rejects after readiness fails — covers the swallow `.catch` arrow on the cleanup path.
- **`server/src/services/jobListingScraperService.test.ts`** — added a non-Error scraper rejection test that asserts the error message stringification in the catch-log line.
- **`server/src/routes/jobApplications.test.ts`** — added 4 tests for non-Error rejections in `loadConfigOrSend400`, `applyToSingleJob`, `enrichJobListingDetails`, `saveAttemptLog` catch blocks. Added a non-LinkedIn URL test to cover the false branch of the `hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")` OR-expression in `enrichJobListingDetails`.

Result: stmts 98.45 → 98.77, branches 91.55 → 93.5, functions 95.91 → 98.46, lines 99.16 → 99.16. Functions/statements/lines now meet 98%. User explicitly authorized lowering the branches threshold to 93% in `vitest.config.ts` rather than chasing the remaining ~36 branches in UI page error-state renderings + ternaries — so branches threshold is now 93 in the config.

### Verification
- `npm run lint`: clean (no output, exit 0)
- `npm run tsc`: clean (after widening `makeAbortableFetchMock`'s param type to `string | URL | Request, RequestInit` to match the global `fetch` signature)
- `npm run test:coverage`: 393/393 passing; stmts 98.77 / branches 93.5 / functions 98.46 / lines 99.16 — all meet thresholds
- `npm run check:duplication`: 3.51% total (17 pre-existing clones in `docker/managed-container/server.ts`, none introduced by this work)
- Manual UI verification: pending — flow is documented in the playwright spec but the e2e itself requires Docker running locally

## 2026-05-08 12:30: Fix Apply-button false negative + full-page screenshots with popup dismissal + 10000 px cap

### Intent
Investigation against the LinkedIn URL the user provided showed our `dismiss_popups` CSS rule `[class*="Modal" i]` was hiding LinkedIn's primary blue Apply button because its class is `sign-up-modal__outlet` — the substring "modal" matched. After hide, `get_page_summary` couldn't see the (now invisible) button (no aria-label, `visibleText` returned ""), so the agent reported `apply_button_present: false` despite a clearly visible Apply CTA. Also, the agent's screenshot tool was capturing only the 1280×720 viewport, and `/screenshot` had no popup dismissal — both fixed in this pass.

### What Changed
- **`docker/managed-container/popup.ts` (new)** — extracted `DISMISS_HELPER_SCRIPT` and added `captureCleanedScreenshot(page)`, `SCREENSHOT_MAX_HEIGHT_PX = 10000`. Tightened the hide selector list: dropped the bare `[class*="Modal" i]` and `[class*="Overlay" i]` substring rules, replaced with container-specific patterns (`modal-overlay`, `modal-wrapper`, `modal-container`, `modal-backdrop`, `modal-content`, `ModalContainer`, `ModalWrapper`, `ModalOverlay`, `-overlay`, `contextual-sign-in`, `contextual-signin`). Added an apply-button exemption pass: any interactive element whose accessible name matches `/\bapply\b|easy\s*apply|quick\s*apply|submit\s*application/i` has `display: revert !important; visibility: visible !important` set inline on it and every ancestor up to body, beating any stylesheet `!important` hide rules.
  - `captureCleanedScreenshot` runs dismiss → scrolls page in 1000-px steps up to 10 000 px (with 100 ms pauses) to trigger lazy-loaded content → resets to top → `page.screenshot({ fullPage: true, clip: { x:0, y:0, width: viewport.width, height: min(scrollHeight, 10000) }})`. For pages ≤10 000 px tall, returns the entire page; for taller pages, returns the top 10 000 px (no infinite-scroll runaway).
- **`docker/managed-container/agent.ts`**
  - Removed the inline `DISMISS_HELPER_SCRIPT`; imports it from `popup.ts`.
  - `SUMMARY_HELPER_SCRIPT` now collects buttons with cap 100 (was 30 shipped) and adds a dedicated `applyButtons: { label, href }[]` array via an uncapped sweep. The applyButtons collector matches against aria-label, visible text, AND the original (possibly hidden) text content, so apply CTAs are always surfaced even when they share class names with hidden modal containers.
  - Agent's `screenshot` tool now calls `captureCleanedScreenshot(page)` instead of inline `page.screenshot({ fullPage: false })`.
  - `report` tool's fallback (when the agent didn't call screenshot) also uses `captureCleanedScreenshot`.
  - System prompt's Class A list now mentions the `applyButtons` array explicitly so the LLM knows to consult it.
- **`docker/managed-container/server.ts`** — `/screenshot` now calls `captureCleanedScreenshot(page)`. JSDoc updated to reflect dismiss-then-capped-fullPage behavior.
- **`docker/managed-container/Dockerfile`** — `COPY popup.ts ./`
- **`docker/managed-container/tsconfig.json`** — included `popup.ts` in the program.
- **`server/src/services/dockerContainerService.ts`** — `popup.ts` added to dockerode build-context src array.

### Files Added
- `docker/managed-container/popup.ts`

### Files Modified
- `docker/managed-container/agent.ts` — drop inline DISMISS_HELPER_SCRIPT, import from popup.ts, bump buttons cap, add applyButtons[], swap screenshot tool & report fallback to captureCleanedScreenshot, update system prompt.
- `docker/managed-container/server.ts` — /screenshot uses captureCleanedScreenshot.
- `docker/managed-container/Dockerfile` — COPY popup.ts.
- `docker/managed-container/tsconfig.json` — include popup.ts.
- `server/src/services/dockerContainerService.ts` — add popup.ts to build src list.

### Investigation
Ran a one-off Playwright diagnostic inside the container against the LinkedIn URL. Output:
- Found 4 elements with "apply" text/aria. Critical one was idx 35 (class `sign-up-modal__outlet top-card-layout__cta--primary btn-md btn-primary`). It was **visible before** dismiss_popups but **hidden after** because `[class*="Modal" i]` matched its class. Once hidden, `visibleText` returned "" and the button (with no aria-label) had `label=""`, so it was filtered out of the `buttons` array sent to the LLM. Confirmed root cause; not a buttons-cap issue.
- A `/screenshot` of the URL **without** popup dismissal also confirmed the Apply button is visibly present on the page (just covered by LinkedIn's contextual-sign-in overlay).

### Verification
- `npm run lint`: clean
- `npm run tsc`: clean
- `npm run test`: 351/351 passing
- `npm run test:coverage`: 98.41% statements / 91.13% branches (above 90%)
- `npm run check:duplication`: 3.64%
- Manual `/analyze` against the LinkedIn URL: `is_job_description: true`, **`apply_button_present: true`** (was false before). Reasoning explicitly cites "two visible 'Apply' buttons (Class A signal confirmed via applyButtons array)". Description signals: salary `$160,000–$250,000/yr`, experience marker (Entry level), employment type (Internship), "About this role" section. Returned a 1280×4438 PNG of the cleared full page. ~10 s total.
- Manual `/screenshot` against the same URL: 1280×4643 PNG; sign-in modal dismissed; both Apply buttons visible at the top of the page.
- SIGINT cleanup unaffected — server exits in ~2 s, no container leaks.

## 2026-05-08 11:25: Add Claude tool-calling agent that analyzes URLs for "is this a job description page?"

### Intent
Per-container `/analyze` endpoint that runs a small Anthropic SDK tool-calling loop in the same Node process as the existing Express server (no Python sidecar, no extra runtime). The agent dismisses popups, summarizes the cleared page, optionally clicks elements, takes a screenshot, then reports a structured verdict. Surfaced on the frontend as a new `AnalyzePanel` on the container detail page with an Analyze button.

### What Changed
- **`docker/managed-container/agent.ts`** (new): the agent module. Five tools (`dismiss_popups`, `get_page_summary`, `click_by_text`, `screenshot`, `report`); system prompt encodes the Class A (apply affordance) + Class B (description content) detection rule; max 8 turns; ANTHROPIC_API_KEY read from env. `dismiss_popups` runs a Tier-1 deterministic helper (close-button click loop + CSS hide of `[role=dialog]`/`[aria-modal]`/Modal/Cookie/etc. + body scroll-lock removal). `get_page_summary` returns headings, button labels, salary regex matches, employment-type tokens, worksite tokens, experience markers — small JSON the model can reason about without ingesting full DOM.
- **`docker/managed-container/server.ts`**: new `POST /analyze` endpoint. Each request opens a fresh context+page (reuses the cached chromium browser), runs `runAnalyzeAgent`, returns `{ is_job_description, apply_button_present, description_signals, reasoning, screenshot_b64 }`. 60 s upstream timeout via Express defaults; agent loop has its own per-turn token budget.
- **`docker/managed-container/package.json`**: added `@anthropic-ai/sdk@0.69.0`.
- **`docker/managed-container/Dockerfile`**: COPY `agent.ts` into the image alongside `server.ts`.
- **`docker/managed-container/tsconfig.json`**: included `agent.ts` in the program.
- **`server/src/services/dockerContainerService.ts`**: forward host `CLAUDE_API_KEY` env → container `ANTHROPIC_API_KEY` env (the SDK's default name); added `agent.ts` to the dockerode build-context src list.
- **`server/src/routes/managedContainers.ts`**: new `POST /api/managed-containers/:id/analyze` host proxy mirroring `/screenshot`'s pattern; 120 s timeout (agent loop > screenshot single-shot); JSON body in, JSON body out; 503 on container/Anthropic failure with the upstream error string preserved.
- **`client/src/services/managedContainersApi.ts`**: added `AnalyzeResponse` interface and `analyzeUrl(id, url)` using the existing `requestJson` helper.
- **`client/src/components/AnalyzePanel.tsx`** (new): URL input pre-populated with the LinkedIn URL the user provided, Analyze button, verdict chip, apply-button chip, signals chips, reasoning text, screenshot rendered inline via `data:image/png;base64,...`. Errors as a dismissable MUI Alert.
- **`client/src/pages/ContainerViewPage.tsx`**: render `<AnalyzePanel/>` below `<ScreenshotPanel/>`.
- **Tests**: 6 new container-route tests for `/analyze` (200 happy path, 400/404 input errors, 503 on upstream agent failure / non-JSON / network); 3 new tests for `analyzeUrl` (success, server-error message, generic fallback); 7 new tests for `AnalyzePanel` (positive verdict + signals + screenshot, negative verdict, server error displays, generic-error fallback, empty-URL guard, alert close, pre-populated URL); ContainerViewPage test updated to mock `analyzeUrl`. Total 351/351 passing.
- **Host devDep**: added `@anthropic-ai/sdk@0.69.0` so the host eslint can resolve types in the container's `agent.ts` (the package isn't used at runtime by the host — only in the container).

### Files Added
- `docker/managed-container/agent.ts`
- `client/src/components/AnalyzePanel.tsx`
- `client/src/components/AnalyzePanel.test.tsx`

### Files Modified
- `docker/managed-container/Dockerfile` — COPY agent.ts
- `docker/managed-container/server.ts` — new POST /analyze
- `docker/managed-container/package.json` — added @anthropic-ai/sdk
- `docker/managed-container/tsconfig.json` — include agent.ts
- `server/src/services/dockerContainerService.ts` — forward CLAUDE_API_KEY → ANTHROPIC_API_KEY, add agent.ts to build src
- `server/src/services/dockerContainerService.test.ts` — assert ANTHROPIC_API_KEY env forwarded
- `server/src/routes/managedContainers.ts` — POST /:id/analyze proxy + ANALYZE_TIMEOUT_MS
- `server/src/routes/managedContainers.test.ts` — 6 new tests for the analyze route
- `client/src/services/managedContainersApi.ts` — analyzeUrl + AnalyzeResponse
- `client/src/services/managedContainersApi.test.ts` — 3 new tests for analyzeUrl
- `client/src/pages/ContainerViewPage.tsx` — wire in AnalyzePanel
- `client/src/pages/ContainerViewPage.test.tsx` — mock analyzeUrl in api stub
- `package.json` — @anthropic-ai/sdk as host devDep (for eslint type resolution only)

### Verification
- `npm run lint`: clean
- `npm run tsc`: clean
- `npm run test`: 351/351 passing (+24)
- `npm run test:coverage`: 98.41% statements / 91.13% branches (above 90% threshold)
- `npm run check:duplication`: 3.75%
- Manual end-to-end via curl: spawned container → POST `/api/managed-containers/:id/analyze` with the LinkedIn URL the user provided → returned `is_job_description: true`, `apply_button_present: false`, four Class B signals (salary $160K–$250K, employment type, experience marker, "About this role"), reasoning explaining LinkedIn's sign-in wall hides the apply button, plus a 1280x720 PNG of the cleared page rendered inline. 13.3 s end-to-end.
- Manual UI flow via Playwright script (`claude_temp/manual-analyze-check.mjs`): create container via New Container button → open detail page → click Analyze → verdict chip ("Job description page"), apply chip ("No apply button"), reasoning text, screenshot rendered as `data:image/png;base64,...`. Delete via UI works.
- SIGINT cleanup confirmed unaffected: server exits in 2 s, `docker ps -a --filter name=afm-` empty, DB rows empty.

## 2026-05-07 23:45: Simplify container DNS handling + clean up containers on server shutdown

### Intent
Two related fixes:
1. The container's WG entrypoint was doing DNS handling itself (stripping `DNS=` from the config, writing `/etc/resolv.conf` directly) because Ubuntu Noble's `resolvconf` package is a systemd-resolved wrapper that needs dbus. Replaced with the conventional approach: install the `wireguard` meta-package and provide a tiny `resolvconf` shim at `/usr/local/sbin/resolvconf` that wg-quick invokes. The WG config is now used as-is — no custom DNS munging.
2. The server had no shutdown handler, so spawned containers leaked when the server exited (verified empirically: spawn → kill server → `docker ps` shows the container still up, `managed_containers` table still has the row). Added SIGINT/SIGTERM handlers in `index.ts` that stop+remove every tracked container and delete its DB row.

### What Changed
- **Dockerfile**: install `wireguard` (meta-package) instead of `wireguard-tools` and `COPY` `resolvconf-shim.sh` to `/usr/local/sbin/resolvconf` so wg-quick can call it. Also include the new file in the dockerode build context's `src` array.
- **resolvconf-shim.sh** (new): minimal POSIX-sh wrapper that handles wg-quick's `-a` (apply, write resolv.conf from stdin) and `-d` (delete, clear resolv.conf) invocations. Other flags are accepted and ignored. Does the same job as the real openresolv but doesn't need dbus.
- **entrypoint.sh**: removed the custom `WG_DNS_SERVER` extraction, the DNS-line-stripping `grep -v`, and the manual `/etc/resolv.conf` write. The script is now: validate env → copy config → `wg-quick up wg0` → install connmark rules → exec CMD.
- **server/src/services/managedContainerCleanup.ts** (new): exports `cleanupAllManagedContainers()` — loads all `managed_containers` rows, calls `stopAndRemove` on each in parallel, deletes the row only if Docker removal succeeded. Failures are logged, not thrown.
- **server/src/services/managedContainerCleanup.test.ts** (new): 7 tests covering empty list, full happy path, partial failures (Docker error → keeps row), DB-delete error after success, mixed-success batch, and non-Error rejection logging for both Docker and DB.
- **server/src/index.ts**: added `gracefulShutdown(httpServer, signal)` with a 30 s timeout, re-entry guard, `httpServer.close()` → `cleanupAllManagedContainers()` → `prisma.$disconnect()` → `process.exit(0)`. Registered as SIGINT and SIGTERM listeners after `app.listen`.

### Files Added
- `docker/managed-container/resolvconf-shim.sh`
- `server/src/services/managedContainerCleanup.ts`
- `server/src/services/managedContainerCleanup.test.ts`

### Files Modified
- `docker/managed-container/Dockerfile` — `wireguard-tools` → `wireguard`, copy + chmod the shim
- `docker/managed-container/entrypoint.sh` — removed custom DNS handling
- `server/src/index.ts` — added graceful shutdown for SIGINT/SIGTERM
- `server/src/services/dockerContainerService.ts` — included `resolvconf-shim.sh` in the build-context src list

### Verification
- `npm run lint`: clean
- `npm run tsc`: clean
- `npm run test`: 334/334 passing (+7 new)
- `npm run test:coverage`: 98.42% statements / 90.71% branches (above 90% threshold)
- `npm run check:duplication`: 3.1%
- Manual end-to-end with simpler entrypoint: spawned a container, `wg show` reports `latest handshake: 14 seconds ago` and the peer is mullvad; `docker exec ... curl https://ifconfig.me` returns `146.70.165.36` (NYC exit); `/etc/resolv.conf` reads `nameserver 10.64.0.1` (written by wg-quick via the shim, not by entrypoint code)
- Manual shutdown test: `kill -INT $SERVER_PID` → server logs `[shutdown] Received SIGINT`, `Cleaning up 2 managed container(s)`, `Done`; exits in 2 s. Both `docker ps -a --filter name=afm-` and `SELECT * FROM managed_containers` return empty afterward — confirms no leak.

## 2026-05-07 23:30: Force container egress through WireGuard + add per-container Playwright screenshot

### Intent
Each managed container now (a) routes all outbound traffic through one of the WireGuard configs in `wg_configs/` and (b) exposes a screenshot endpoint that renders a URL with Playwright/chromium and returns a PNG. The screenshot is taken from inside the container, so the rendering traffic egresses via the WG exit IP — not the host. Surfaced on the frontend as a "Screenshot a URL" panel on `/containers/:id`, with the result rendered inline as a `<img>` and any failure shown as a clear MUI Alert with the underlying server error message.

### What Changed
- **Container image**: switched base from `node:22-alpine` to `mcr.microsoft.com/playwright:v1.58.2-noble` (chromium pre-installed, debian/noble), added `wireguard-tools iproute2 iptables` via apt, and a new `entrypoint.sh` that:
  - reads `WG_CONFIG_NAME` from env, copies the config from the read-only mount at `/etc/wireguard-configs`
  - strips the `DNS=` line and writes `/etc/resolv.conf` directly (resolvconf on Noble is a systemd-resolved wrapper that needs dbus)
  - hard-fails the container if `wg-quick up wg0` fails (kill switch — Node never starts without the tunnel)
  - installs portable connmark rules so port-forward replies (Linux-native + Docker Desktop) go back via eth0; rules are scoped to TCP only so they don't clobber WG's own UDP fwmark
- **In-container server** (`docker/managed-container/server.ts`): added `POST /screenshot` using a cached chromium browser with disconnect-recovery, full-page PNG, per-request newContext/newPage cleanup
- **Host service** (`server/src/services/dockerContainerService.ts`): added `pickRandomWireGuardConfig()`, set Docker `CapAdd: NET_ADMIN`, `Devices: /dev/net/tun`, sysctl `net.ipv4.conf.all.src_valid_mark=1`, bind `wg_configs:/etc/wireguard-configs:ro`, env `WG_CONFIG_NAME`, return `wgConfigName` from `runContainer`, bumped readiness timeout to 45 s
- **Host route** (`server/src/routes/managedContainers.ts`): added `POST /api/managed-containers/:id/screenshot` that proxies to the container, streams `image/png` back, surfaces upstream Playwright errors in the 503 body
- **Prisma**: added nullable `wgConfigName String?` to `ManagedContainer`, ran `db push` + `generate`
- **Frontend**: added `captureScreenshot()` in `managedContainersApi.ts`, new `ScreenshotPanel` component (URL field + Capture button + blob-URL `<img>` + error Alert), wired into `ContainerViewPage`, surfaced `wgConfigName` as a labeled field
- **Tests**: extended `dockerContainerService.test.ts` to assert new HostConfig (CapAdd/Devices/Sysctls/Binds/Env/wgConfigName) and added a `pickRandomWireGuardConfig` test; added 6 new tests for `POST /:id/screenshot`; added 4 new tests for `captureScreenshot`; added a 7-test `ScreenshotPanel.test.tsx`; added `tests/playwright/screenshotContainer.spec.ts`
- **Backwards compat**: existing rows without `wgConfigName` keep working (column is nullable)

### Files Added
- `docker/managed-container/entrypoint.sh`
- `client/src/components/ScreenshotPanel.tsx`
- `client/src/components/ScreenshotPanel.test.tsx`
- `tests/playwright/screenshotContainer.spec.ts`

### Files Modified
- `docker/managed-container/Dockerfile` — base image swap + wireguard-tools/iproute2/iptables apt-install + ENTRYPOINT
- `docker/managed-container/package.json` — added `playwright: 1.58.2`
- `docker/managed-container/server.ts` — added `getBrowser()` (with disconnect-recovery), `POST /screenshot`
- `server/src/services/dockerContainerService.ts` — added `pickRandomWireGuardConfig()`, updated `runContainer()` HostConfig, returns `wgConfigName`, readiness timeout 15s → 45s, image build context now includes `entrypoint.sh`
- `server/src/services/dockerContainerService.test.ts` — assertions for new HostConfig fields, `pickRandomWireGuardConfig` test
- `server/src/routes/managedContainers.ts` — persists `wgConfigName` on create, added `POST /:id/screenshot` proxy + `readUpstreamErrorMessage()` helper, alias type `FetchResponse`
- `server/src/routes/managedContainers.test.ts` — `wgConfigName` in mock data + `runContainer` mock returns; 6 new tests for the screenshot route
- `server/prisma/schema.prisma` — `wgConfigName String?`
- `client/src/services/managedContainersApi.ts` — added `wgConfigName` to `ManagedContainerResponse`, added `captureScreenshot()`
- `client/src/services/managedContainersApi.test.ts` — `wgConfigName` in mock + 4 tests for `captureScreenshot`
- `client/src/pages/ContainerViewPage.tsx` — render `wgConfigName` field + `<ScreenshotPanel/>`
- `client/src/pages/ContainerViewPage.test.tsx` + `ContainersListPage.test.tsx` — `wgConfigName` in mock data, mock `captureScreenshot`

### Verification
- `npm run lint`: clean
- `npm run tsc`: clean
- `npm run test`: 327/327 passing
- `npm run test:coverage`: 98.4% statements / 90.6% branches (above 90% threshold)
- `npm run check:duplication`: 3.16% (below 4% threshold)
- Manual end-to-end: spawned a container via `POST /api/managed-containers`, screenshot via `POST /:id/screenshot` of `https://google.com` returned a 138 KB PNG (1280×720) of the actual Google homepage; `docker exec ... curl https://ifconfig.me` confirmed exit IP `146.70.185.36` (Mullvad NYC) — distinct from the host IP — proving the egress traversed WireGuard
- Cross-config rotation confirmed: a debug container with `us-nyc-wg-301` exited via `143.244.47.73`; the API-spawned container with `us-nyc-wg-601` exited via `146.70.185.36`

## 2026-05-07 22:25: Refactor to pass `npm run check:duplication` (4% threshold)

### What Changed
Brought duplication from 11.64% (25 clones) down to 3.27% (11 clones) by extracting shared helpers and components. No tests were changed; all 308 tests still pass with branch coverage at 90.5%. Refactors fall into three groups:

1. **Server route helpers.** Extracted `parseIdParam` + `findJobListingOrSend404` into `server/src/routes/_helpers.ts`. Refactored `jobListings.ts` (3 routes) and `jobApplications.ts` (1 route) to use them, and added `loadConfigOrSend400` in `jobApplications.ts` to dedupe the readUserInfo+getProfileId+catch pattern shared by `/apply` and `/apply-batch`.
2. **Managed-containers route.** Extracted `loadManagedContainerOrSend404` to share the parse-id+findUnique+404 logic across the 3 GET/DELETE handlers.
3. **Frontend.** Extracted six small reusable pieces:
   - `client/src/services/httpClient.ts` — `requestJson<T>` helper now backing every function in `jobListingsApi.ts` and `managedContainersApi.ts`.
   - `client/src/components/BackLink.tsx` — the standard back-arrow button used at the top of detail pages.
   - `client/src/components/LoadingOrErrorPanel.tsx` — the loading-spinner-or-error-alert pair shown above page content.
   - `client/src/components/JobRow.tsx` — single job-listing row used by all four sections of the dashboard.
   - `client/src/components/JobSection.tsx` — Paper+heading+List wrapper for the Applied/Closed/Errors sections.
   - `client/src/components/LiveBrowserView.tsx` — the iframe-or-waiting placeholder for the Browser Use live view.
   - `client/src/components/LabeledField.tsx` — the subtitle-label-then-value pattern used on detail pages.

### Files Added
- `server/src/routes/_helpers.ts`
- `client/src/services/httpClient.ts`
- `client/src/components/BackLink.tsx`
- `client/src/components/LoadingOrErrorPanel.tsx`
- `client/src/components/JobRow.tsx`
- `client/src/components/JobSection.tsx`
- `client/src/components/LiveBrowserView.tsx`
- `client/src/components/LabeledField.tsx`

### Files Modified
- `server/src/routes/jobListings.ts` — Switched 3 handlers to `findJobListingOrSend404`; removed inline parse/find blocks.
- `server/src/routes/jobApplications.ts` — Switched the apply handler to `findJobListingOrSend404`; added `loadConfigOrSend400` and used it from `/apply` and `/apply-batch`.
- `server/src/routes/managedContainers.ts` — Added local `loadManagedContainerOrSend404`; switched GET/:id, GET/:id/health, and DELETE/:id to use it.
- `client/src/services/jobListingsApi.ts` — Each function now delegates to `requestJson` from `httpClient.ts`.
- `client/src/services/managedContainersApi.ts` — Same delegation as above.
- `client/src/pages/JobViewPage.tsx` — Replaced inline back-link, loading/error block, iframe block, and 4 label-value pairs with the new components.
- `client/src/pages/ContainerViewPage.tsx` — Same replacements as above (back-link, loading/error, 3 label-value pairs).
- `client/src/pages/ApplicationDashboardPage.tsx` — Replaced 4 list sections with `<JobSection><JobRow/></JobSection>` and the iframe block with `<LiveBrowserView>`.

### Verification
- `npm run lint`: clean
- `npm run tsc`: clean
- `npm run test`: 308/308 passing (no test file modified)
- `npm run test:coverage`: 90.5% branch (above 90% threshold)
- `npm run check:duplication`: **3.27%** duplication, **exits 0** (down from 11.64%)
- Playwright `tests/playwright/managedContainers.spec.ts`: passing

## 2026-05-07 20:58: Inline create on /containers; clickable name links

### What Changed
Removed the `/containers/new` page entirely. The "New Container" button on `/containers` now spawns a container directly via `createManagedContainer()` and refreshes the list in place — no navigation. The container name in each row is now a `<Link>` (react-router) that takes the user to the read page (`/containers/:id`); the eye-icon view button is kept for users who scan icons. Also simplified `parseManagedContainerId` to remove a dead defensive `isArrayParam` branch (Express 5 path params are always strings).

### Files Modified
- **`client/src/pages/ContainersListPage.tsx`** — Imported `createManagedContainer` and MUI `Link`. Added `isCreating` state and a `handleCreate` async function that calls the API then refetches. Replaced the link-styled "New Container" button with a click-handled button that disables and shows a spinner while creating. Wrapped each row's name cell in `<Link component={RouterLink} to={\`/containers/${id}\`}>`.
- **`client/src/pages/ContainersListPage.test.tsx`** — Mocked `createManagedContainer`. Added tests for inline create success (button click triggers create + list refresh), create error, non-Error rejection fallback, and the name link's `href`. Updated the title-button assertion to look for a button instead of a link.
- **`client/src/App.tsx`** — Removed the `/containers/new` route and `CreateContainerPage` import. Updated JSDoc comment.
- **`server/src/routes/managedContainers.ts`** — Simplified `parseManagedContainerId` by removing the unreachable `isArrayParam` branch.
- **`server/src/routes/managedContainers.test.ts`** — Added a test that the POST endpoint returns 500 with the stringified reason when the DB insert rejects with a non-object.
- **`tests/playwright/managedContainers.spec.ts`** — Updated the e2e flow: click "New Container" on `/containers` (no nav), wait for the new row, click the name link to navigate to the view page, then ping/delete as before. The URL stays at `/containers` after create instead of redirecting.

### Files Deleted
- **`client/src/pages/CreateContainerPage.tsx`**
- **`client/src/pages/CreateContainerPage.test.tsx`**

### Verification
- `npm run lint`: clean
- `npm run tsc`: clean
- `npm run test`: 308/308 passing
- `npm run test:coverage`: branch coverage 90.45% (above 90% threshold)
- Playwright `tests/playwright/managedContainers.spec.ts`: passing — create stays on `/containers`, new row appears, name link navigates, ping returns ok, delete redirects back and the docker container is gone.

## 2026-05-07 20:45: Add managed Docker containers feature (CRD pages + spawning API)

### What Changed
Added an end-to-end managed Docker containers feature. Users can spawn an Express-server-running Docker container from the web UI, view its details, ping its `/health` endpoint, and delete it. Each spawned container runs an in-repo image (`docker/managed-container/`) on a random port in 41000-41999 bound to 127.0.0.1. The backend uses `dockerode` to drive Docker, persists records via Prisma (`ManagedContainer` model), and proxies health checks through `/api/managed-containers/:id/health` so the browser never talks to docker ports directly. Container names are auto-generated 12-char hex strings prefixed with `afm-` at the docker level. After Docker create+start, the backend polls the container's /health until it responds before returning 201, so the API contract is "container is reachable when you get the response." Failed DB inserts roll back the docker container so it doesn't leak. Also fixed pre-existing tsc errors in `jobListings.test.ts` and `jobApplications.test.ts` (missing `location` field on mock fixtures) and updated `tests/playwright.config.ts` to read `CLIENT_PORT`/`SERVER_PORT` from `.env` (it was hardcoded to 5173).

### Files Added
- **`server/src/services/dockerContainerService.ts`** — New service wrapping dockerode. Exports `generateContainerName()`, `toDockerName()`, `isValidContainerName()`, `findFreeHostPort()`, `ensureImageBuilt()`, `runContainer()`, `stopAndRemove()`, `resetImageBuildCacheForTesting()`. Internal helpers: `isPortAvailable`, `waitForContainerReady`, `isDockerNotFoundError`, `isDockerNotModifiedError`. Caches the image build via `imageBuildPromise` module variable.
- **`server/src/routes/managedContainers.ts`** — New router mounted at `/api/managed-containers`. Routes: `POST /`, `GET /`, `GET /:id`, `GET /:id/health` (proxies fetch with 3s AbortController), `DELETE /:id`. Helpers: `parseManagedContainerId`, `isPrismaUniqueViolation`. POST has full rollback path that calls `stopAndRemove` if the DB insert fails.
- **`server/src/routes/managedContainers.test.ts`** — New: vitest suite with mocked dockerContainerService and Prisma. Covers all routes, validation paths, 404/409/500/503, orphan rollback, and Prisma P2002 → 409 mapping.
- **`server/src/services/dockerContainerService.test.ts`** — New: vitest suite mocking dockerode. Covers naming, port-finding, build cache + retry, runContainer with readiness, readiness timeout rollback, and stop-then-remove with 304/404 tolerance + non-Error rejections.
- **`docker/managed-container/Dockerfile`** — New: `node:22-alpine`, installs deps, runs `tsx server.ts`.
- **`docker/managed-container/server.ts`** — New: tiny Express server. Routes: `GET /health` returns `{ status: "ok", name }`, `GET /name` returns `{ name }`. Reads `CONTAINER_NAME` env var.
- **`docker/managed-container/package.json`** — New: pinned express, tsx, @types/express, typescript.
- **`docker/managed-container/tsconfig.json`** — New: TS config for the in-container server.
- **`docker/managed-container/.dockerignore`** — New: excludes node_modules.
- **`client/src/services/managedContainersApi.ts`** — New: frontend service with `listManagedContainers`, `getManagedContainer`, `createManagedContainer`, `deleteManagedContainer`, `pingManagedContainerHealth`. Exports `ManagedContainerResponse` and `ManagedContainerHealthResponse` interfaces.
- **`client/src/services/managedContainersApi.test.ts`** — New: vitest suite covering each function's success and error paths.
- **`client/src/pages/ContainersListPage.tsx`** — New: MUI table page with View + Delete actions and a "New Container" link. Loads via `listManagedContainers`, deletes via `deleteManagedContainer`.
- **`client/src/pages/ContainersListPage.test.tsx`** — New: covers empty state, table rendering, delete + refresh, error paths (Error and non-Error), and close-button.
- **`client/src/pages/CreateContainerPage.tsx`** — New: minimal form (auto-generated name, just a "Create Container" button). On success navigates to the read page.
- **`client/src/pages/CreateContainerPage.test.tsx`** — New: covers create success + nav, error paths, close-button.
- **`client/src/pages/ContainerViewPage.tsx`** — New: shows id/dockerId/hostPort/status/createdDate, with "Ping health" and "Delete" buttons. Ping result rendered via testids (`ping-status`, `ping-name`, `ping-success`, `ping-error`).
- **`client/src/pages/ContainerViewPage.test.tsx`** — New: covers load, invalid id, ping success + error (Error and non-Error), delete success + error, alert close-buttons.
- **`tests/playwright/managedContainers.spec.ts`** — New: e2e Playwright spec. Navigates to `/containers/new`, creates, verifies docker ps shows the matching `afm-<name>`, pings health and asserts displayed status/name, deletes, and verifies docker ps no longer shows it.

### Files Modified
- **`server/prisma/schema.prisma`** — Added `ManagedContainerStatus` enum (starting/running/stopped/error) and `ManagedContainer` model (id, name @unique, dockerId @unique, hostPort @unique, status, created_date) mapped to `managed_containers`.
- **`server/src/app.ts`** — Imported `managedContainersRouter` and mounted it at `/api/managed-containers`.
- **`client/src/App.tsx`** — Imported `ContainersListPage`, `CreateContainerPage`, `ContainerViewPage`. Added `/containers`, `/containers/new`, `/containers/:id` routes. Updated JSDoc.
- **`client/src/components/NavMenu.tsx`** — Added `{ label: "Containers", path: "/containers" }` to `navItems`.
- **`client/src/components/NavMenu.test.tsx`** — Updated nav-link assertion to include Containers, and added active-state test for `/containers`.
- **`tests/playwright.config.ts`** — Now reads CLIENT_PORT and SERVER_PORT from `.env` via dotenv, throws if missing, and derives `baseURL` and `webServer.url`.
- **`server/src/routes/jobListings.test.ts`** — Pre-existing tsc fix: added `location: null` to `mockJobListing` and `mockCompletedJobListing` fixtures.
- **`server/src/routes/jobApplications.test.ts`** — Pre-existing tsc fix: added `location: null` to `mockInitJobListing` fixture.
- **`package.json` / `package-lock.json`** — Added `dockerode` and `@types/dockerode`.

### Verification
- `npm run lint`: clean
- `npm run tsc`: clean
- `npm run test`: 308/308 passing
- `npm run test:coverage`: 90% branch threshold met (exactly 90.00%)
- Playwright `tests/playwright/managedContainers.spec.ts`: passing — creates a container, the docker CLI shows `afm-<name>`, the UI ping returns `{status: "ok", name}`, delete removes it from both UI and docker ps.

## 2026-03-30 20:15: Decouple job adding from data fetching, add salary field, redesign JobViewPage

### What Changed
Decoupled the job-add flow from scraping. Adding a job now just saves the URL to the database — no background scraping is triggered. A new on-demand `POST /api/job-listings/:id/fetch` endpoint lets users trigger scraping when they want. Added a `salary` field to the `JobListing` schema and updated the scraper to extract salary information. Redesigned the JobViewPage to show the URL with "Fetch Data" and "Apply" action buttons.

### Files Modified
- **`server/prisma/schema.prisma`** — Added `salary String?` to `JobListing` model.
- **`server/src/routes/jobListings.ts`** — Removed async `scrapeAndUpdateJobListing()` call from `POST /` route. Added new `POST /:id/fetch` route that triggers on-demand scraping. Updated `scrapeAndUpdateJobListing()` to persist `salary`. Updated JSDoc on `POST /` and `scrapeAndUpdateJobListing`.
- **`server/src/services/jobListingScraperService.ts`** — Added `salary` to `JobListing` interface, `JobListingSchema` Zod schema, extraction prompt, and return value from `fetchJobListingFromUrl()`.
- **`client/src/services/jobListingsApi.ts`** — Added `salary: string | null` to `JobListingResponse`. Added `fetchJobData(id)` function calling `POST /api/job-listings/:id/fetch`.
- **`client/src/pages/JobViewPage.tsx`** — Full redesign: shows URL prominently with "Fetch Data" and "Apply" buttons, polls after fetch data is clicked, displays salary when available, shows job details once data is fetched, keeps applying/live-iframe behavior.
- **`client/src/components/AddJobForm.tsx`** — Changed success message from "Scraping job details..." to "Job saved successfully!". Updated JSDoc.
- **`vitest.config.ts`** — Added `tests/**` to exclude so vitest doesn't run Playwright tests.
- **`tests/tsconfig.json`** — New: TypeScript config for Playwright tests.
- **`tests/playwright.config.ts`** — New: Playwright test runner configuration.
- **`tests/playwright/addAndViewJob.spec.ts`** — New: Playwright e2e test for the add-and-view-job flow.

### Test Files Updated (salary in mock data, new test cases)
- **`server/src/routes/jobListings.test.ts`** — Moved scraping tests from `POST /` to `POST /:id/fetch`. Added `salary` to mocks. Added test for null salary on empty string. Added test that `POST /` no longer triggers scraping.
- **`server/src/routes/jobApplications.test.ts`** — Added `salary: null` to `mockInitJobListing`.
- **`client/src/services/jobListingsApi.test.ts`** — Added `salary` to mock. Added `fetchJobData` test suite.
- **`client/src/pages/JobViewPage.test.tsx`** — Rewrote tests for new page structure. Added tests for Fetch Data button, Apply button, error states, action error dismiss, salary display.
- **`client/src/components/AddJobForm.test.tsx`** — Updated success message assertion. Added `salary` to mocks.
- **`client/src/components/JobList.test.tsx`** — Added `salary` to mock data.
- **`client/src/pages/AddJobPage.test.tsx`** — Added `salary` to mock data.
- **`client/src/pages/JobsListPage.test.tsx`** — Added `salary` to mock data.
- **`client/src/pages/ApplicationDashboardPage.test.tsx`** — Added `salary` to mock data.

---

## 2026-03-28: Add closed status for jobs no longer accepting applications

### What Changed
Added detection for job listings that are no longer accepting applications. When browser-use encounters a closed listing (during step iteration or in the agent's final output), the job is now set to `closed` status instead of `error_applying`. A new "Closed" section appears on the Application Dashboard with a neutral grey chip and no Retry button.

### Files Modified
- **`server/prisma/schema.prisma`** — Added `closed` to `JobStatus` enum with comment.
- **`server/src/services/jobApplicationService.ts`** — Added `CLOSED_KEYWORDS` regex. Added `closedListing?: boolean` to `ApplicationResult`. Added `detectClosedListing()` export. Updated `buildApplicationPrompt` to instruct agent to stop on closed listings. Added closed detection in step iteration loop (returns early with `closedListing: true`). Added post-iteration check on `applicationResult.output` against `CLOSED_KEYWORDS`.
- **`server/src/routes/jobApplications.ts`** — `applyToSingleJob` and `runBatchApply` now check `result.closedListing` and set status to `"closed"` instead of `"error_applying"`.
- **`client/src/pages/ApplicationDashboardPage.tsx`** — Added `closedJobs` filter. Added "Closed" section between Applied and Errors with grey chip, clickable URLs, no Retry button. Added "Closed" summary chip at bottom.
- **`client/src/components/JobList.tsx`** — Added `closed` to status chip config.
- **`client/src/pages/JobViewPage.tsx`** — Added `closed` to status chip config.
- **`server/src/services/jobApplicationService.test.ts`** — Added tests for closed detection from step memory and agent output.
- **`server/src/routes/jobApplications.test.ts`** — Added tests for closed status in single and batch apply.
- **`client/src/pages/ApplicationDashboardPage.test.tsx`** — Added test for Closed section display.
- **`server/src/services/jobListingScraperService.test.ts`** — Added test for sessionId timeout in notifyLiveUrl (coverage improvement).

---

## 2026-03-28: Fix success detection and enrich job listing details

### What Changed
Fixed two issues: (1) successful browser-use runs were showing as `error_applying` because the stuck detection triggered during legitimate form filling, and the success logic didn't recognize `status: "finished"` as a success signal. (2) Job listing details (title, company, description) were never filled in for bulk-imported jobs.

### Files Modified
- **`server/src/services/jobApplicationService.ts`** — Three fixes:
  1. **Stuck detection**: Changed `detectCaptchaOrStuck` to accept `idleSameUrlCount` (number) instead of `previousUrls` (string[]). Steps with non-empty actions on the same URL no longer count toward stuck threshold — only idle steps (no actions) on the same URL increment the counter. The caller tracks `lastUrl` and `idleSameUrlCount` instead of `previousUrls`.
  2. **Success logic**: Added `isStatusFinished` check. New logic: `isSuccess: false` → fail, `status: "stopped"` → fail, `isSuccess: true` → success, `status: "finished"` → success, else → fail. Previously `status: "finished"` with `isSuccess: null` was treated as success only if `isSuccess` was explicitly `true`.
  3. **Null result**: `result: null` now correctly treated as failure (no `status: "finished"` means it didn't complete).
- **`server/src/routes/jobApplications.ts`** — Added `enrichJobListingDetails()` helper. After a successful application, if the job listing has no title, calls `scrapeAndUpdateJobListing` (imported from `jobListings.ts`) to fill in title/description/post_date. Handles LinkedIn credentials path detection. Wrapped in try/catch so enrichment failures don't affect application status. Called in both `applyToSingleJob` and `runBatchApply`.
- **`server/src/services/jobApplicationService.test.ts`** — Updated stuck detection tests for new `idleSameUrlCount` parameter. Added tests: active steps on same URL don't trigger stuck, `status: "finished"` with null `isSuccess` is success, null result is failure. Updated from 43 to 48 tests.
- **`server/src/routes/jobApplications.test.ts`** — Added mock for `scrapeAndUpdateJobListing`. Added tests: enrichment with empty title, skip enrichment when title exists, enrichment failure handling, LinkedIn credentials path. Updated from 22 to 27 tests.

---

## 2026-03-28: Stuck threshold, phase screenshots, isSuccess, ApplicationAttemptLogs

### What Changed
Reduced stuck detection threshold from 5 to 3 consecutive same-URL steps. Added screenshot capture on each phase transition. Switched from status-only checking to using browser-use's `isSuccess` field (agent self-report) as the primary success/failure indicator. Added `stepLogs` to `ApplicationResult` so callers can persist them. Created `ApplicationAttemptLogs` table persistence — every application attempt (success or failure) saves its step logs and final response to the database. Added US residential proxy to session settings.

### Files Modified
- **`server/prisma/schema.prisma`** — User added `ApplicationAttemptLogs` model with `job_listing_id`, `logs`, `end_response`, `created_date`
- **`server/src/services/jobApplicationService.ts`** — `stuckThreshold` changed 5→3. Added `stepLogs?: StepLog[]` to `ApplicationResult`. Added screenshot save inside `phaseChanged` block. Replaced status-only check with `isSuccess`-based logic: `isSuccess === false` → failure, `isSuccess === true` → success, null → fall back to status check. `stepLogs` attached to all result objects. Added `proxyCountryCode: "us"` to session settings.
- **`server/src/routes/jobApplications.ts`** — Added `saveAttemptLog()` helper that persists `ApplicationAttemptLogs` rows via Prisma. Called after every `applyToJob` (both success and failure) in `applyToSingleJob` and `runBatchApply`. Imported `StepLog` type.
- **`server/src/services/jobApplicationService.test.ts`** — Updated stuck tests for threshold 3 (4 steps instead of 6). Added tests for `isSuccess` true/false/null. Added test for `stepLogs` in result. Added test for phase transition screenshot. Fixed step URLs to avoid stuck detection in multi-step test.
- **`server/src/routes/jobApplications.test.ts`** — Added `applicationAttemptLogs.create` mock. Added tests for attempt log on success, failure, and DB write error.

---

## 2026-03-28: Add Proper Logging to Job Application Service

### What Changed
Added comprehensive real-time logging to the job application service. The browser-use agent now reports step-by-step progress classified into 4 phases (Opening URL → Following apply links → Filling form → Submitting). Screenshots are saved to `logs/<jobId>-<timestamp>/` for diagnosis. Captcha and stuck-detection warnings are logged. Every catch block now has `console.error` with the error message. Route-level logging tracks batch progress.

### Files Modified
- **`server/src/services/jobApplicationService.ts`** — Major rewrite:
  - Added helper functions: `classifyApplicationPhase()` (heuristic phase detection using keyword matching), `detectCaptchaOrStuck()` (checks for captcha keywords and 5+ same-URL stuck), `saveStepScreenshot()` (downloads screenshot from URL, saves to disk), `saveRunSummary()` (writes JSON summary of all steps), `ensureLogDirectory()` (creates `logs/<jobId>-<timestamp>/`), `saveTaskLog()` (fetches browser-use task log and saves)
  - Changed `applyToJob()`: added `jobId` parameter; replaced `await applicationRun` with `for await (const step of applicationRun)` loop for real-time step iteration; each step is classified into phase 1-4, checked for captcha/stuck, and has its screenshot saved; run summary and task log saved after completion
  - Added `ApplicationPhase`, `StepLog` interfaces
  - Fixed all catch blocks: `notifyLiveUrl` catch now logs the actual error message; `finally` catch uses `console.error` with error details
  - Added visual separators (`════`) for major log boundaries
- **`server/src/services/jobApplicationService.test.ts`** — Rewritten with 41 tests:
  - Updated `createMockTaskRun` to support `[Symbol.asyncIterator]` with `steps` parameter and `result` property
  - Added unit tests for `classifyApplicationPhase` (5 tests), `detectCaptchaOrStuck` (5 tests), `ensureLogDirectory` (2 tests), `saveStepScreenshot` (3 tests), `saveRunSummary` (2 tests)
  - Added integration tests for step iteration, phase logging, captcha/stuck detection during iteration, screenshot saving, task log saving, null result handling, non-Error catch branches
  - Mocked `node:fs/promises` (mkdir, writeFile) and global `fetch` for screenshot/log downloads
- **`server/src/routes/jobApplications.ts`** — Added logging throughout:
  - Route handler: `[applicator:route]` prefix logs for job start, config errors
  - `applyToSingleJob()`: logs result status, `console.error` in catch block with error message
  - `runBatchApply()`: logs batch start/progress/completion with `[applicator:batch]` prefix, per-job progress, `console.error` on failure
  - Passes `jobId` to `applyToJob()` for meaningful log directory names
- **`server/src/routes/jobApplications.test.ts`** — Added test for `console.error` in catch block
- **`.gitignore`** — Added `logs/` entry
- **Project root** — Removed empty `logs` file, created `logs/` directory

---

## 2026-03-28: Job Application Service + Bulk Import + Application Dashboard

### What Changed
Added a full job application service that uses Browser Use v2 SDK to apply to job listings, a bulk import endpoint, and a frontend Application Dashboard page. Simplified the JobStatus enum to track the application lifecycle only (init → applying → applied / error_applying). Imported 29 LinkedIn job URLs from the user's Google Spreadsheet. Updated scraping to only enrich data (title/description) without changing status.

### Schema Changes
- **`server/prisma/schema.prisma`** — Simplified `JobStatus` enum to `init`, `applying`, `applied`, `error_applying` with comments explaining each. Removed `waiting_for_response`, `approved`, `rejected` (handled by future services). Added `live_url String?` field to `JobListing` for iframe live view during application.

### Backend Changes — New Files
- **`server/src/services/jobApplicationService.ts`** — New service using Browser Use v2 SDK (`browser-use-sdk` default import). Exports `applyToJob()` which uses `flashMode: false` for slow/careful navigation, `sessionSettings.profileId` for persistent browser state. Builds application prompt with user info (name, email, phone, resume URL). Gets `liveUrl` from sessions for iframe viewing. Also exports `UserInfo` and `ApplicationResult` interfaces. Helpers: `buildApplicationPrompt()`, `notifyLiveUrl()`.
- **`server/src/services/jobApplicationService.test.ts`** — 13 tests covering: missing API key, successful application, stopped task, session cleanup, live URL callbacks, timeout handling, polling for taskId, prompt content verification.
- **`server/src/routes/jobApplications.ts`** — New route file with: `POST /:id/apply` (single job application), `POST /apply-batch` (batch apply to all init jobs), `GET /apply-batch/status` (batch progress). Exports `jobApplicationsRouter`, `applyToSingleJob`, `runBatchApply`, `batchState`, `readUserInfo`, `getProfileId`. In-memory `BatchApplyState` tracks batch progress.
- **`server/src/routes/jobApplications.test.ts`** — 19 tests covering: single apply (202, 400, 404, status validation, re-apply on error), batch apply (202, 400, 409 conflict), batch status endpoint, runBatchApply with live URL callback, failure cases, error catching.

### Backend Changes — Modified Files
- **`server/src/app.ts`** — Registered `jobApplicationsRouter` at `/api/job-listings`.
- **`server/src/routes/jobListings.ts`** — Changed POST create to use `status: "init"` instead of `"pending"`. `scrapeAndUpdateJobListing()` now only updates `title`, `description`, `post_date` (no longer changes `status` or `live_url`). Removed `handleLiveUrlReady` callback from scraping. Added `POST /api/job-listings/bulk` endpoint accepting `{ urls: string[] }`.
- **`server/src/routes/jobListings.test.ts`** — Updated all mock statuses from `"pending"`/`"completed"`/`"failed"` to `"init"`. Updated assertions for scraping (no status changes). Added 5 bulk import tests. Added `as const` type annotations for Prisma enum compatibility.
- **`server/src/scripts/user_info.json`** — Replaced with data from Google Spreadsheet Sheet2: firstName, middleName, lastName, email, phone, github, linkedin, website, resumeUrl.
- **`.env`** — Added `BROWSER_USE_PROFILE_ID="439bc116-ae1f-4f98-aee1-6a7cd16d4968"`.

### Frontend Changes — New Files
- **`client/src/pages/ApplicationDashboardPage.tsx`** — New page at `/apply`. Shows jobs grouped by status (Ready, Applying, Applied, Errors). "Apply to All" button starts batch processing. Per-job "Apply" button. Live iframe during application (reads `live_url`). Batch progress bar with LinearProgress. Polls every 3 seconds while any job is `applying`. Summary chips at bottom.
- **`client/src/pages/ApplicationDashboardPage.test.tsx`** — 21 tests covering: loading, title, status sections, live iframe, waiting message, error alerts, apply/batch buttons, progress bar, summary chips, empty states, polling lifecycle, close error, retry button, generic errors.

### Frontend Changes — Modified Files
- **`client/src/App.tsx`** — Added `/apply` route for `ApplicationDashboardPage`. Added import.
- **`client/src/components/NavMenu.tsx`** — Added "Apply" nav item (`{ label: "Apply", path: "/apply" }`).
- **`client/src/components/NavMenu.test.tsx`** — Updated to assert 3 nav links (added Apply).
- **`client/src/components/JobList.tsx`** — Updated status chip config from `pending`/`completed`/`failed` to `init`/`applying`/`applied`/`error_applying` with new labels (Ready, Applying, Applied, Error). Changed `isPending` check to `status === "applying"`.
- **`client/src/components/JobList.test.tsx`** — Updated mock data and assertions for new status values.
- **`client/src/pages/JobViewPage.tsx`** — Updated status chip config. Changed pending check to `status === "applying"`. Updated text from "Scraping Job Details..." to "Applying to Job...".
- **`client/src/pages/JobViewPage.test.tsx`** — Updated mock data and assertions for new status values.
- **`client/src/pages/JobsListPage.tsx`** — Changed polling trigger from `"pending"` to `"applying"`.
- **`client/src/pages/JobsListPage.test.tsx`** — Updated mock data and test descriptions for new status values.
- **`client/src/pages/AddJobPage.test.tsx`** — Updated mock status from `"pending"` to `"init"`.
- **`client/src/components/AddJobForm.test.tsx`** — Updated mock status from `"pending"` to `"init"`.
- **`client/src/services/jobListingsApi.ts`** — Added `bulkCreateJobListings()`, `applyToJob()`, `startBatchApply()`, `getBatchApplyStatus()`. Added `BatchApplyStatusResponse` interface.
- **`client/src/services/jobListingsApi.test.ts`** — Updated mock status. Added 10 tests for new API functions.

### Database Changes
- Ran `npx prisma db push` to add `live_url` column and update enum.
- Set all existing records to `status = 'init'`.
- Seeded 29 LinkedIn job URLs from Google Spreadsheet Sheet1.
- Total records: 31 (2 existing + 29 imported).

---

## 2026-03-08: Read Ports from Environment Variables

### What Changed
All port configuration is now driven by `.env` variables (`SERVER_PORT` and `CLIENT_PORT`). Previously, the server port (3001) was hardcoded in `server/src/index.ts` and both ports were hardcoded in `client/vite.config.ts` and `dev-claude.sh`. Now the server runs on port 3000 and the frontend on 5173, both read from `.env`. If either port variable is missing, the server exits with an error, the vite config throws, and the dev script aborts before starting anything.

### Files Modified
- **`.env`** — Added `SERVER_PORT=3000` and `CLIENT_PORT=5173`.
- **`server/src/index.ts`** — Reads `SERVER_PORT` from `process.env`, exits with error if not set, parses it to an integer.
- **`client/vite.config.ts`** — Loads `.env` via `dotenv`, reads `CLIENT_PORT` and `SERVER_PORT`, throws if either is missing. Uses them for the dev server port and API proxy target.
- **`dev-claude.sh`** — Sources `.env` at startup, checks `SERVER_PORT` and `CLIENT_PORT` are set before launching servers, uses them in health check URLs.

---

## 2026-03-08: Unified Scraper Flow — Go Directly to Job URL Instead of Login-First

### What Changed
Replaced the two-step LinkedIn scraping approach (login first, then extract) with a single unified flow for all URLs. The scraper now navigates directly to the job URL and includes login credentials in the prompt so the Browser Use agent can authenticate only if the page requires it. This eliminates the slow separate login step and combines the LinkedIn and non-LinkedIn code paths into one.

### Backend Changes
- **`server/src/services/jobListingScraperService.ts`** — Removed the `if (hasCredentials)` branching that had two separate `client.run()` calls. Added `buildExtractionPrompt()` helper that constructs a single prompt containing both the extraction instructions and optional credential info. Now uses one `client.run()` call regardless of whether credentials are provided.
- **`server/src/services/jobListingScraperService.test.ts`** — Removed the two-step login+extraction test and the "login fails" test. Added test for credentials being included in the prompt for LinkedIn URLs (single call). Added tests for: session stop failure, `sessions.get()` failure when fetching live URL, and session with no liveUrl.

### Test Coverage Improvements
- Added non-Error catch branch tests across `AddJobForm`, `JobsListPage`, `JobViewPage`.
- Added `deleteJobListing` generic error fallback test and unknown status chip test for `JobList`.
- Excluded `prismaClient.ts` from coverage (always mocked, not unit-testable).
- All coverage thresholds (90% statements/branches/functions/lines) now met.

### Files Modified
- `server/src/services/jobListingScraperService.ts`, `server/src/services/jobListingScraperService.test.ts`
- `client/src/services/jobListingsApi.test.ts`, `client/src/components/AddJobForm.test.tsx`
- `client/src/components/JobList.test.tsx`, `client/src/pages/JobsListPage.test.tsx`
- `client/src/pages/JobViewPage.test.tsx`, `vitest.config.ts`

---

## 2026-03-08: Live Browser View During Scraping + Navigate to Job After Submission

### What Changed
After submitting a job URL, the user is now navigated to the job view page (`/jobs/:id`) which shows live scraping progress. When the listing is pending, an iframe displays the Browser Use live browser view so the user can watch the agent work. The page polls every 3 seconds and transitions to the full detail view once scraping completes (or shows error on failure).

### Backend Changes
- **Prisma schema** — Added optional `live_url` field to `JobListing` model.
- **`server/src/services/jobListingScraperService.ts`** — Added `onLiveUrlReady` callback parameter to `fetchJobListingFromUrl`. Added `notifyLiveUrl` helper that polls the `SessionRun.sessionId` getter, then fetches the session via `client.sessions.get()` to obtain the `liveUrl`. The `client.run()` call is no longer immediately awaited for the first step — the SessionRun handle is used to get the sessionId before awaiting the result.
- **`server/src/routes/jobListings.ts`** — Passes `handleLiveUrlReady` callback to the scraper that stores `live_url` in the DB. Clears `live_url` to `null` when scraping completes or fails.

### Frontend Changes
- **`client/src/services/jobListingsApi.ts`** — Added `live_url: string | null` to `JobListingResponse`.
- **`client/src/components/AddJobForm.tsx`** — `onJobAdded` callback now receives the created job's ID (`onJobAdded(createdListing.id)`).
- **`client/src/pages/AddJobPage.tsx`** — Navigates to `/jobs/:id` instead of `/jobs` after submission.
- **`client/src/pages/JobViewPage.tsx`** — Full rewrite with two states: **pending** (shows "Scraping Job Details..." header, iframe with `live_url` when available, "Waiting for browser session..." placeholder otherwise, 3s polling) and **completed/failed** (shows full job details as before).

### Files Modified
- `server/prisma/schema.prisma`, `server/src/services/jobListingScraperService.ts`, `server/src/routes/jobListings.ts`
- `client/src/services/jobListingsApi.ts`, `client/src/components/AddJobForm.tsx`, `client/src/pages/AddJobPage.tsx`, `client/src/pages/JobViewPage.tsx`
- All associated test files updated with `live_url` in mock data, SessionRun mock helpers, new iframe/polling tests.

---

## 2026-03-08: Add Job View Page with Clickable List Items

### What Changed
Added a `/jobs/:id` route that displays the full details of a single job listing (title, status, URL, post date, added date, full description). Job list items are now clickable — clicking a listing navigates to its detail page. Added `getJobListing(id)` to the API service.

### Files Modified
- **`client/src/App.tsx`** — Added `/jobs/:id` route for `JobViewPage`.
- **`client/src/components/JobList.tsx`** — Wrapped list item content in `ListItemButton` with `useNavigate` to navigate to `/jobs/:id` on click. Delete button uses `stopPropagation` to avoid triggering navigation.
- **`client/src/components/JobList.test.tsx`** — Wrapped renders in `MemoryRouter` (needed for `useNavigate`), added test for clickable list items.
- **`client/src/services/jobListingsApi.ts`** — Added `getJobListing(id)` function to fetch a single listing.
- **`client/src/services/jobListingsApi.test.ts`** — Added tests for `getJobListing`: success, API error, and generic error cases.

### New Files
- **`client/src/pages/JobViewPage.tsx`** — Displays full job details with back link, loading state, error handling, and status chip.
- **`client/src/pages/JobViewPage.test.tsx`** — Tests for loading, display, errors, invalid ID, back link, empty title/description.

---

## 2026-03-08: Add Navigation Menu and Separate Pages for Add Job and Jobs List

### What Changed
Split the single-page App into two routed pages with a persistent navigation menu. The "Add Job" page now only has the URL submission form (no job list). The "Jobs List" page has the listing table with polling. After submitting a job, the user is navigated to the Jobs List page automatically.

### Files Modified
- **`client/src/App.tsx`** — Replaced monolithic component with `BrowserRouter` + `Routes` setup. Now renders `NavMenu` and two routes: `/` (AddJobPage) and `/jobs` (JobsListPage).
- **`client/src/App.test.tsx`** — Rewritten to test router setup: renders nav menu and default Add Job page at root.

### New Files
- **`client/src/components/NavMenu.tsx`** — MUI `AppBar` with nav links for "Add Job" and "Jobs List", with route-aware active state highlighting.
- **`client/src/components/NavMenu.test.tsx`** — Tests for nav rendering and active state on each route.
- **`client/src/pages/AddJobPage.tsx`** — Page with just the AddJobForm; navigates to `/jobs` on success.
- **`client/src/pages/AddJobPage.test.tsx`** — Tests for page rendering and form submission.
- **`client/src/pages/JobsListPage.tsx`** — Page with job list, loading/error states, and 5-second polling for pending listings (logic moved from App.tsx).
- **`client/src/pages/JobsListPage.test.tsx`** — Tests for listing display, loading, errors, polling, and poll-stop behavior.

### New Dependencies
- `react-router-dom` — Client-side routing (ships its own TypeScript types).

---

## 2026-03-08: Fix Invalid Date Parsing for Relative Post Dates

### What Changed
The Browser Use agent returns `postDate` as relative strings like `"2 hours ago"`. The route was using `new Date(scrapedData.postDate)` which returns `Invalid Date` for such strings, causing the Prisma `update()` to throw and the listing to end up with `status: "failed"`. Replaced with `chrono-node`'s `parseDate()` which handles both relative dates (`"2 hours ago"`, `"yesterday"`) and absolute dates (`"2026-03-01"`, `"March 1, 2026"`).

### Files Modified
- **`server/src/routes/jobListings.ts`** — Added `chrono-node` import, created `parsePostDate()` helper that uses `chrono-node`'s `parseDate()` with a fallback to `new Date()` for unparseable strings. Replaced `new Date(scrapedData.postDate)` with `parsePostDate(scrapedData.postDate)`.
- **`server/src/routes/jobListings.test.ts`** — Added `chrono-node` mock via `vi.hoisted()`. Added two new tests: one verifying relative dates like `"2 hours ago"` are parsed correctly, and one verifying unparseable strings fall back to the current date. Existing tests continue to work via a default mock implementation.

### New Dependencies
- `chrono-node` — Natural language date parser (ships its own TypeScript types).

---

## 2026-03-08: Replace CDP Scraping with Browser Use Agent + Login Credentials

### What Changed
Replaced the entire CDP-based scraping approach (manual WebSocket connections, cookie injection, DOM selectors) with Browser Use's v3 agent-based `client.run()` API. Authentication now uses LinkedIn login credentials instead of raw cookies.

### Files Modified
- **`server/src/services/jobListingScraperService.ts`** — Full rewrite. Removed all CDP code (`ws` import, `sendCdpCommand`, `waitForCdpEvent`, `parseCookies`, `discoverPageTarget`, `connectToCdp`, `extractJobDetails`). Now uses `BrowserUse` from `browser-use-sdk/v3` with `client.run()` and a Zod schema for structured extraction. For LinkedIn URLs with credentials, performs a two-step flow: login then extraction. For non-LinkedIn URLs, a single extraction step.
- **`server/src/routes/jobListings.ts`** — Changed from reading a cookie text file to reading a credentials JSON file. `scrapeAndUpdateJobListing` now passes `LinkedInCredentials | null` instead of a cookie string.
- **`server/src/scripts/fetchJobListing.ts`** — Removed cookie CLI argument. Now accepts only a URL, reads credentials from `linkedin_credentials.json` for LinkedIn URLs.
- **`server/src/services/jobListingScraperService.test.ts`** — Full rewrite. Removed WebSocket/CDP mocks. Now mocks `browser-use-sdk/v3` `client.run()` and tests: happy path with/without credentials, login failure, extraction failure, no output, session cleanup.
- **`server/src/routes/jobListings.test.ts`** — Updated to use credentials JSON instead of cookie text. Tests now verify credentials object is passed for LinkedIn URLs and null for non-LinkedIn URLs.

### New Files
- **`server/src/scripts/linkedin_credentials.json`** — LinkedIn login credentials (email/password). Added to `.gitignore`.

### New Dependencies
- `zod` — Used for defining structured output schemas for Browser Use agent extraction.
