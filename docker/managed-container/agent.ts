import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import { DISMISS_HELPER_SCRIPT, captureCleanedScreenshot } from "./popup.js";

/**
 * Analyzer module: opens a URL with Playwright and decides — using deterministic
 * heuristics, NOT an LLM agent loop — whether the page is a job description, then
 * extracts the structured job fields with a single Claude Haiku call.
 *
 * Flow (see analyzeUrl):
 *   1. Navigate, dismiss popups (deterministic helper script).
 *   2. Summarize the page heuristically (SUMMARY_HELPER_SCRIPT): headings,
 *      button labels, salary regex matches, employment-type / worksite /
 *      experience tokens, apply buttons, and the main text.
 *   3. Apply the detection rule deterministically (isJobDescriptionPage):
 *        is_job_description = (>=1 Class A apply affordance) AND (>=2 Class B signals)
 *   4a. If it looks like a posting: expand collapsed sections, re-summarize, then
 *       make ONE Haiku call (no tool loop) to extract title/company/salary/
 *       post_date/work_arrangement.
 *   4b. If it does not: return is_job_description=false with empty fields. The
 *       host (jobListings.ts) is responsible for any Brave-search fallback.
 *   5. Capture a screenshot for the UI.
 *
 * The description text and apply_button_url are taken deterministically from the
 * page summary (not the LLM), exactly as before — the LLM only fills in the
 * short structured fields.
 */

/**
 * Model used for the single structured-field extraction call. Haiku is fast and
 * cheap; extraction is a one-shot prompt (no agent loop), so we don't need a
 * larger model here.
 */
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

/** Token ceiling for the one-shot extraction call. The fields are short. */
const MAX_EXTRACT_TOKENS = 1024;

/** Navigation timeout (ms). Matches the other container Playwright endpoints. */
const PAGE_NAV_TIMEOUT_MS = 30000;

/** Max chars of main page text sent to Haiku — enough for a full job description while bounding tokens. */
const EXTRACTION_MAIN_TEXT_CAP = 6000;

/**
 * Final structured result the in-container /analyze endpoint returns to the host.
 *
 * Field-by-field semantics:
 *   - is_job_description: the deterministic heuristic verdict.
 *   - apply_button_present: true when a Class A apply affordance was detected.
 *   - description_signals: the Class B signal names the heuristic matched.
 *   - reasoning: a short human-readable explanation of which path ran.
 *   - title / company / salary / post_date / work_arrangement: Haiku-extracted
 *     (only when is_job_description is true; otherwise empty/"" / null). salary
 *     and post_date are null when not present; work_arrangement is a raw string
 *     ("remote" | "on_site" | "hybrid" | "") the host normalizes + validates.
 *   - description: NOT LLM-extracted — the page's mainText captured by the
 *     summary helper (empty string when the page wasn't a posting).
 *   - apply_button_url: the first absolute http(s) apply-button href found on
 *     the page, or null. Used by the host resolver downstream.
 *   - page_title: the raw document.title. The host uses it to seed a Brave
 *     search query when the row has no title yet and the first page wasn't a
 *     posting.
 */
export interface AnalyzeResult {
  is_job_description: boolean;
  apply_button_present: boolean;
  description_signals: string[];
  reasoning: string;
  screenshot_b64: string;
  title: string;
  company: string;
  description: string;
  salary: string | null;
  post_date: string | null;
  work_arrangement: string;
  // Free-text job location, "" when not stated.
  location: string;
  apply_button_url: string | null;
  page_title: string;
}

