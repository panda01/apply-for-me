import type { Page } from "playwright";

/**
 * Shared in-container helpers used by both /screenshot and the agent's tools.
 *
 * - DISMISS_HELPER_SCRIPT clears popups, cookie banners, and sign-in walls,
 *   while explicitly *protecting* apply-bearing buttons that share class-name
 *   substrings with modal containers (e.g. LinkedIn's `sign-up-modal__outlet`
 *   on the primary "Apply" CTA).
 * - captureCleanedScreenshot dismisses popups, scrolls the page up to a fixed
 *   pixel cap to trigger lazy-loaded content, then takes a screenshot capped
 *   at the same height so infinite-scroll pages can't blow up the response.
 */

/**
 * Maximum height (px) that captureCleanedScreenshot will capture, even on
 * pages with infinite scroll. Past this point we stop scrolling and crop.
 */
export const SCREENSHOT_MAX_HEIGHT_PX = 5000;

/**
 * Step (px) used when scrolling down to trigger lazy-loaded content.
 */
const LAZY_LOAD_SCROLL_STEP_PX = 1000;

/**
 * Time (ms) to wait between scroll steps so lazy-load handlers can fire.
 */
const LAZY_LOAD_SCROLL_DELAY_MS = 100;

/**
 * Default viewport width to fall back to if the page hasn't been given one.
 */
const DEFAULT_VIEWPORT_WIDTH = 1280;

/**
 * Default viewport height for the fallback case (also used when restoring
 * after we temporarily change the viewport for a screenshot).
 */
const DEFAULT_VIEWPORT_HEIGHT = 720;

/**
 * Deterministic dismissal of common overlays:
 *   - Click any visible "close/dismiss/no thanks/not now" buttons
 *   - Hide elements that match modal-container / cookie / consent / signin
 *     patterns (carefully phrased so a button class like
 *     `sign-up-modal__outlet` does NOT get caught by a bare "modal" substring)
 *   - Restore body scroll
 *   - Apply-button exemption pass: any element whose accessible name matches
 *     an apply pattern has its inline display/visibility forced visible (with
 *     !important) so a stray hide rule can't take it out
 *
 * Returns a JSON string with summary counts the caller can log.
 */
export const DISMISS_HELPER_SCRIPT = `
(() => {
  const closeSelectors = [
    'button[aria-label*="close" i]',
    'button[aria-label*="dismiss" i]',
    'button[aria-label*="no thanks" i]',
    'button[aria-label*="not now" i]',
    '[data-tracking-control-name*="dismiss" i]',
    '[data-test*="dismiss" i]',
    'button[title*="close" i]',
  ];

  // Tightened: target container/wrapper/backdrop/overlay class patterns that
  // are unambiguously modal *containers*, not button trigger classes. The
  // bare /Modal/ and /Overlay/ substring rules used to match LinkedIn's
  // "sign-up-modal__outlet" Apply button, which is why dismiss was killing
  // the primary CTA.
  const hideSelectors = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[class*="modal-overlay" i]',
    '[class*="modal-wrapper" i]',
    '[class*="modal-container" i]',
    '[class*="modal-backdrop" i]',
    '[class*="modal-content" i]',
    '[class*="ModalContainer"]',
    '[class*="ModalWrapper"]',
    '[class*="ModalOverlay"]',
    '[class*="-overlay" i]',
    '[class*="contextual-sign-in" i]',
    '[class*="contextual-signin" i]',
    '[class*="Cookie" i]',
    '[class*="Consent" i]',
    '[class*="paywall" i]',
    '[id*="cookie" i]',
    '[id*="consent" i]',
  ];

  let clicked = 0;
  for (const sel of closeSelectors) {
    document.querySelectorAll(sel).forEach((el) => {
      if (el instanceof HTMLElement && el.offsetParent !== null) {
        try { el.click(); clicked += 1; } catch (_) {}
      }
    });
  }

  let hidden = 0;
  const styleId = "afm-popup-killer-style";
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = hideSelectors.map((s) => s + "{display:none !important;visibility:hidden !important;}").join("\\n") +
    " html,body{overflow:auto !important;position:static !important;}";
  hideSelectors.forEach((sel) => { hidden += document.querySelectorAll(sel).length; });

  document.documentElement.style.removeProperty("overflow");
  document.body.style.removeProperty("overflow");
  document.body.removeAttribute("inert");
  document.body.removeAttribute("aria-hidden");

  // Apply-button exemption: walk every interactive element whose accessible
  // name matches an apply pattern, and force display/visibility:visible on
  // it and its ancestors with inline !important — which beats stylesheet
  // !important rules in CSS specificity. Belt-and-suspenders against future
  // class-name collisions even after the tightened hide selectors above.
  const applyRegex = /\\bapply\\b|easy\\s*apply|quick\\s*apply|submit\\s*application/i;
  let exempted = 0;
  document.querySelectorAll("button, [role='button'], a").forEach((el) => {
    const accessibleName = (el.getAttribute("aria-label") || el.textContent || "").trim();
    if (!applyRegex.test(accessibleName)) return;
    let current = el;
    while (current && current !== document.body) {
      if (current instanceof HTMLElement) {
        current.style.setProperty("display", "revert", "important");
        current.style.setProperty("visibility", "visible", "important");
      }
      current = current.parentElement;
    }
    exempted += 1;
  });

  return JSON.stringify({ clicked, hidden, exempted });
})()
`;

