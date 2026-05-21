/**
 * Service module that asks Claude to classify each Brave search result as one
 * of three kinds: a direct posting for the target job ("direct_job_listing"),
 * a hub page that may link to it ("careers_page"), or unrelated noise
 * ("irrelevant").
 *
 * The classifier is the ONLY AI-driven step in the resolver pipeline. It does
 * not rank, sort, drop, or rewrite anything — its output is a pure mapping
 * from `index → label`. All ordering decisions are made by code in
 * applicationUrlResolverService.ts + fuzzyMatchService.ts, which keeps the
 * resolver's behavior reproducible and inspectable.
 *
 * The model is invoked via Anthropic tool-use with a JSON-schema-constrained
 * output shape so we can validate every response: the array length must equal
 * the input length, each input index must appear exactly once, and each label
 * must be one of the three allowed values. Any violation raises a typed
 * PageClassifierProtocolError, which the resolver translates into a graceful
 * not_found rather than crashing the request.
 *
 * Description handling: the target description IS passed to the LLM as
 * semantic context so it can recognize the role, but the prompt is explicit
 * that description text must NOT broaden the bar for the
 * direct_job_listing label. The job description is never used as a search
 * input — that responsibility lives in
 * applicationUrlResolverService.buildSearchQuery, which uses only company +
 * title.
 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * The Anthropic model used for classification. Sonnet 4.6 is the same model
 * the container's analyze agent uses (docker/managed-container/agent.ts), so
 * we get the same quality / latency profile here without introducing a new
 * model dependency.
 */
const CLASSIFIER_MODEL = "claude-sonnet-4-6";

/**
 * Per-request token cap. Classification responses are tiny (one entry per
 * input index, each with a small JSON shape) — 1024 is generous and bounds
 * the worst-case cost.
 */
const CLASSIFIER_MAX_TOKENS = 1024;

/**
 * The three classification labels the resolver pipeline understands. Mirrors
 * the enum in the JSON Schema below. Exported so tests can assert on the
 * exact string values that flow through traces.
 */
export type PageClassification = "direct_job_listing" | "careers_page" | "irrelevant";

/**
 * One row in the classifier's input list. The `index` field is the
 * caller-assigned identifier the classifier MUST echo back so the resolver
 * can map labels back to the original Brave result.
 */
export interface BraveCandidateInput {
  index: number;
  title: string;
  snippet: string;
  url: string;
}

/**
 * Inputs to {@link classifyPages}. The classifier receives the target role
 * context (so it can recognize the role) and the list of candidates to label.
 * The classifier never re-fetches any URL — it works purely from the
 * supplied tuples.
 */
export interface PageClassifierInput {
  targetTitle: string;
  targetCompany: string;
  /** Used by the LLM only to recognize the role; never used to widen labelling. */
  targetDescription: string;
  candidates: BraveCandidateInput[];
}

/**
 * One row of the classifier's output. The `index` field matches one of the
 * input candidates' `index` values; the `classification` is the label
 * assigned to that candidate.
 */
export interface ClassifiedCandidate {
  index: number;
  classification: PageClassification;
}

/**
 * Result of a {@link classifyPages} call. The `classifications` array has
 * exactly one entry per input candidate, with every input index appearing
 * exactly once and each `classification` being one of the three allowed
 * values. Any LLM response that violates these constraints triggers a
 * {@link PageClassifierProtocolError} instead of being returned.
 */
export interface PageClassifierResult {
  classifications: ClassifiedCandidate[];
}

/**
 * Anthropic tool-use schema that constrains the classifier's output to a
 * machine-checkable shape. Exported so tests can snapshot it and so the
 * resolver can be sure exactly what the LLM is being asked to produce.
 */
export const CLASSIFY_PAGES_TOOL_SCHEMA: Anthropic.Messages.Tool = {
  name: "classify_pages",
  description: "Return a classification label per search result. The output array must contain exactly one entry per input candidate; the order of entries does not matter, but every input index must appear exactly once.",
  input_schema: {
    type: "object",
    required: ["classifications"],
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          required: ["index", "classification"],
          properties: {
            index: { type: "integer", minimum: 0 },
            classification: {
              type: "string",
              enum: ["direct_job_listing", "careers_page", "irrelevant"],
            },
          },
        },
      },
    },
  },
};

/**
 * Thrown when the LLM's tool-use output cannot be validated against the
 * schema or the per-call invariants (length match, no duplicate indices, no
 * missing indices, no unknown labels). The resolver catches this and lands
 * the attempt on outcome=not_found rather than propagating a stack trace —
 * the failure is loud-in-logs but not fatal to the request.
 */
