# AI Journal

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
