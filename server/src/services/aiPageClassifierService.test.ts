import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  // Real class so `new Anthropic(...)` invocations work — vi.fn-based
  // constructor mocks don't reliably surface their return value to callers
  // when the SUT uses the `new` operator.
  class Anthropic {
    public messages = { create: messagesCreate };
    constructor(_opts?: { apiKey?: string }) {
      void _opts;
    }
  }
  return { default: Anthropic };
});

import {
  buildClassifierSystemPrompt,
  buildClassifierUserMessage,
  classifyPages,
  PageClassifierProtocolError,
  CLASSIFY_PAGES_TOOL_SCHEMA,
} from "./aiPageClassifierService.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env["CLAUDE_API_KEY"] = "test-key";
});

describe("buildClassifierSystemPrompt", () => {
  it("includes the three labels and the description-as-context sentence", () => {
    const prompt = buildClassifierSystemPrompt();
    expect(prompt).toContain("direct_job_listing");
    expect(prompt).toContain("careers_page");
    expect(prompt).toContain("irrelevant");
    expect(prompt).toContain("Use this description only to understand the role for recognition");
  });
});

describe("buildClassifierUserMessage", () => {
  it("renders the TARGET JOB and SEARCH RESULTS sections", () => {
    const result = buildClassifierUserMessage({
      targetTitle: "Software Engineer",
      targetCompany: "Acme",
      targetDescription: "Build cool things.",
      candidates: [
        { index: 0, title: "Acme careers", snippet: "Hub", url: "https://acme.com/careers" },
      ],
    });
    expect(result).toContain("TARGET JOB");
    expect(result).toContain("Title:       Software Engineer");
    expect(result).toContain("Company:     Acme");
    expect(result).toContain("SEARCH RESULTS");
    expect(result).toContain("[0]");
    expect(result).toContain("https://acme.com/careers");
  });

  it("indents multi-line descriptions under the TARGET JOB header", () => {
    const result = buildClassifierUserMessage({
      targetTitle: "X",
      targetCompany: "Y",
      targetDescription: "first line\nsecond line",
      candidates: [],
    });
    expect(result).toContain("    first line");
    expect(result).toContain("    second line");
  });
});

describe("CLASSIFY_PAGES_TOOL_SCHEMA", () => {
  it("declares the classify_pages tool with the expected shape", () => {
    expect(CLASSIFY_PAGES_TOOL_SCHEMA.name).toBe("classify_pages");
    expect(CLASSIFY_PAGES_TOOL_SCHEMA.input_schema.type).toBe("object");
  });
});

describe("classifyPages", () => {
  it("short-circuits with an empty result when given no candidates", async () => {
    const result = await classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [],
    });
    expect(result.classifications).toEqual([]);
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it("throws when CLAUDE_API_KEY is missing", async () => {
    delete process.env["CLAUDE_API_KEY"];

    await expect(classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [{ index: 0, title: "T", snippet: "S", url: "https://x" }],
    })).rejects.toThrow(/CLAUDE_API_KEY/);
  });

  it("returns normalized classifications on a valid tool_use response", async () => {
    messagesCreate.mockResolvedValue({
      content: [
        { type: "tool_use", name: "classify_pages", input: {
          classifications: [
            { index: 0, classification: "direct_job_listing" },
            { index: 1, classification: "careers_page" },
            { index: 2, classification: "irrelevant" },
          ],
        } },
      ],
      stop_reason: "tool_use",
    });

    const result = await classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [
        { index: 0, title: "T0", snippet: "S", url: "https://x/0" },
        { index: 1, title: "T1", snippet: "S", url: "https://x/1" },
        { index: 2, title: "T2", snippet: "S", url: "https://x/2" },
      ],
    });

    expect(result.classifications).toHaveLength(3);
    expect(result.classifications[0]).toEqual({ index: 0, classification: "direct_job_listing" });
  });

  it("throws PageClassifierProtocolError when the tool_use block is missing", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "text", text: "I refuse" }],
      stop_reason: "end_turn",
    });

    await expect(classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [{ index: 0, title: "T", snippet: "S", url: "https://x" }],
    })).rejects.toBeInstanceOf(PageClassifierProtocolError);
  });

  it("throws PageClassifierProtocolError when the classifications array length is wrong", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "classify_pages", input: { classifications: [] } }],
      stop_reason: "tool_use",
    });

    await expect(classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [{ index: 0, title: "T", snippet: "S", url: "https://x" }],
    })).rejects.toBeInstanceOf(PageClassifierProtocolError);
  });

  it("throws PageClassifierProtocolError when an entry has an unknown classification label", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "classify_pages", input: {
        classifications: [{ index: 0, classification: "spam" }],
      } }],
      stop_reason: "tool_use",
    });

    await expect(classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [{ index: 0, title: "T", snippet: "S", url: "https://x" }],
    })).rejects.toBeInstanceOf(PageClassifierProtocolError);
  });

  it("throws PageClassifierProtocolError when the input is not an object", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "classify_pages", input: "not an object" }],
      stop_reason: "tool_use",
    });

    await expect(classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [{ index: 0, title: "T", snippet: "S", url: "https://x" }],
    })).rejects.toBeInstanceOf(PageClassifierProtocolError);
  });

  it("throws PageClassifierProtocolError when classifications is not an array", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "classify_pages", input: { classifications: "nope" } }],
      stop_reason: "tool_use",
    });

    await expect(classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [{ index: 0, title: "T", snippet: "S", url: "https://x" }],
    })).rejects.toBeInstanceOf(PageClassifierProtocolError);
  });

  it("throws PageClassifierProtocolError when an entry is a primitive", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "classify_pages", input: { classifications: ["a string"] } }],
      stop_reason: "tool_use",
    });

    await expect(classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [{ index: 0, title: "T", snippet: "S", url: "https://x" }],
    })).rejects.toBeInstanceOf(PageClassifierProtocolError);
  });

  it("throws PageClassifierProtocolError when an entry's index is not an integer", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "classify_pages", input: {
        classifications: [{ index: 0.5, classification: "irrelevant" }],
      } }],
      stop_reason: "tool_use",
    });

    await expect(classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [{ index: 0, title: "T", snippet: "S", url: "https://x" }],
    })).rejects.toBeInstanceOf(PageClassifierProtocolError);
  });

  it("throws PageClassifierProtocolError when an entry references an unknown index", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "classify_pages", input: {
        classifications: [{ index: 99, classification: "irrelevant" }],
      } }],
      stop_reason: "tool_use",
    });

    await expect(classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [{ index: 0, title: "T", snippet: "S", url: "https://x" }],
    })).rejects.toBeInstanceOf(PageClassifierProtocolError);
  });

  it("throws PageClassifierProtocolError when an entry's index is duplicated", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "classify_pages", input: {
        classifications: [
          { index: 0, classification: "irrelevant" },
          { index: 0, classification: "direct_job_listing" },
        ],
      } }],
      stop_reason: "tool_use",
    });

    await expect(classifyPages({
      targetTitle: "X", targetCompany: "Y", targetDescription: "",
      candidates: [
        { index: 0, title: "T0", snippet: "S", url: "https://x/0" },
        { index: 1, title: "T1", snippet: "S", url: "https://x/1" },
      ],
    })).rejects.toBeInstanceOf(PageClassifierProtocolError);
  });
});
