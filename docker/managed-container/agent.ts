import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import { DISMISS_HELPER_SCRIPT, captureCleanedScreenshot } from "./popup.js";

/**
 * Agent module: drives a Playwright Page with Claude tool-calling to determine
 * whether a URL is a job description page.
 *
 * The agent loop is small by design. We define five tools, run a max-N-turn
 * loop, and let Claude decide which tools to call. Detection rule (encoded in
 * the system prompt):
 *
 *   is_job_description = (>=1 Class A signal) AND (>=2 Class B signals)
 *     Class A: visible "apply" affordance (button/link/external apply)
 *     Class B: section headings, salary patterns, employment-type labels,
 *              worksite labels, experience markers
 *
 * The tools all take a Page (passed via closure in dispatch) and return a
 * string the model can read; `report` is the terminal tool that returns the
 * structured verdict and ends the loop.
 */

const MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 8;
const MAX_TOKENS_PER_TURN = 1024;

/**
 * Final structured result the in-container /analyze endpoint returns to the host.
 */
export interface AnalyzeResult {
  is_job_description: boolean;
  apply_button_present: boolean;
  description_signals: string[];
  reasoning: string;
  screenshot_b64: string;
}

const SYSTEM_PROMPT = `You inspect a web page and decide whether it is a JOB DESCRIPTION page.

Procedure:
1. Call dismiss_popups once to clear cookie banners, sign-in modals, and other overlays.
2. Call get_page_summary to read the page's headings, button labels, salary text, and employment-type tokens.
3. Based on the get_page_summary result, decide preliminarily whether this looks like a job description page (Class A apply affordance present AND >= 2 Class B signals). If yes, call expand_collapsed_sections to click any "Show more" / "Show full description" / "...more" buttons so the full description is visible, then call get_page_summary again so the final report reflects the expanded content.
4. Call screenshot once to capture the final cleared+expanded page.
5. Call report with your verdict.

Detection rule:
  is_job_description = (>= 1 Class A signal) AND (>= 2 Class B signals)

Class A — Apply affordance (any one suffices):
  - Visible button or link whose accessible name matches /apply|easy apply|quick apply|submit application|apply now/i
  - "Apply on company website" or similar external-apply link
  - A form whose submit control says apply/submit/send
  - The page summary's "applyButtons" array contains at least one entry whose label matches the apply pattern (this is an explicit, uncapped sweep — trust it even if no Apply button appears in the general "buttons" list)

Class B — Description content (need >= 2 distinct):
  - Section headings or labeled blocks: "Job description", "Responsibilities", "Requirements", "Qualifications", "What you'll do", "About this role", "About the role", "Skills"
  - Salary pattern: $XX,XXX or $XX,XXX-$XX,XXX (or other currency like £, €)
  - Employment type: "Full-time", "Part-time", "Contract", "Internship", "Temporary"
  - Worksite: "Remote", "Hybrid", "On-site", "On site", "In-person"
  - Experience marker: "3+ years", "5 years experience", "Senior", "Junior", "Mid-level", "Entry-level"

Always end with a report call. Do not exceed ${String(MAX_TURNS)} turns. If you cannot decide, report is_job_description: false and explain why in reasoning.`;

