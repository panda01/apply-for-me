/**
 * Claude-powered job-discovery extractor. Takes a Gmail message and returns
 * the list of job postings explicitly mentioned in the body (zero, one, or
 * many — digest emails commonly produce many). The extractor is the ONLY
 * place outside gmailMessageReaderService that touches Claude.
 *
 * Cost considerations baked into the implementation:
 *   - System prompt is identical across every call in a scan → prompt-cached
 *     via `cache_control: { type: "ephemeral" }` so per-message cost is
 *     roughly the variable user-data portion.
 *   - Model is `claude-haiku-4-5` for speed and cost; the tool-use schema +
 *     Zod validation gate structure so a higher-tier model is unnecessary.
 *
 * Prompt-injection posture: email bodies are untrusted user data. The system
 * prompt forbids invention; the Zod-validated response shape means even a
 * successful injection cannot produce a payload outside ExtractedJob.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { ExtractedJob, ExtractorResult, GmailMessageSummary } from "./inboxTypes.js";

/**
 * The Anthropic model used for extraction. Haiku 4.5 is the latest fastest
 * tier; the tool-use schema constrains the output so a more expensive model
 * is unnecessary for this routing-style task.
 */
const EXTRACTOR_MODEL = "claude-haiku-4-5-20251001";

/**
 * Identifier stored on the returned ExtractorResult so callers (the discovery
 * service, future per-extractor stats) know which strategy produced these
 * jobs. Intentionally the short model family name — the dated suffix is an
 * implementation detail.
 */
const EXTRACTOR_TAG = "claude-haiku-4-5";

/**
 * Per-request token cap. Even a digest with many postings comfortably fits
 * under this ceiling, and bounding it puts a hard cost cap on each call.
 */
const EXTRACTOR_MAX_TOKENS = 4096;

/**
 * Maximum number of characters of email body sent to Claude per message.
 * Beyond this, marketing emails tend to repeat content and the truncated
 * prefix already covers the openings header + first few postings.
 */
const MAX_BODY_CHARS = 30000;

/**
 * Tool name forced via `tool_choice` so Claude's only legal response is a
 * structured call into our schema.
 */
const EXTRACT_JOBS_TOOL_NAME = "record_extracted_jobs";

/**
 * The literal system prompt sent on every extraction. Held verbatim so the
 * prompt-cache key is byte-stable across requests (any drift here invalidates
 * the cache and re-charges the input tokens).
 */
const EXTRACTOR_SYSTEM_PROMPT = [
  "You extract job postings from emails. Given an email's headers and body, return every distinct job opening explicitly mentioned in the email.",
  "",
  "Rules:",
  "1. A single email can list zero, one, or many jobs. Each job is a separate object in the response — never merge two jobs into one.",
  "2. Return an empty list when the email is not actually about specific job openings (newsletters, industry articles, reply chains, generic recruiter pitches without a specific role, etc.).",
  "3. If the same posting is mentioned twice in the same email, return it once.",
  "4. Never invent fields. If `location`, `salary`, or `description` aren't explicitly in the email, return null for them.",
  "5. `jobUrl` MUST be an absolute http(s) URL pointing at the actual posting. Use the first such URL associated with the job — typically the \"View job\" or \"Apply\" link. If there's no URL for a job, skip that job entirely.",
  "6. `company` and `title` must be the company name and role title as written in the email. Don't normalize, abbreviate, or expand them.",
  "7. `confidence` is your 0..1 self-assessment of how certain you are this is a real, specific job opening (not e.g. a category page or a general inquiry).",
].join("\n");

/**
 * Zod schema for one extracted job. Mirrors the shared ExtractedJob interface
 * with the added runtime constraint that `jobUrl` is a valid URL and
 * `confidence` lies in [0, 1].
 */
