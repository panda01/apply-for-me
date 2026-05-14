# AI Journal

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