const tools: Anthropic.Messages.Tool[] = [
  {
    name: "dismiss_popups",
    description: "Run a deterministic helper that hides modals/cookie banners/sign-in walls and unlocks body scroll. Returns a short summary of what it cleared.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_page_summary",
    description: "Returns a JSON snapshot of the visible page: heading texts (h1/h2/h3), visible button and link accessible names, the first 600 chars of main text, salary regex matches, employment-type tokens, worksite tokens, and experience markers.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "click_by_text",
    description: "Click the first visible element whose accessible name contains the given text (case-insensitive). Useful for dismissing a stubborn modal that needs a click, or any one-off click. For expanding a job description's 'Show more' button, prefer expand_collapsed_sections which handles every common variant in one call.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "Substring of the element's accessible name" } },
      required: ["text"],
    },
  },
  {
    name: "expand_collapsed_sections",
    description: "Click every visible 'Show more', 'Show full description', or '...more' button on the page to reveal the full job description before reporting. Safe to call multiple times; idempotent on already-expanded pages. Returns a JSON summary listing the labels of buttons that were clicked.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "screenshot",
    description: "Capture a viewport screenshot of the current page state. Call this once after dismissal+summary, before report. The bytes are stored for the final response; you don't see them.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "report",
    description: "End the loop and return the final verdict.",
    input_schema: {
      type: "object",
      properties: {
        is_job_description: { type: "boolean" },
        apply_button_present: { type: "boolean" },
        description_signals: { type: "array", items: { type: "string" }, description: "Names of the Class B signals you actually found, e.g. ['Responsibilities', 'Full-time', 'Remote']" },
        reasoning: { type: "string", description: "1-2 sentences explaining your verdict" },
      },
      required: ["is_job_description", "apply_button_present", "description_signals", "reasoning"],
    },
  },
];

/**
 * Extracts a small structured summary of the page for the agent to reason
 * about without ingesting the full DOM.
 *
 * Notable shape decisions:
 *   - `applyButtons` is its own uncapped sweep over interactive elements
 *     whose accessible name contains an apply pattern; the LLM should always
 *     see these even if `buttons` is full of nav clutter.
 *   - The general `buttons` cap was bumped 30 → 100 since LinkedIn-class
 *     pages can easily ship 200+ buttons including hidden language pickers
 *     and footer links; lower caps were truncating Apply on busier layouts.
 *
 * Returns a JSON string the model can read.
 */
const SUMMARY_HELPER_SCRIPT = `
(() => {
  const visibleText = (el) => {
    if (!(el instanceof HTMLElement)) return "";
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return "";
    return (el.innerText || el.textContent || "").trim();
  };

  const APPLY_REGEX = /\\bapply\\b|easy\\s*apply|quick\\s*apply|submit\\s*application/i;

  const headings = [];
  document.querySelectorAll("h1, h2, h3").forEach((h) => {
    const t = visibleText(h);
    if (t && headings.length < 30) headings.push(t.slice(0, 120));
  });

  const buttons = [];
  const applyButtons = [];
  document.querySelectorAll("button, [role='button'], a").forEach((b) => {
    const aria = (b.getAttribute("aria-label") || "").trim();
    const text = visibleText(b);
    const label = (aria || text).trim();
    if (!label) return;

    if (buttons.length < 100) {
      buttons.push(label.slice(0, 80));
    }

    // Always surface apply-bearing elements regardless of the buttons cap and
    // regardless of visibility, so the agent can verify Class A even on pages
    // where Apply lives deep in DOM order or inside a hidden trigger.
    if (APPLY_REGEX.test(label) || APPLY_REGEX.test(text) || APPLY_REGEX.test(aria)) {
      applyButtons.push({
        label: label.slice(0, 80),
        href: (b.getAttribute("href") || "").slice(0, 200),
      });
    }
  });

  const main = document.querySelector("main") || document.body;
  const mainText = (main.innerText || "").trim().slice(0, 600);

  const fullPageText = (document.body.innerText || "").slice(0, 20000);
  const salaryMatches = (fullPageText.match(/[$£€]\\s?\\d[\\d,.]*(?:\\s?[-–to]+\\s?[$£€]?\\s?\\d[\\d,.]*)?/g) || []).slice(0, 5);
  const employmentTypes = ["Full-time", "Part-time", "Contract", "Internship", "Temporary"]
    .filter((t) => new RegExp(t.replace("-", "[- ]?"), "i").test(fullPageText));
  const worksite = ["Remote", "Hybrid", "On-site", "On site", "In-person"]
    .filter((t) => new RegExp(t, "i").test(fullPageText));
  const experienceMarkers = (fullPageText.match(/\\d+\\+?\\s*years?\\s*(?:of\\s*)?experience|Senior|Junior|Mid[- ]level|Entry[- ]level/gi) || []).slice(0, 5);

  return JSON.stringify({
    url: location.href,
    title: document.title.slice(0, 200),
    headings,
    buttons,
    applyButtons,
    mainText,
    salaryMatches,
    employmentTypes,
    worksite,
    experienceMarkers,
  });
})()
`;