const ExtractedJobSchema = z.object({
  title: z.string(),
  company: z.string(),
  jobUrl: z.string().url(),
  location: z.string().nullable(),
  salary: z.string().nullable(),
  description: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

/**
 * Zod schema for the full extractor response. The tool_use input is parsed
 * through this; any deviation produces a "malformed" error.
 */
// `jobs` defaults to [] when the model returns `{}` for a no-openings email —
// observed in practice: Claude sometimes invokes the tool with an empty input
// rather than the required `{ jobs: [] }`. Treating that as "no jobs found"
// matches the prompt's "return an empty list when the email is not about
// specific openings" instruction.
const ExtractorResponseSchema = z.object({
  jobs: z.array(ExtractedJobSchema).default([]),
});

/**
 * Anthropic tool-use schema that constrains the extractor's output. The
 * `input_schema` mirrors {@link ExtractorResponseSchema} structurally so the
 * model is steered toward the right shape before Zod validates it.
 */
const RECORD_EXTRACTED_JOBS_TOOL: Anthropic.Messages.Tool = {
  name: EXTRACT_JOBS_TOOL_NAME,
  description: "Record the list of distinct job openings extracted from this email. Pass an empty array when the email does not contain any specific job postings.",
  input_schema: {
    type: "object",
    required: ["jobs"],
    properties: {
      jobs: {
        type: "array",
        items: {
          type: "object",
          required: ["title", "company", "jobUrl", "location", "salary", "description", "confidence"],
          properties: {
            title: { type: "string" },
            company: { type: "string" },
            jobUrl: { type: "string" },
            location: { type: ["string", "null"] },
            salary: { type: ["string", "null"] },
            description: { type: ["string", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  },
};

/**
 * Returns the Anthropic API key from the host env, throwing a clear error
 * when missing so the caller can surface the failure verbatim. The host
 * stores the key as CLAUDE_API_KEY in .env (matches aiPageClassifierService).
 *
 * @returns {string} The configured API key
 * @throws {Error} If CLAUDE_API_KEY is not set in the environment
 */
function getClaudeApiKey(): string {
  const apiKey = process.env["CLAUDE_API_KEY"];
  const isMissingKey = apiKey === undefined || apiKey.length === 0;
  if (isMissingKey) {
    throw new Error("CLAUDE_API_KEY env var is not set. Add it to .env to enable inbox job discovery.");
  }
  return apiKey;
}

/**
 * Picks the best email body for extraction: HTML when present and short
 * enough, otherwise plaintext. Both branches truncate to MAX_BODY_CHARS so a
 * pathological 500KB marketing email can't blow the context window. Returns
 * null when both bodies are empty/missing, signalling the caller to skip the
 * Claude call entirely.
 *
 * @param {string | null} bodyHtml - The HTML body of the email (preferred)
 * @param {string | null} bodyText - The plaintext body of the email (fallback)
 * @returns {string | null} The chosen, truncated body content, or null when both are empty
 */
function chooseTruncatedBody(bodyHtml: string | null, bodyText: string | null): string | null {
  const hasHtml = typeof bodyHtml === "string" && bodyHtml.length > 0;
  if (hasHtml) {
    const htmlValue = bodyHtml as string;
    const isHtmlOversize = htmlValue.length > MAX_BODY_CHARS;
    if (!isHtmlOversize) {
      return htmlValue;
    }
    // HTML body too big: prefer plaintext (also truncated) when it exists,
    // otherwise fall back to the truncated HTML prefix.
    const hasTextFallback = typeof bodyText === "string" && bodyText.length > 0;
    if (hasTextFallback) {
      const textValue = bodyText as string;
      return textValue.slice(0, MAX_BODY_CHARS);
    }
    return htmlValue.slice(0, MAX_BODY_CHARS);
  }
  const hasText = typeof bodyText === "string" && bodyText.length > 0;
  if (hasText) {
    const textValue = bodyText as string;
    return textValue.slice(0, MAX_BODY_CHARS);
  }
  return null;
}

/**
 * Renders the user-role message body. The format intentionally puts the
 * structured metadata before the unstructured body so Claude has stable
 * anchors (From / Subject / Received) before reading attacker-controllable
 * content.
 *
 * @param {GmailMessageSummary} message - The Gmail message being extracted
 * @param {string} chosenBody - The truncated body chosen by chooseTruncatedBody
 * @returns {string} The fully rendered user message body
 */
export function buildExtractorUserMessage(message: GmailMessageSummary, chosenBody: string): string {
  const lines = [
    "Email metadata:",
    `- From: ${message.fromName} <${message.fromAddress}>`,
    `- Subject: ${message.subject}`,
    `- Received: ${message.receivedAt.toISOString()}`,
    "",
    "Email body (HTML preferred, plaintext fallback if no HTML):",
    chosenBody,
  ];
  return lines.join("\n");
}

/**
 * Builds the `system` parameter for the Anthropic call. We use the
 * array-of-TextBlockParam form so we can attach `cache_control` to the system
 * prompt and reuse the prefix across the many calls in one scan.
 *
 * @returns {Array<Anthropic.Messages.TextBlockParam>} The cached system prompt array
 */
export function buildExtractorSystemParam(): Array<Anthropic.Messages.TextBlockParam> {
  return [
    {
      type: "text",
      text: EXTRACTOR_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/**
 * Locates the tool_use block produced by `record_extracted_jobs` in a Claude
 * response. Returns undefined when no such block exists (Claude refused, or
 * emitted only a text reply).
 *
 * @param {Anthropic.Messages.Message} response - The raw messages.create response
 * @returns {Anthropic.Messages.ToolUseBlock | undefined} The tool_use block, or undefined when missing
 */
function findExtractorToolUseBlock(
  response: Anthropic.Messages.Message
): Anthropic.Messages.ToolUseBlock | undefined {
  return response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === "tool_use" && block.name === EXTRACT_JOBS_TOOL_NAME
  );
}

/**
 * Runs the extractor against a single Gmail message. Returns an empty
 * `jobs` array when the message matched the inbox keyword search but is not
 * actually about specific openings (newsletters, reply chains, industry
 * articles that mention "hiring" in passing, etc.).
 *
 * Behavior corners:
 *   - When both `bodyHtml` and `bodyText` are empty/null, the function
 *     returns an empty result WITHOUT calling Claude — there is nothing for
 *     the model to read.
 *   - When the chosen body is too long, it is truncated to MAX_BODY_CHARS
 *     characters before being sent.
 *
 * @param {GmailMessageSummary} message - The Gmail message to extract from
 * @returns {Promise<ExtractorResult>} The set of discovered jobs (possibly empty) plus an extractor tag
 * @throws {Error} When Claude returns a response that fails schema validation, or when the SDK errors
 */
export async function extractFromMessage(message: GmailMessageSummary): Promise<ExtractorResult> {
  const chosenBody = chooseTruncatedBody(message.bodyHtml, message.bodyText);
  const hasNoBody = chosenBody === null;
  if (hasNoBody) {
    return { extractor: EXTRACTOR_TAG, jobs: [] };
  }

  const apiKey = getClaudeApiKey();
  const client = new Anthropic({ apiKey });
  const systemParam = buildExtractorSystemParam();
  const userMessage = buildExtractorUserMessage(message, chosenBody);

  const response = await client.messages.create({
    model: EXTRACTOR_MODEL,
    max_tokens: EXTRACTOR_MAX_TOKENS,
    system: systemParam,
    tools: [RECORD_EXTRACTED_JOBS_TOOL],
    tool_choice: { type: "tool", name: EXTRACT_JOBS_TOOL_NAME },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUseBlock = findExtractorToolUseBlock(response);
  if (toolUseBlock === undefined) {
    throw new Error(`Claude returned malformed extractor response: missing tool_use block (stop_reason: ${String(response.stop_reason)})`);
  }

  const parseResult = ExtractorResponseSchema.safeParse(toolUseBlock.input);
  if (!parseResult.success) {
    const issueSummary = parseResult.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Claude returned malformed extractor response: ${issueSummary}`);
  }

  const parsedJobs: ExtractedJob[] = parseResult.data.jobs;
  return { extractor: EXTRACTOR_TAG, jobs: parsedJobs };
}