/**
 * Extracts a small structured summary of the page for the heuristic gate and
 * the Haiku extraction to reason about without ingesting the full DOM.
 *
 * Notable shape decisions:
 *   - `applyButtons` is its own uncapped sweep over interactive elements
 *     whose accessible name contains an apply pattern, so the gate can verify
 *     Class A even when `buttons` is full of nav clutter.
 *   - The general `buttons` cap is 100 since LinkedIn-class pages can ship
 *     200+ buttons including hidden language pickers and footer links.
 *
 * Returns a JSON string parsed by {@link parsePageSummary}.
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
    // regardless of visibility, so the gate can verify Class A even on pages
    // where Apply lives deep in DOM order or inside a hidden trigger.
    if (APPLY_REGEX.test(label) || APPLY_REGEX.test(text) || APPLY_REGEX.test(aria)) {
      const rawHref = (b.getAttribute("href") || "").trim();
      // Resolve relative hrefs to absolute via the page's URL so the host
      // resolver downstream can compare hostnames without a base-URL guess.
      // Invalid hrefs (javascript:void(0), mailto:, #fragments, "") fall back
      // to the raw string so the gate still sees something useful.
      let absoluteHref = "";
      if (rawHref.length > 0) {
        try {
          absoluteHref = new URL(rawHref, location.href).href.slice(0, 500);
        } catch (err) {
          absoluteHref = rawHref.slice(0, 500);
        }
      }
      applyButtons.push({
        label: label.slice(0, 80),
        href: absoluteHref,
      });
    }
  });

  const main = document.querySelector("main") || document.body;
  // 10000 chars is generous enough for the longest typical job-description body
  // text and keeps the summary payload bounded.
  const mainText = (main.innerText || "").trim().slice(0, 10000);

  const fullPageText = (document.body.innerText || "").slice(0, 20000);
  const salaryMatches = (fullPageText.match(/[$£€]\\s?\\d[\\d,.]*(?:\\s?[-–to]+\\s?[$£€]?\\s?\\d[\\d,.]*)?/g) || []).slice(0, 5);
  const employmentTypes = ["Full-time", "Part-time", "Contract", "Internship", "Temporary"]
    .filter((t) => new RegExp(t.replace("-", "[- ]?"), "i").test(fullPageText));
  const worksite = ["Remote", "Hybrid", "On-site", "On site", "In-person"]
    .filter((t) => new RegExp(t, "i").test(fullPageText));
  const experienceMarkers = (fullPageText.match(/\\d+\\+?\\s*years?\\s*(?:of\\s*)?experience|Senior|Junior|Mid[- ]level|Entry[- ]level/gi) || []).slice(0, 5);

  // Many small-company job pages have no "Apply" button — applications go
  // through a CV-upload / contact form. Treat a file-upload input, or a form
  // pairing an email field with a free-text message, as an apply affordance so
  // these pages still pass the job-description gate.
  const hasFileInput = document.querySelector("input[type='file']") !== null;
  const hasApplicationForm = hasFileInput || Array.from(document.querySelectorAll("form")).some((f) => {
    const hasEmail = f.querySelector("input[type='email']") !== null;
    const hasMessage = f.querySelector("textarea") !== null;
    return hasEmail && hasMessage;
  });

  return JSON.stringify({
    url: location.href,
    title: document.title.slice(0, 200),
    headings,
    buttons,
    applyButtons,
    hasApplicationForm,
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
 * re-summary reflects the fully expanded job description.
 *
 * Match rules (after trimming whitespace from the accessible name):
 *   - /show more|show full description/i  (contains-match, case-insensitive)
 *   - /^(?:\.{3}|…)\s*more$/i        (exact-after-trim "...more" or "…more")
 *
 * The ellipsis pattern is anchored so it does not match truncation indicators
 * inside body text like "Senior engineer with 5+ years...".
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
 * Structured snapshot of the page the heuristic gate and Haiku extraction read.
 * Mirrors the object SUMMARY_HELPER_SCRIPT serializes.
 */
export interface PageSummary {
  url: string;
  title: string;
  headings: string[];
  buttons: string[];
  applyButtons: { label: string; href: string }[];
  /** True when the page has a CV-upload / email+message application form (a non-button apply affordance). */
  hasApplicationForm: boolean;
  mainText: string;
  salaryMatches: string[];
  employmentTypes: string[];
  worksite: string[];
  experienceMarkers: string[];
}

