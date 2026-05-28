import { describe, it, expect, vi, beforeEach } from "vitest";

import type { GmailMessageSummary } from "./inboxTypes.js";

// vi.hoisted lets us share the mock across the SDK constructor stub and the
// test bodies. We re-import the mock here, so any assertions can inspect the
// exact arguments Claude received.
const { anthropicCreateMock } = vi.hoisted(() => ({ anthropicCreateMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  // Real class so `new Anthropic(...)` calls in the SUT return an object whose
  // `messages.create` is our mock. (vi.fn-based constructor mocks don't reliably
  // surface their return value when the SUT uses the `new` operator.)
  class Anthropic {
    public messages = { create: anthropicCreateMock };
    public constructor(_opts?: { apiKey?: string }) {
      void _opts;
    }
  }
  return { default: Anthropic };
});

import { extractFromMessage } from "./jobDiscoveryExtractorService.js";

/**
 * Builds a GmailMessageSummary fixture with sensible defaults. Individual
 * tests override only the fields that matter for the case under test.
 *
 * @param {Partial<GmailMessageSummary>} overrides - Fields to override on the default fixture
 * @returns {GmailMessageSummary} A complete GmailMessageSummary
 */
function buildMessageFixture(overrides: Partial<GmailMessageSummary> = {}): GmailMessageSummary {
  const defaults: GmailMessageSummary = {
    messageId: "msg-1",
    threadId: "thread-1",
    fromName: "LinkedIn Jobs",
    fromAddress: "noreply@linkedin.com",
    subject: "New jobs for you",
    snippet: "Some snippet",
    receivedAt: new Date("2026-05-23T15:30:00Z"),
    bodyHtml: "<html><body>Default body</body></html>",
    bodyText: "Default body",
  };
  return { ...defaults, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["CLAUDE_API_KEY"] = "test-key";
});

describe("extractFromMessage", () => {
  it("returns every distinct posting from a digest email (multi-job)", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "record_extracted_jobs",
          input: {
            jobs: [
              {
                title: "Senior Engineer",
                company: "Acme",
                jobUrl: "https://acme.example.com/jobs/1",
                location: "Remote",
                workArrangement: "remote",
                salary: null,
                description: null,
                confidence: 0.9,
              },
              {
                title: "Staff Engineer",
                company: "Globex",
                jobUrl: "https://globex.example.com/jobs/2",
                location: null,
                workArrangement: null,
                salary: "$200k",
                description: "Build distributed systems",
                confidence: 0.85,
              },
              {
                title: "Engineering Manager",
                company: "Initech",
                jobUrl: "https://initech.example.com/jobs/3",
                location: "NYC",
                workArrangement: "on_site",
                salary: null,
                description: null,
                confidence: 0.7,
              },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    });

    const result = await extractFromMessage(buildMessageFixture({
      subject: "3 new jobs in your area",
      bodyHtml: "<html>three jobs listed</html>",
    }));

    expect(result.extractor).toBe("claude-haiku-4-5");
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]?.company).toBe("Acme");
    expect(result.jobs[1]?.company).toBe("Globex");
    expect(result.jobs[2]?.company).toBe("Initech");
  });

  it("returns the single posting from a single-job email", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "record_extracted_jobs",
          input: {
            jobs: [
              {
                title: "Frontend Engineer",
                company: "Acme",
                jobUrl: "https://acme.example.com/jobs/77",
                location: "Remote",
                workArrangement: "remote",
                salary: null,
                description: null,
                confidence: 0.95,
              },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    });

    const result = await extractFromMessage(buildMessageFixture({
      subject: "Frontend Engineer role at Acme",
    }));

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.title).toBe("Frontend Engineer");
  });

  it("carries a valid workArrangement through to the parsed ExtractedJob", async () => {
    // When Claude classifies the role as remote, the Zod-validated tool_use
    // input passes the enum value straight onto the parsed ExtractedJob.
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "record_extracted_jobs",
          input: {
            jobs: [
              {
                title: "Backend Engineer",
                company: "Acme",
                jobUrl: "https://acme.example.com/jobs/88",
                location: "Remote",
                workArrangement: "remote",
                salary: null,
                description: null,
                confidence: 0.92,
              },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    });

    const result = await extractFromMessage(buildMessageFixture());

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.workArrangement).toBe("remote");
  });

  it("carries a null workArrangement through when the email gives no usable signal", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "record_extracted_jobs",
          input: {
            jobs: [
              {
                title: "Backend Engineer",
                company: "Acme",
                jobUrl: "https://acme.example.com/jobs/89",
                location: null,
                workArrangement: null,
                salary: null,
                description: null,
                confidence: 0.6,
              },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    });

    const result = await extractFromMessage(buildMessageFixture());

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.workArrangement).toBeNull();
  });

  it("returns an empty jobs array when the email is not actually about openings", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "record_extracted_jobs",
          input: { jobs: [] },
        },
      ],
      stop_reason: "tool_use",
    });

    const result = await extractFromMessage(buildMessageFixture({
      subject: "Industry newsletter: weekly hiring trends",
    }));

    expect(result.extractor).toBe("claude-haiku-4-5");
    expect(result.jobs).toEqual([]);
  });

  it("does NOT call Claude when both bodyHtml and bodyText are empty/null", async () => {
    const result = await extractFromMessage(buildMessageFixture({
      bodyHtml: null,
      bodyText: null,
    }));

    expect(result.jobs).toEqual([]);
    expect(result.extractor).toBe("claude-haiku-4-5");
    expect(anthropicCreateMock).not.toHaveBeenCalled();
  });

  it("truncates an oversized bodyHtml to 30,000 characters before sending", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "record_extracted_jobs",
          input: { jobs: [] },
        },
      ],
      stop_reason: "tool_use",
    });

    // Use a sentinel character ('Q') that won't appear in the metadata block
    // (ISO dates have 'T' and 'Z'; ASCII alphanumeric labels and common email
    // chars don't include 'Q') so we can isolate how many body characters
    // survived truncation.
    const oversizedHtml = "Q".repeat(50000);
    await extractFromMessage(buildMessageFixture({
      fromName: "Jobs",
      fromAddress: "noreply@linkedin.com",
      subject: "new jobs for you",
      bodyHtml: oversizedHtml,
      bodyText: null, // ensure HTML path is exercised
    }));

    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
    const callArgs = anthropicCreateMock.mock.calls[0]?.[0] as { messages: Array<{ content: string }> };
    const userContent = callArgs.messages[0]?.content ?? "";
    // Body portion is the sequence of 'Q' characters; metadata has none.
    const qCount = (userContent.match(/Q/g) ?? []).length;
    expect(qCount).toBe(30000);
    // And confirm the full 50k was NOT sent.
    expect(userContent.length).toBeLessThan(50000);
  });

  it("throws a malformed-response error when a job is missing jobUrl", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "record_extracted_jobs",
          input: {
            jobs: [
              {
                title: "Frontend Engineer",
                company: "Acme",
                // jobUrl intentionally omitted
                location: null,
                workArrangement: null,
                salary: null,
                description: null,
                confidence: 0.9,
              },
            ],
          },
        },
      ],
      stop_reason: "tool_use",
    });

    await expect(extractFromMessage(buildMessageFixture())).rejects.toThrow(/malformed/i);
  });

  it("throws a malformed-response error when Claude returns only text (no tool_use)", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "Sorry, I cannot do that." }],
      stop_reason: "end_turn",
    });

    await expect(extractFromMessage(buildMessageFixture())).rejects.toThrow(/malformed/i);
  });

  it("falls back to plaintext body when only bodyText is present (no HTML)", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        { type: "tool_use", name: "record_extracted_jobs", input: { jobs: [] } },
      ],
      stop_reason: "tool_use",
    });

    await extractFromMessage(buildMessageFixture({
      bodyHtml: null,
      bodyText: "PLAINTEXT-ONLY-EMAIL-BODY",
    }));

    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
    const callArgs = anthropicCreateMock.mock.calls[0]?.[0] as { messages: { content: string }[] };
    const userContent = callArgs.messages[0]?.content ?? "";
    expect(userContent).toContain("PLAINTEXT-ONLY-EMAIL-BODY");
  });

  it("uses truncated plaintext when bodyHtml is oversized AND bodyText is present", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        { type: "tool_use", name: "record_extracted_jobs", input: { jobs: [] } },
      ],
      stop_reason: "tool_use",
    });

    const oversizedHtml = "H".repeat(50000);
    const plaintext = "Y".repeat(40000);
    await extractFromMessage(buildMessageFixture({
      fromName: "Jobs",
      fromAddress: "noreply@linkedin.com",
      subject: "new jobs for you",
      bodyHtml: oversizedHtml,
      bodyText: plaintext,
    }));

    const callArgs = anthropicCreateMock.mock.calls[0]?.[0] as { messages: { content: string }[] };
    const userContent = callArgs.messages[0]?.content ?? "";
    // Plaintext path was chosen — 30,000 Y characters present means the
    // plaintext body was sent (truncated to MAX_BODY_CHARS). Y is absent
    // from the metadata block (no ISO 'T'/'Z', no labels containing it).
    // (Not asserting H-absence: the metadata template's "HTML" label has H's
    // and would skew that count regardless of which body was chosen.)
    const yCount = (userContent.match(/Y/g) ?? []).length;
    expect(yCount).toBe(30000);
  });

  it("throws a clear error when CLAUDE_API_KEY is not set", async () => {
    delete process.env["CLAUDE_API_KEY"];
    await expect(extractFromMessage(buildMessageFixture())).rejects.toThrow(/CLAUDE_API_KEY/);
  });

  it("sends the system prompt with cache_control: ephemeral attached", async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "record_extracted_jobs",
          input: { jobs: [] },
        },
      ],
      stop_reason: "tool_use",
    });

    await extractFromMessage(buildMessageFixture());

    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
    const callArgs = anthropicCreateMock.mock.calls[0]?.[0] as {
      system: Array<{ type: string; text: string; cache_control?: { type: string } }>;
    };
    expect(Array.isArray(callArgs.system)).toBe(true);
    const systemBlock = callArgs.system[0];
    expect(systemBlock?.type).toBe("text");
    expect(systemBlock?.cache_control).toEqual({ type: "ephemeral" });
    expect(systemBlock?.text).toContain("You extract job postings from emails");
  });
});
