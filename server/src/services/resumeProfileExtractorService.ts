/**
 * Claude-powered resume→profile field extractor. Takes a resume PDF and returns
 * the person's identity, contact details, and profile links so the client can
 * pre-fill an application profile form. Mirrors jobDiscoveryExtractorService:
 * forced tool-use into a Zod-validated schema, a prompt-cached system prompt,
 * and Haiku 4.5 for speed/cost.
 *
 * Cost considerations:
 *   - The system prompt is identical across every call → prompt-cached via
 *     `cache_control: { type: "ephemeral" }` so per-resume cost is roughly the
 *     variable PDF document portion.
 *   - Model is `claude-haiku-4-5`; the forced tool-use schema + Zod validation
 *     gate the structure so a higher-tier model is unnecessary.
 *
 * Prompt-injection posture: resume PDFs are untrusted user data. The system
 * prompt forbids invention; the Zod-validated response shape means even a
 * successful injection cannot produce a payload outside ResumeProfileFields.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * The Anthropic model used for extraction. Haiku 4.5 is the latest fastest
 * tier; the tool-use schema constrains the output so a more expensive model
 * is unnecessary for this structured-extraction task.
 */
const EXTRACTOR_MODEL = "claude-haiku-4-5-20251001";

/**
 * Per-request token cap. A profile field set is tiny, so this is a generous
 * ceiling that still puts a hard cost cap on each call.
 */
const EXTRACTOR_MAX_TOKENS = 1024;

/**
 * Tool name forced via `tool_choice` so Claude's only legal response is a
 * structured call into our schema.
 */
const RECORD_RESUME_PROFILE_FIELDS_TOOL_NAME = "record_resume_profile_fields";

/**
 * The structured profile fields extracted from a resume. Every field is
 * `string | null`: null whenever the value is not clearly present in the
 * resume. The github/linkedin/website fields are full https URLs when present.
 */
export interface ResumeProfileFields {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  github: string | null;
  linkedin: string | null;
  website: string | null;
}

/**
 * The literal system prompt sent on every extraction. Held verbatim so the
 * prompt-cache key is byte-stable across requests (any drift here invalidates
 * the cache and re-charges the input tokens).
 */
const EXTRACTOR_SYSTEM_PROMPT = [
  "You extract a person's identity, contact details, and profile links from a resume PDF. Return exactly the fields requested via the tool call.",
  "",
  "Rules:",
  "1. Extract the person's first name, middle name, last name, email address, and phone number from the resume.",
  "2. Extract the person's GitHub, LinkedIn, and personal website links when present.",
  "3. Return null for any field that is not clearly present in the resume. NEVER invent, guess, or infer a value that is not explicitly in the document.",
  "4. Normalize `github`, `linkedin`, and `website` to full https URLs ONLY when an explicit handle or URL is present in the resume (e.g. a GitHub handle \"jdoe\" → \"https://github.com/jdoe\", a LinkedIn handle \"in/jane-doe\" → \"https://www.linkedin.com/in/jane-doe\"). When there is no explicit handle or URL for a link field, return null — never fabricate one.",
  "5. `middleName` is null unless a middle name or middle initial is clearly written; do not split a single given name into first + middle.",
  "6. Return the result exactly via the tool call.",
].join("\n");

/**
 * Zod schema for the extractor response. The tool_use input is parsed through
 * this; any deviation produces a "malformed" error. All eight fields are
 * required keys whose value is a string or null.
 */
const ResumeProfileFieldsSchema = z.object({
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  github: z.string().nullable(),
  linkedin: z.string().nullable(),
  website: z.string().nullable(),
});

/**
 * Anthropic tool-use schema that constrains the extractor's output. The
 * `input_schema` mirrors {@link ResumeProfileFieldsSchema} structurally so the
 * model is steered toward the right shape before Zod validates it. Every field
 * is required and typed as `["string", "null"]`.
 */