/**
 * Parses the JSON string produced by SUMMARY_HELPER_SCRIPT into a
 * {@link PageSummary}, tolerating malformed input by returning an empty
 * summary so the gate simply classifies the page as "not a posting".
 *
 * @param {string} summaryJson - The JSON string returned by SUMMARY_HELPER_SCRIPT
 * @returns {PageSummary} The parsed summary, with empty defaults for any missing field
 */
export function parsePageSummary(summaryJson: string): PageSummary {
  const empty: PageSummary = {
    url: "",
    title: "",
    headings: [],
    buttons: [],
    applyButtons: [],
    hasApplicationForm: false,
    mainText: "",
    salaryMatches: [],
    employmentTypes: [],
    worksite: [],
    experienceMarkers: [],
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(summaryJson);
  } catch {
    return empty;
  }
  const isObject = typeof parsed === "object" && parsed !== null;
  if (!isObject) {
    return empty;
  }
  const obj = parsed as Record<string, unknown>;
  const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  const asString = (value: unknown): string => (typeof value === "string" ? value : "");
  const applyButtons = Array.isArray(obj.applyButtons)
    ? obj.applyButtons.flatMap((entry): { label: string; href: string }[] => {
        const isEntryObject = typeof entry === "object" && entry !== null;
        if (!isEntryObject) return [];
        const record = entry as { label?: unknown; href?: unknown };
        return [{ label: asString(record.label), href: asString(record.href) }];
      })
    : [];
  return {
    url: asString(obj.url),
    title: asString(obj.title),
    headings: asStringArray(obj.headings),
    buttons: asStringArray(obj.buttons),
    applyButtons,
    hasApplicationForm: obj.hasApplicationForm === true,
    mainText: asString(obj.mainText),
    salaryMatches: asStringArray(obj.salaryMatches),
    employmentTypes: asStringArray(obj.employmentTypes),
    worksite: asStringArray(obj.worksite),
    experienceMarkers: asStringArray(obj.experienceMarkers),
  };
}

/** Apply-affordance pattern used for the Class A check (mirrors the in-page sweep). */
const APPLY_AFFORDANCE_REGEX = /\bapply\b|easy\s*apply|quick\s*apply|submit\s*application|apply now/i;

/** Job-description section-heading pattern used for one of the Class B signals. Includes the benefit/qualification heading styles small-company pages use ("Working with us means", "Contact us if you", "What we offer"). */
const SECTION_HEADING_REGEX = /job description|responsibilities|requirements|qualifications|what you'?ll do|about (?:this|the) role|about (?:you|us)|skills|what we offer|benefits|perks|who you are|working with us|contact us if/i;

/** Textual salary/compensation mention (no number required), e.g. "Competitive salary". Counts toward the Class B salary signal alongside the numeric regex. */
const SALARY_TEXT_REGEX = /\b(salary|compensation|remuneration|competitive pay|pay range)\b/i;

/**
 * The deterministic verdict produced by {@link isJobDescriptionPage}.
 */
export interface JobPageVerdict {
  /** True when the detection rule (>=1 Class A AND >=2 Class B) is satisfied. */
  isJobDescription: boolean;
  /** True when at least one Class A apply affordance was detected. */
  applyAffordancePresent: boolean;
  /** Human-readable names of the Class B signals that matched. */
  classBSignals: string[];
}

/**
 * Deterministically decides whether a page summary represents a job-description
 * page, replacing the previous LLM judgement. Encodes the same rule the old
 * agent prompt used:
 *
 *   is_job_description = (>= 1 Class A apply affordance) AND (>= 2 Class B signals)
 *
 * Class A — an apply affordance is present: an apply button/link (the
 * applyButtons sweep is non-empty or a general button label matches the apply
 * pattern), OR a CV-upload / email+message application form (summary.hasApplicationForm)
 * for small-company pages that have no explicit Apply button.
 * Class B — section/benefit headings, a salary pattern OR textual salary mention,
 * an employment-type token, a worksite token, or an experience marker (each counts once).
 *
 * @param {PageSummary} summary - The parsed page summary
 * @returns {JobPageVerdict} The verdict plus the signals that drove it
 */