/**
 * Deterministic helper script that finds and clicks every visible
 * "Show more" / "Show full description" / "...more" button on the page so the
 * agent's final screenshot and re-summary reflect the fully expanded job
 * description. Modeled on DISMISS_HELPER_SCRIPT: pure DOM operations executed
 * via page.evaluate(), no Playwright clicks needed.
 *
 * Match rules (after trimming whitespace from the accessible name):
 *   - /show more|show full description/i  (contains-match, case-insensitive)
 *   - /^(?:\.{3}|…)\s*more$/i        (exact-after-trim "...more" or "…more")
 *
 * The ellipsis pattern is intentionally anchored to "…more" / "...more" so it
 * does not match truncation indicators inside body text like
 * "Senior engineer with 5+ years..." which would otherwise blow up the click
 * count without expanding anything.
 *
 * Returns JSON: { clicked: number, labels: string[] }.
 */
const EXPAND_HELPER_SCRIPT = `
(() => {
  const isVisible = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return true;
  };

  const accessibleName = (el) => {
    const aria = (el.getAttribute("aria-label") || "").trim();
    if (aria.length > 0) return aria;
    const text = ((el).innerText || el.textContent || "").trim();
    return text;
  };

  const SHOW_MORE_REGEX = /show more|show full description/i;
  const ELLIPSIS_MORE_REGEX = /^(?:\\.{3}|\\u2026)\\s*more$/i;

  const matches = (label) => SHOW_MORE_REGEX.test(label) || ELLIPSIS_MORE_REGEX.test(label);

  const labels = [];
  const candidates = Array.from(document.querySelectorAll("button, [role='button'], a"));
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const label = accessibleName(el);
    if (label.length === 0) continue;
    if (!matches(label)) continue;
    try {
      el.click();
      labels.push(label.slice(0, 80));
    } catch (err) {
      // Swallow individual click errors so one bad element doesn't abort the sweep.
    }
  }

  return JSON.stringify({ clicked: labels.length, labels });
})()
`;

/**
 * Reads the API key from the env var, throwing a clear error if it's missing
 * so the /analyze route can surface that as a 500 with a useful message.
 * @returns {Anthropic} A configured SDK client
 */
function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const isMissingKey = apiKey === undefined || apiKey.length === 0;
  if (isMissingKey) {
    throw new Error("ANTHROPIC_API_KEY env var is not set inside the container");
  }
  return new Anthropic({ apiKey });
}

/**
 * Dispatches a single tool_use block by running the corresponding Playwright
 * action against the supplied page. `report` is treated as terminal: its input
 * is captured (along with the cached screenshot) and returned in `result`.
 *
 * @param {Page} page - The Playwright page the agent is inspecting
 * @param {Anthropic.Messages.ToolUseBlock} toolUse - The tool_use block from Claude
 * @param {() => string | null} getCachedScreenshot - Returns the most recent screenshot the agent took, or null if none yet
 * @param {(b64: string) => void} setCachedScreenshot - Stores a freshly captured screenshot
 * @returns {Promise<{ output: string; finalReport: AnalyzeResult | null }>} The string sent back to Claude, plus the verdict if the tool was `report`
 */
