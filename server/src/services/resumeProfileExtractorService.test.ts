import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted shares the create mock between the @anthropic-ai/sdk constructor
// stub and the test bodies, so assertions can inspect the exact arguments
// Claude received. Mirrors jobDiscoveryExtractorService.test.ts.
const { anthropicCreateMock } = vi.hoisted(() => ({ anthropicCreateMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  // Real class so `new Anthropic(...)` in the SUT returns an object whose
  // `messages.create` is our mock. (vi.fn-based constructor mocks don't
  // reliably surface their return value when the SUT uses the `new` operator.)
  class Anthropic {
    public messages = { create: anthropicCreateMock };
    public constructor(_opts?: { apiKey?: string }) {
      void _opts;
    }
  }
  return { default: Anthropic };
});

import { extractProfileFromResume } from "./resumeProfileExtractorService.js";

/** The forced tool name; Claude's only legal response is a call into this. */
const TOOL_NAME = "record_resume_profile_fields";

/** A fully-populated set of all eight extracted profile fields. */
const ALL_FIELDS = {
  firstName: "Jane",
  middleName: "Q",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "555-0100",
  github: "https://github.com/jdoe",
  linkedin: "https://www.linkedin.com/in/jane-doe",
  website: "https://jane.example.com",
};

/** All eight fields null — the "nothing clearly present" case. */
const ALL_NULL_FIELDS = {
  firstName: null,
  middleName: null,
  lastName: null,
  email: null,
  phone: null,
  github: null,
  linkedin: null,
  website: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env["CLAUDE_API_KEY"] = "test-key";
});

describe("extractProfileFromResume", () => {
  it("returns all eight fields when Claude records them via the tool", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: "tool_use", name: TOOL_NAME, input: ALL_FIELDS }],
      stop_reason: "tool_use",
    });

    const result = await extractProfileFromResume(Buffer.from("%PDF-1.4 resume"));

    expect(result).toEqual(ALL_FIELDS);
  });

  it("passes through an all-null field set", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: "tool_use", name: TOOL_NAME, input: ALL_NULL_FIELDS }],
      stop_reason: "tool_use",
    });

    const result = await extractProfileFromResume(Buffer.from("%PDF-1.4 resume"));

    expect(result).toEqual(ALL_NULL_FIELDS);
  });

  it("rejects with a malformed error when the response has only a text block", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "Sorry, I cannot do that." }],
      stop_reason: "end_turn",
    });

    await expect(extractProfileFromResume(Buffer.from("%PDF-1.4 resume"))).rejects.toThrow(
      /malformed/i
    );
  });

  it("rejects with a malformed error when a field has the wrong type (Zod failure)", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: TOOL_NAME,
          input: { ...ALL_FIELDS, email: 123 },
        },
      ],
      stop_reason: "tool_use",
    });

    await expect(extractProfileFromResume(Buffer.from("%PDF-1.4 resume"))).rejects.toThrow(
      /malformed/i
    );
  });

  it("rejects with a CLAUDE_API_KEY error when the key is not set", async () => {
    delete process.env["CLAUDE_API_KEY"];

    await expect(extractProfileFromResume(Buffer.from("%PDF-1.4 resume"))).rejects.toThrow(
      /CLAUDE_API_KEY/
    );
  });

  it("sends the PDF as a base64 document block, forces the tool, and caches the system prompt", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: "tool_use", name: TOOL_NAME, input: ALL_NULL_FIELDS }],
      stop_reason: "tool_use",
    });
    const pdfBuffer = Buffer.from("%PDF-1.4 resume bytes");

    await extractProfileFromResume(pdfBuffer);

    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
    const callArgs = anthropicCreateMock.mock.calls[0]?.[0] as {
      system: Array<{ type: string; text: string; cache_control?: { type: string } }>;
      tool_choice: { type: string; name: string };
      messages: Array<{
        role: string;
        content: Array<{
          type: string;
          source?: { type: string; media_type: string; data: string };
        }>;
      }>;
    };

    // document content block: base64 application/pdf carrying the buffer bytes.
    const documentBlock = callArgs.messages[0]?.content.find((block) => block.type === "document");
    expect(documentBlock?.source?.type).toBe("base64");
    expect(documentBlock?.source?.media_type).toBe("application/pdf");
    expect(documentBlock?.source?.data).toBe(pdfBuffer.toString("base64"));

    // tool_choice forces the record_resume_profile_fields tool.
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: TOOL_NAME });

    // system param is the array form with cache_control: ephemeral attached.
    expect(Array.isArray(callArgs.system)).toBe(true);
    const systemBlock = callArgs.system[0];
    expect(systemBlock?.type).toBe("text");
    expect(systemBlock?.cache_control).toEqual({ type: "ephemeral" });
  });
});