export function isJobDescriptionPage(summary: PageSummary): JobPageVerdict {
  const applyAffordancePresent =
    summary.applyButtons.length > 0 ||
    summary.buttons.some((label) => APPLY_AFFORDANCE_REGEX.test(label)) ||
    summary.hasApplicationForm;

  const classBSignals: string[] = [];
  const hasSectionHeading = summary.headings.some((heading) => SECTION_HEADING_REGEX.test(heading));
  if (hasSectionHeading) classBSignals.push("Job sections");
  const hasSalarySignal = summary.salaryMatches.length > 0 || SALARY_TEXT_REGEX.test(summary.mainText);
  if (hasSalarySignal) classBSignals.push("Salary");
  if (summary.employmentTypes.length > 0) classBSignals.push("Employment type");
  if (summary.worksite.length > 0) classBSignals.push("Worksite");
  if (summary.experienceMarkers.length > 0) classBSignals.push("Experience markers");

  const isJobDescription = applyAffordancePresent && classBSignals.length >= 2;
  return { isJobDescription, applyAffordancePresent, classBSignals };
}

/**
 * Returns the first absolute http(s) apply-button href from the summary, or
 * null when no apply button has a usable URL. The host resolver compares this
 * hostname to the original URL's to detect off-platform redirects.
 *
 * @param {PageSummary} summary - The parsed page summary
 * @returns {string | null} The first absolute http(s) apply-button href, or null
 */
export function firstApplyButtonHref(summary: PageSummary): string | null {
  for (const button of summary.applyButtons) {
    const href = button.href;
    const isHttp = href.startsWith("http://") || href.startsWith("https://");
    if (isHttp) return href;
  }
  return null;
}

/**
 * The short structured fields the Haiku call extracts. Mirrors the subset of
 * AnalyzeResult that is LLM-derived. salary/post_date are null when blank;
 * work_arrangement stays a raw (possibly empty) string the host normalizes.
 */
export interface ExtractedJobFields {
  title: string;
  company: string;
  salary: string | null;
  post_date: string | null;
  work_arrangement: string;
  location: string;
}

/** Fields used when extraction is skipped (non-posting) or the Haiku call fails. */
const EMPTY_FIELDS: ExtractedJobFields = {
  title: "",
  company: "",
  salary: null,
  post_date: null,
  work_arrangement: "",
  location: "",
};

/**
 * Normalizes the raw tool-call input from the Haiku extraction into
 * {@link ExtractedJobFields}. Blank salary/post_date strings collapse to null
 * so the host doesn't have to second-guess "" vs missing-value semantics;
 * work_arrangement stays a trimmed raw string (the host validates it against
 * the WorkArrangement enum). Tolerant of malformed input (returns empty fields).
 *
 * @param {unknown} input - The `report_job_fields` tool_use.input from Haiku
 * @returns {ExtractedJobFields} The normalized fields
 */
export function parseHaikuFields(input: unknown): ExtractedJobFields {
  const isObject = typeof input === "object" && input !== null;
  if (!isObject) {
    return { ...EMPTY_FIELDS };
  }
  const obj = input as Record<string, unknown>;
  const asTrimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const salary = asTrimmed(obj.salary);
  const postDate = asTrimmed(obj.post_date);
  return {
    title: asTrimmed(obj.title),
    company: asTrimmed(obj.company),
    salary: salary.length > 0 ? salary : null,
    post_date: postDate.length > 0 ? postDate : null,
    work_arrangement: asTrimmed(obj.work_arrangement),
    location: asTrimmed(obj.location),
  };
}