async function dispatchTool(
  page: Page,
  toolUse: Anthropic.Messages.ToolUseBlock,
  getCachedScreenshot: () => string | null,
  setCachedScreenshot: (b64: string) => void
): Promise<{ output: string; finalReport: AnalyzeResult | null }> {
  switch (toolUse.name) {
    case "dismiss_popups": {
      const result = await page.evaluate(DISMISS_HELPER_SCRIPT);
      return { output: `Popups dismissed: ${String(result)}`, finalReport: null };
    }
    case "get_page_summary": {
      const summaryJson = await page.evaluate(SUMMARY_HELPER_SCRIPT);
      return { output: String(summaryJson), finalReport: null };
    }
    case "expand_collapsed_sections": {
      const result = await page.evaluate(EXPAND_HELPER_SCRIPT);
      return { output: `Expanded sections: ${String(result)}`, finalReport: null };
    }
    case "click_by_text": {
      const input = toolUse.input as { text?: unknown };
      const rawText = input.text;
      const isInvalidText = typeof rawText !== "string" || rawText.length === 0;
      if (isInvalidText) {
        return { output: "click_by_text requires a non-empty text argument", finalReport: null };
      }
      try {
        const locator = page.getByText(rawText, { exact: false }).first();
        await locator.click({ timeout: 5000 });
        return { output: `Clicked element matching "${rawText}"`, finalReport: null };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { output: `click_by_text failed: ${errorMessage}`, finalReport: null };
      }
    }
    case "screenshot": {
      const buffer = await captureCleanedScreenshot(page);
      const b64 = buffer.toString("base64");
      setCachedScreenshot(b64);
      return { output: `Screenshot captured (${String(buffer.byteLength)} bytes).`, finalReport: null };
    }
    case "report": {
      const input = toolUse.input as {
        is_job_description?: unknown;
        apply_button_present?: unknown;
        description_signals?: unknown;
        reasoning?: unknown;
      };
      const cachedScreenshot = getCachedScreenshot();
      const fallbackScreenshot = cachedScreenshot ?? (await captureCleanedScreenshot(page)).toString("base64");
      const finalReport: AnalyzeResult = {
        is_job_description: typeof input.is_job_description === "boolean" ? input.is_job_description : false,
        apply_button_present: typeof input.apply_button_present === "boolean" ? input.apply_button_present : false,
        description_signals: Array.isArray(input.description_signals)
          ? input.description_signals.filter((s): s is string => typeof s === "string")
          : [],
        reasoning: typeof input.reasoning === "string" ? input.reasoning : "(no reasoning provided)",
        screenshot_b64: fallbackScreenshot,
      };
      return { output: "Report received.", finalReport };
    }
    default: {
      return { output: `Unknown tool: ${toolUse.name}`, finalReport: null };
    }
  }
}

/**
 * Runs the agent loop against the given URL using the supplied Playwright page.
 * Navigates to the URL, then iterates Claude turns up to MAX_TURNS until the
 * agent calls `report`. Throws if the loop exits without a report.
 *
 * @param {Page} page - A Playwright page (caller manages browser/context lifecycle)
 * @param {string} url - The URL to analyze
 * @returns {Promise<AnalyzeResult>} The agent's verdict + final screenshot
 */
export async function runAnalyzeAgent(page: Page, url: string): Promise<AnalyzeResult> {
  const client = getAnthropicClient();
  await page.goto(url, { waitUntil: "load", timeout: 30000 });

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: `Analyze this URL: ${url}` },
  ];

  let cachedScreenshot: string | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS_PER_TURN,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use"
    );

    const hasNoToolUses = toolUseBlocks.length === 0;
    if (hasNoToolUses) {
      throw new Error(`Agent ended turn ${String(turn)} without calling a tool (stop_reason: ${String(response.stop_reason)})`);
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      const dispatched = await dispatchTool(
        page,
        toolUse,
        () => cachedScreenshot,
        (b64) => { cachedScreenshot = b64; }
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: dispatched.output,
      });
      if (dispatched.finalReport !== null) {
        return dispatched.finalReport;
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Agent exceeded ${String(MAX_TURNS)} turns without calling report`);
}