export class PageClassifierProtocolError extends Error {
  /**
   * Constructs a PageClassifierProtocolError. The message is suitable for
   * direct inclusion in a resolution-log `reason` field.
   *
   * @param {string} message - The reason validation failed
   */
  public constructor(message: string) {
    super(message);
    this.name = "PageClassifierProtocolError";
  }
}

/**
 * Returns the Anthropic API key from the host env, throwing a clear error
 * when missing so the resolver can surface the failure verbatim. The host
 * stores the key as CLAUDE_API_KEY in .env (see
 * server/src/services/dockerContainerService.ts for the matching reference).
 *
 * @returns {string} The configured API key
 * @throws {Error} If CLAUDE_API_KEY is not set in the environment
 */
function getClaudeApiKey(): string {
  const apiKey = process.env["CLAUDE_API_KEY"];
  const isMissingKey = apiKey === undefined || apiKey.length === 0;
  if (isMissingKey) {
    throw new Error("CLAUDE_API_KEY env var is not set. Add it to .env to enable AI page classification.");
  }
  return apiKey;
}

/**
 * Returns the system prompt sent to the classifier. Held as a function so the
 * exact text can be snapshot-tested without exposing a stringly-typed module
 * constant that callers might accidentally mutate. The prompt must include
 * the literal "Use this description only to understand the role for
 * recognition" sentence so the snapshot test can assert it.
 *
 * @returns {string} The system prompt
 */
export function buildClassifierSystemPrompt(): string {
  return [
    "You are classifying search results to help a job application tool find the canonical application page for a specific job opening.",
    "",
    "For each search result you receive, choose exactly one of these labels:",
    "  - direct_job_listing: a page that IS this specific opening at this company, where a candidate can read full details and apply.",
    "  - careers_page: a hub page that LISTS multiple openings at this company (an index, search, or department page) which may itself contain a link to this specific opening.",
    "  - irrelevant: anything else — third-party aggregator copies, news articles, reviews, unrelated companies, expired postings, different roles.",
    "",
    "Use this description only to understand the role for recognition. Do not use it to broaden what you label as direct_job_listing.",
    "",
    "You MUST return one entry per input candidate. Every input index must appear in your output exactly once.",
  ].join("\n");
}

/**
 * Returns the user-role message body. The TARGET JOB block carries the
 * title/company/description (the latter being marked "for match confirmation
 * only" so the model treats it as recognition context, not a relaxation of
 * the labelling bar). The SEARCH RESULTS block lists the Brave tuples to
 * classify. Exported solely so tests can snapshot the rendered output.
 *
 * @param {PageClassifierInput} input - The classifier input
 * @returns {string} The rendered user message body
 */
export function buildClassifierUserMessage(input: PageClassifierInput): string {
  const targetSection = [
    "TARGET JOB",
    `  Title:       ${input.targetTitle}`,
    `  Company:     ${input.targetCompany}`,
    "  Description (FOR MATCH CONFIRMATION ONLY, DO NOT USE TO BROADEN LABELS):",
    indentLines(input.targetDescription, "    "),
  ].join("\n");
  const renderedCandidates = input.candidates.map((candidate) => {
    return [
      `  [${String(candidate.index)}]`,
      `    Title:   ${candidate.title}`,
      `    URL:     ${candidate.url}`,
      `    Snippet: ${candidate.snippet}`,
    ].join("\n");
  }).join("\n");
  const candidatesSection = [
    "SEARCH RESULTS",
    renderedCandidates,
  ].join("\n");
  return [
    targetSection,
    "",
    candidatesSection,
    "",
    "Call the classify_pages tool exactly once with one classification entry per result above.",
  ].join("\n");
}

/**
 * Indents every line of `text` by `prefix`. Used by buildClassifierUserMessage
 * to render the description block under the TARGET JOB header.
 *
 * @param {string} text - The raw text (may contain newlines)
 * @param {string} prefix - The string prepended to each line
 * @returns {string} The indented text
 */
function indentLines(text: string, prefix: string): string {
  const lines = text.split("\n");
  return lines.map((line) => `${prefix}${line}`).join("\n");
}