/** System prompt for the one-shot extraction call. */
const EXTRACT_SYSTEM_PROMPT = `You are given a heuristic summary of a job-description web page (headings, salary/employment/worksite/experience tokens, and the main page text). Extract the structured job details and report them via the report_job_fields tool. Use only what the page actually states; do not invent values.

  - title: The job title as displayed (e.g. "Software Engineer", "Senior Product Designer"). Strip company suffixes like " at Acme" or " | LinkedIn" — just the role. Empty string if you cannot find it.
  - company: The hiring company's name only (e.g. "Acme Corp"). Empty string if not identifiable.
  - salary: The displayed salary or compensation range exactly as shown (e.g. "$160,000–$250,000/yr", "£60k–£80k"). Empty string if not listed.
  - post_date: The post date string as displayed (e.g. "2 hours ago", "March 1, 2026", "Posted 3 days ago"). Empty string if not visible.
  - work_arrangement: The job's worksite arrangement as exactly one of these three lowercase tokens: "remote", "on_site", or "hybrid". Empty string ("") if the page gives no usable signal. Infer it from the worksite tokens AND the description prose (e.g. "fully distributed" / "work from anywhere" → "remote"; "in our New York office 5 days a week" → "on_site"; "2 days in office, 3 remote" → "hybrid"). Map "On-site" / "On site" / "In-person" / "In office" → "on_site"; "Remote" → "remote"; "Hybrid" → "hybrid".
  - location: The job's location as displayed (e.g. "Remote", "San Francisco, CA", "London, UK"). Empty string if the page doesn't state one.

Always call report_job_fields exactly once.`;

/** The single tool the extraction call is forced to use. */
const EXTRACT_FIELDS_TOOL: Anthropic.Messages.Tool = {
  name: "report_job_fields",
  description: "Report the structured job fields extracted from the page summary.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "The job title only (strip company suffixes). Empty string if unknown." },
      company: { type: "string", description: "The hiring company name only. Empty string if unknown." },
      salary: { type: "string", description: "The displayed salary range exactly as shown, or empty string if not listed." },
      post_date: { type: "string", description: "The displayed post date string (e.g. '2 hours ago'), or empty string if not visible." },
      work_arrangement: { type: "string", description: "Exactly one of 'remote', 'on_site', or 'hybrid' (lowercase), or empty string if unclear." },
      location: { type: "string", description: "The job's location exactly as shown (e.g. 'Remote', 'San Francisco, CA', 'London, UK'). Empty string if not stated." },
    },
    required: ["title", "company", "salary", "post_date", "work_arrangement", "location"],
  },
};

/**
 * Builds the user-message text for the extraction call from the page summary.
 * Surfaces the heuristic tokens up front (so Haiku doesn't have to re-derive
 * them) followed by the capped main text.
 *
 * @param {PageSummary} summary - The parsed page summary
 * @returns {string} The prompt body
 */
export function buildExtractionPrompt(summary: PageSummary): string {
  const orNone = (values: string[]): string => (values.length > 0 ? values.join(", ") : "(none)");
  const lines = [
    `Page title: ${summary.title}`,
    `URL: ${summary.url}`,
    `Headings: ${orNone(summary.headings.slice(0, 15))}`,
    `Salary regex matches: ${orNone(summary.salaryMatches)}`,
    `Employment-type tokens: ${orNone(summary.employmentTypes)}`,
    `Worksite tokens: ${orNone(summary.worksite)}`,
    `Experience markers: ${orNone(summary.experienceMarkers)}`,
    "",
    "Main page text (truncated):",
    summary.mainText.slice(0, EXTRACTION_MAIN_TEXT_CAP),
  ];
  return lines.join("\n");
}

/**
 * Reads the API key from the env var, throwing a clear error if it's missing.
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
 * Makes the single Haiku extraction call for a page that passed the heuristic
 * gate. Best-effort: any failure (missing key, transport error, no tool_use in
 * the response) is logged and degrades to empty fields rather than failing the
 * whole /analyze — the heuristic verdict + deterministic description/apply URL
 * are still returned.
 *
 * @param {PageSummary} summary - The (post-expand) page summary to extract from
 * @returns {Promise<ExtractedJobFields>} The extracted fields, or empty fields on any failure
 */