export const RECORD_RESUME_PROFILE_FIELDS_TOOL: Anthropic.Messages.Tool = {
  name: RECORD_RESUME_PROFILE_FIELDS_TOOL_NAME,
  description: "Record the identity, contact, and profile-link fields extracted from this resume. Pass null for any field not clearly present in the resume.",
  input_schema: {
    type: "object",
    required: ["firstName", "middleName", "lastName", "email", "phone", "github", "linkedin", "website"],
    properties: {
      firstName: { type: ["string", "null"] },
      middleName: { type: ["string", "null"] },
      lastName: { type: ["string", "null"] },
      email: { type: ["string", "null"] },
      phone: { type: ["string", "null"] },
      github: { type: ["string", "null"] },
      linkedin: { type: ["string", "null"] },
      website: { type: ["string", "null"] },
    },
  },
};

/**
 * Returns the Anthropic API key from the host env, throwing a clear error
 * when missing so the caller can surface the failure verbatim. The host
 * stores the key as CLAUDE_API_KEY in .env (matches jobDiscoveryExtractorService).
 *
 * @returns {string} The configured API key
 * @throws {Error} If CLAUDE_API_KEY is not set in the environment
 */
function getClaudeApiKey(): string {
  const apiKey = process.env["CLAUDE_API_KEY"];
  const isMissingKey = apiKey === undefined || apiKey.length === 0;
  if (isMissingKey) {
    throw new Error("CLAUDE_API_KEY env var is not set. Add it to .env to enable resume profile extraction.");
  }
  return apiKey;
}

/**
 * Builds the `system` parameter for the Anthropic call. We use the
 * array-of-TextBlockParam form so we can attach `cache_control` to the system
 * prompt and reuse the prefix across the many calls.
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
 * Locates the tool_use block produced by `record_resume_profile_fields` in a
 * Claude response. Returns undefined when no such block exists (Claude
 * refused, or emitted only a text reply).
 *
 * @param {Anthropic.Messages.Message} response - The raw messages.create response
 * @returns {Anthropic.Messages.ToolUseBlock | undefined} The tool_use block, or undefined when missing
 */
function findToolUseBlock(
  response: Anthropic.Messages.Message
): Anthropic.Messages.ToolUseBlock | undefined {
  return response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === "tool_use" && block.name === RECORD_RESUME_PROFILE_FIELDS_TOOL_NAME
  );
}

/**
 * Runs the extractor against a single resume PDF. Sends the PDF to Claude as a
 * base64 `document` content block and returns the structured profile fields,
 * with null for any field not clearly present in the resume.
 *
 * @param {Buffer} pdfBuffer - The raw bytes of the resume PDF
 * @returns {Promise<ResumeProfileFields>} The extracted identity/contact/link fields
 * @throws {Error} When CLAUDE_API_KEY is not set (message contains "CLAUDE_API_KEY")
 * @throws {Error} When Claude returns no tool_use block, or the tool input fails schema validation (message contains "malformed")
 */
export async function extractProfileFromResume(pdfBuffer: Buffer): Promise<ResumeProfileFields> {
  const apiKey = getClaudeApiKey();
  const client = new Anthropic({ apiKey });
  const systemParam = buildExtractorSystemParam();

  const response = await client.messages.create({
    model: EXTRACTOR_MODEL,
    max_tokens: EXTRACTOR_MAX_TOKENS,
    system: systemParam,
    tools: [RECORD_RESUME_PROFILE_FIELDS_TOOL],
    tool_choice: { type: "tool", name: RECORD_RESUME_PROFILE_FIELDS_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBuffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: "Extract this person's identity, contact details, and profile links from the attached resume PDF, then record them via the record_resume_profile_fields tool. Return null for any field not clearly present.",
          },
        ],
      },
    ],
  });

  const toolUseBlock = findToolUseBlock(response);
  if (toolUseBlock === undefined) {
    throw new Error(`Claude returned malformed resume-extractor response: missing tool_use block (stop_reason: ${String(response.stop_reason)})`);
  }

  const parseResult = ResumeProfileFieldsSchema.safeParse(toolUseBlock.input);
  if (!parseResult.success) {
    const issueSummary = parseResult.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Claude returned malformed resume-extractor response: ${issueSummary}`);
  }

  return parseResult.data;
}