/**
 * Validates the LLM's tool-use input against the per-call invariants. Throws
 * a {@link PageClassifierProtocolError} on the first violation; returns a
 * normalized {@link PageClassifierResult} otherwise.
 *
 * Validates:
 *   - The input value is an object with a `classifications` array.
 *   - The array length equals the number of input candidates.
 *   - Every entry is an object with integer `index` and string `classification`.
 *   - Every input candidate's `index` appears in the output exactly once.
 *   - No unknown index appears in the output.
 *   - Every `classification` is one of the three allowed labels.
 *
 * @param {unknown} rawInput - The `.input` field from a Claude tool_use block
 * @param {number[]} expectedIndices - The list of input candidate indices (order not significant)
 * @returns {PageClassifierResult} The normalized classifications
 * @throws {PageClassifierProtocolError} If any invariant is violated
 */
function validateClassifierToolInput(rawInput: unknown, expectedIndices: number[]): PageClassifierResult {
  const isObject = typeof rawInput === "object" && rawInput !== null;
  if (!isObject) {
    throw new PageClassifierProtocolError("Classifier tool_use input is not an object");
  }
  const inputObj = rawInput as { classifications?: unknown };
  if (!Array.isArray(inputObj.classifications)) {
    throw new PageClassifierProtocolError("Classifier tool_use input is missing the 'classifications' array");
  }
  const rawClassifications = inputObj.classifications;
  if (rawClassifications.length !== expectedIndices.length) {
    throw new PageClassifierProtocolError(`Classifier returned ${String(rawClassifications.length)} entries but expected ${String(expectedIndices.length)}`);
  }
  const expectedIndexSet = new Set<number>(expectedIndices);
  const seenIndexSet = new Set<number>();
  const normalized: ClassifiedCandidate[] = [];
  for (const entry of rawClassifications) {
    const isEntryObject = typeof entry === "object" && entry !== null;
    if (!isEntryObject) {
      throw new PageClassifierProtocolError("Classifier returned a non-object entry");
    }
    const entryObj = entry as { index?: unknown; classification?: unknown };
    const rawIndex = entryObj.index;
    if (typeof rawIndex !== "number" || !Number.isInteger(rawIndex)) {
      throw new PageClassifierProtocolError(`Classifier entry has non-integer 'index': ${String(rawIndex)}`);
    }
    if (!expectedIndexSet.has(rawIndex)) {
      throw new PageClassifierProtocolError(`Classifier entry references unknown index: ${String(rawIndex)}`);
    }
    if (seenIndexSet.has(rawIndex)) {
      throw new PageClassifierProtocolError(`Classifier entry duplicates index: ${String(rawIndex)}`);
    }
    seenIndexSet.add(rawIndex);
    const rawClassification = entryObj.classification;
    const isAllowedClassification =
      rawClassification === "direct_job_listing" ||
      rawClassification === "careers_page" ||
      rawClassification === "irrelevant";
    if (!isAllowedClassification) {
      throw new PageClassifierProtocolError(`Classifier entry has unknown 'classification': ${String(rawClassification)}`);
    }
    normalized.push({ index: rawIndex, classification: rawClassification });
  }
  return { classifications: normalized };
}

/**
 * Classifies each candidate as direct_job_listing / careers_page /
 * irrelevant via one Anthropic tool-use call. Returns one entry per input
 * candidate, validated against the per-call invariants. Throws a
 * {@link PageClassifierProtocolError} on schema violations and a plain
 * Error on transport/API failures.
 *
 * When the candidate list is empty, returns an empty result without calling
 * the API (so the resolver doesn't burn tokens when Brave returned nothing).
 *
 * @param {PageClassifierInput} input - The target role context + candidate list
 * @returns {Promise<PageClassifierResult>} One label per input candidate
 * @throws {PageClassifierProtocolError} If the LLM's response violates the schema or invariants
 * @throws {Error} If CLAUDE_API_KEY is missing or the Anthropic API call fails
 */
export async function classifyPages(input: PageClassifierInput): Promise<PageClassifierResult> {
  if (input.candidates.length === 0) {
    return { classifications: [] };
  }
  const apiKey = getClaudeApiKey();
  const client = new Anthropic({ apiKey });
  const systemPrompt = buildClassifierSystemPrompt();
  const userMessage = buildClassifierUserMessage(input);

  const response = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: CLASSIFIER_MAX_TOKENS,
    system: systemPrompt,
    tools: [CLASSIFY_PAGES_TOOL_SCHEMA],
    tool_choice: { type: "tool", name: "classify_pages" },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use" && block.name === "classify_pages"
  );
  if (toolUseBlock === undefined) {
    throw new PageClassifierProtocolError(`Classifier did not invoke the classify_pages tool (stop_reason: ${String(response.stop_reason)})`);
  }

  const expectedIndices = input.candidates.map((candidate) => candidate.index);
  return validateClassifierToolInput(toolUseBlock.input, expectedIndices);
}