/**
 * Sleeps for the given number of milliseconds. Used between scroll steps so
 * lazy-load handlers attached to scroll/intersection events have a chance to
 * fire before the next step.
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>} Resolves after the timeout
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Triggers lazy-loaded content above the screenshot cap by scrolling
 * incrementally to the cap and resetting to the top. Bounded by the page's
 * actual scrollHeight so short pages don't waste time scrolling past the end.
 *
 * @param {Page} page - The Playwright page to scroll
 * @returns {Promise<void>} Resolves once the scroll loop has reset back to top
 */
async function scrollToTriggerLazyLoads(page: Page): Promise<void> {
  await page.evaluate(
    async ({ cap, step, delayMs }) => {
      let pos = 0;
      while (pos < cap) {
        window.scrollTo(0, pos);
        pos += step;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const reachedBottom = document.documentElement.scrollHeight <= pos;
        if (reachedBottom) break;
      }
      window.scrollTo(0, 0);
    },
    {
      cap: SCREENSHOT_MAX_HEIGHT_PX,
      step: LAZY_LOAD_SCROLL_STEP_PX,
      delayMs: LAZY_LOAD_SCROLL_DELAY_MS,
    }
  );
  // One last frame to let the reset settle before the screenshot is taken.
  await sleep(LAZY_LOAD_SCROLL_DELAY_MS);
}

/**
 * Dismisses popups, triggers lazy-loaded content up to SCREENSHOT_MAX_HEIGHT_PX,
 * then captures a PNG of the page. For pages whose scrollHeight is at or below
 * the cap, returns the full page. For pages above the cap, returns the top
 * SCREENSHOT_MAX_HEIGHT_PX pixels (everything below that is intentionally not
 * scrolled into view, per the "infinite scroll — just stop and screenshot" spec).
 *
 * @param {Page} page - The Playwright page to capture
 * @returns {Promise<Buffer>} PNG bytes of the cleaned, capped screenshot
 */
export async function captureCleanedScreenshot(page: Page): Promise<Buffer> {
  await page.evaluate(DISMISS_HELPER_SCRIPT);
  await scrollToTriggerLazyLoads(page);

  const naturalHeight = await page.evaluate(() => {
    return Math.max(
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight,
      document.body.scrollHeight,
      document.body.offsetHeight
    );
  });
  const clipHeight = Math.min(naturalHeight, SCREENSHOT_MAX_HEIGHT_PX);
  const viewport = page.viewportSize() ?? { width: DEFAULT_VIEWPORT_WIDTH, height: DEFAULT_VIEWPORT_HEIGHT };

  return page.screenshot({
    type: "png",
    fullPage: true,
    clip: { x: 0, y: 0, width: viewport.width, height: clipHeight },
  });
}