async function extractFieldsWithHaiku(summary: PageSummary): Promise<ExtractedJobFields> {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: MAX_EXTRACT_TOKENS,
      system: EXTRACT_SYSTEM_PROMPT,
      tools: [EXTRACT_FIELDS_TOOL],
      tool_choice: { type: "tool", name: "report_job_fields" },
      messages: [{ role: "user", content: buildExtractionPrompt(summary) }],
    });
    const toolUse = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use"
    );
    if (toolUse === undefined) {
      console.warn(`[analyze] Haiku returned no tool_use block (stop_reason: ${String(response.stop_reason)}); using empty fields`);
      return { ...EMPTY_FIELDS };
    }
    return parseHaikuFields(toolUse.input);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[analyze] Haiku field extraction failed: ${errorMessage}`);
    return { ...EMPTY_FIELDS };
  }
}

/**
 * Deterministic title fallback used when the page passed the gate but Haiku
 * returned an empty title (or was unavailable). Prefers the first non-empty
 * heading (the H1 is almost always the job title on a posting); returns "" when
 * there are no headings. Keeps a clearly-titled page (e.g. an H1 "Senior React
 * Engineer") from being reported with a blank title, which would break the
 * resolver's title-match step downstream.
 *
 * @param {PageSummary} summary - The parsed page summary
 * @returns {string} The first heading, trimmed, or "" when none exists
 */
export function deriveFallbackTitle(summary: PageSummary): string {
  const firstHeading = summary.headings.find((heading) => heading.trim().length > 0);
  return firstHeading !== undefined ? firstHeading.trim() : "";
}

/**
 * Opens a URL and produces the AnalyzeResult using deterministic heuristics
 * plus (only when the page looks like a posting) a single Haiku extraction
 * call. Replaces the previous Claude tool-calling agent loop.
 *
 * @param {Page} page - A Playwright page (caller manages browser/context lifecycle)
 * @param {string} url - The URL to analyze
 * @returns {Promise<AnalyzeResult>} The heuristic verdict + extracted fields + screenshot
 */
export async function analyzeUrl(page: Page, url: string): Promise<AnalyzeResult> {
  await page.goto(url, { waitUntil: "load", timeout: PAGE_NAV_TIMEOUT_MS });
  await page.evaluate(DISMISS_HELPER_SCRIPT);

  let summary = parsePageSummary(String(await page.evaluate(SUMMARY_HELPER_SCRIPT)));
  const verdict = isJobDescriptionPage(summary);

  let fields: ExtractedJobFields = { ...EMPTY_FIELDS };
  if (verdict.isJobDescription) {
    // Expand collapsed "Show more" sections, then re-summarize so the
    // description text + signals reflect the fully-expanded page.
    await page.evaluate(EXPAND_HELPER_SCRIPT);
    summary = parsePageSummary(String(await page.evaluate(SUMMARY_HELPER_SCRIPT)));
    fields = await extractFieldsWithHaiku(summary);
  }

  const screenshotB64 = (await captureCleanedScreenshot(page)).toString("base64");

  // For a real posting, never report a blank title when the page clearly has
  // one — fall back to the H1 if Haiku didn't return a title.
  const resolvedTitle = fields.title.length > 0
    ? fields.title
    : (verdict.isJobDescription ? deriveFallbackTitle(summary) : "");

  const reasoning = verdict.isJobDescription
    ? `Heuristic gate passed (apply affordance + ${String(verdict.classBSignals.length)} description signal(s): ${verdict.classBSignals.join(", ")}); extracted fields via Haiku.`
    : `Heuristic gate failed (apply affordance: ${String(verdict.applyAffordancePresent)}; description signals: ${verdict.classBSignals.join(", ") || "none"}). Page does not look like a job posting.`;

  return {
    is_job_description: verdict.isJobDescription,
    apply_button_present: verdict.applyAffordancePresent,
    description_signals: verdict.classBSignals,
    reasoning,
    screenshot_b64: screenshotB64,
    title: resolvedTitle,
    company: fields.company,
    // Persist the captured body text only for real postings — junk pages would
    // otherwise leak nav/login text into the description column.
    description: verdict.isJobDescription ? summary.mainText : "",
    salary: fields.salary,
    post_date: fields.post_date,
    work_arrangement: fields.work_arrangement,
    location: fields.location,
    apply_button_url: firstApplyButtonHref(summary),
    page_title: summary.title,
  };
}
