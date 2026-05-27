import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Prisma client surface this service touches. Vitest hoists vi.mock
// above the imports under test, so it's safe to declare here even though the
// service file imports prisma at module load time.
vi.mock("../prismaClient.js", () => ({
  default: {
    gmailConnection: {
      findFirst: vi.fn(),
    },
  },
}));

// Hoisted spy for getValidAccessToken so we can both inject it into the
// vi.mock factory below AND read .mock.calls from inside test bodies.
const { getValidAccessTokenMock } = vi.hoisted(() => ({
  getValidAccessTokenMock: vi.fn(),
}));
vi.mock("./gmailConnectionService.js", () => ({
  getValidAccessToken: getValidAccessTokenMock,
}));

import prisma from "../prismaClient.js";
import {
  getFirstConnectionId,
  listJobKeywordMessages,
  fetchMessage,
} from "./gmailMessageReaderService.js";

/**
 * Builds a vitest-style Response-shaped object that the service's fetch
 * usage can consume (it only reads .ok, .status, .json(), and .text()).
 * Centralized so each test stays focused on the data shape it cares about.
 *
 * @param {object} options - Configuration
 * @param {number} options.status - HTTP status to expose
 * @param {unknown} options.jsonBody - The body to return from .json()
 * @param {string} [options.textBody] - Optional text body for .text() (non-2xx error path)
 * @returns {object} A Response-like mock with .ok, .status, .json, .text
 */
function makeFakeResponse(options: {
  status: number;
  jsonBody: unknown;
  textBody?: string;
}): {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
} {
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    json: () => Promise.resolve(options.jsonBody),
    text: () => Promise.resolve(options.textBody ?? ""),
  };
}

/**
 * Base64url-encodes a UTF-8 string the way Gmail does it. Used in fetchMessage
 * tests so the service's decoder is exercised end-to-end on realistic input.
 *
 * @param {string} plaintext - The text to encode
 * @returns {string} The base64url-encoded value
 */
function toBase64Url(plaintext: string): string {
  return Buffer.from(plaintext, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

beforeEach(() => {
  vi.clearAllMocks();
  getValidAccessTokenMock.mockResolvedValue("fake-access-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFirstConnectionId", () => {
  it("returns the id of the oldest connection (created_date asc)", async () => {
    vi.mocked(prisma.gmailConnection.findFirst).mockResolvedValue({
      id: 42,
      google_email: "user@example.com",
      refresh_token: "rt",
      access_token: "at",
      access_token_expires_at: new Date("2099-01-01T00:00:00.000Z"),
      scopes: "scopes",
      created_date: new Date("2026-01-01T00:00:00.000Z"),
      updated_date: new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await getFirstConnectionId();

    expect(result).toBe(42);
    const findFirstCall = vi.mocked(prisma.gmailConnection.findFirst).mock.calls[0]?.[0];
    expect(findFirstCall?.orderBy).toEqual({ created_date: "asc" });
  });

  it("throws the connect-Gmail-first error when no rows exist", async () => {
    vi.mocked(prisma.gmailConnection.findFirst).mockResolvedValue(null);
    await expect(getFirstConnectionId()).rejects.toThrow(
      /No Gmail account connected.*\/integrations/u,
    );
  });
});

describe("listJobKeywordMessages", () => {
  it("builds the keyword query with after:YYYY/MM/DD and includes maxResults=100", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({ status: 200, jsonBody: { messages: [] } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await listJobKeywordMessages(7, new Date("2026-05-23T12:34:56.000Z"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    expect(calledUrl).toContain("maxResults=100");

    const decodedQuery = decodeURIComponent(
      // pull the q= param out for a precise equality check
      (calledUrl.match(/[?&]q=([^&]+)/u)?.[1]) ?? "",
    );
    expect(decodedQuery).toBe(
      "(job OR jobs OR hiring OR career OR careers OR position OR opportunity OR opening OR recruiter) after:2026/05/23",
    );

    const fetchInit = fetchSpy.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(fetchInit.headers["Authorization"]).toBe("Bearer fake-access-token");
  });

  it("paginates: concatenates message ids across pages using nextPageToken", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeFakeResponse({
          status: 200,
          jsonBody: {
            messages: [{ id: "m1" }, { id: "m2" }],
            nextPageToken: "page-token-abc",
          },
        }),
      )
      .mockResolvedValueOnce(
        makeFakeResponse({
          status: 200,
          jsonBody: { messages: [{ id: "m3" }] },
        }),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await listJobKeywordMessages(1, new Date("2026-05-23T00:00:00.000Z"));

    expect(result).toEqual(["m1", "m2", "m3"]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondUrl = fetchSpy.mock.calls[1]?.[0] as string;
    expect(secondUrl).toContain("pageToken=page-token-abc");
  });

  it("caps the total returned ids at 200 even when more pages exist", async () => {
    // First page: 100 ids + nextPageToken. Second page: 100 ids + nextPageToken.
    // Third page should never be requested because we hit the 200 cap.
    /**
     * Generates a synthetic batch of Gmail message-id entries for use in the
     * paginated-cap test below. Keeps the test data construction concise.
     *
     * @param {string} prefix - Identifier prefix unique to this page
     * @param {number} count - How many entries to generate
     * @returns {{ id: string }[]} The synthetic page entries
     */
    function makePageEntries(prefix: string, count: number): { id: string }[] {
      const entries: { id: string }[] = [];
      for (let index = 0; index < count; index += 1) {
        entries.push({ id: `${prefix}-${String(index)}` });
      }
      return entries;
    }

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeFakeResponse({
          status: 200,
          jsonBody: {
            messages: makePageEntries("a", 100),
            nextPageToken: "after-page-1",
          },
        }),
      )
      .mockResolvedValueOnce(
        makeFakeResponse({
          status: 200,
          jsonBody: {
            messages: makePageEntries("b", 100),
            nextPageToken: "after-page-2",
          },
        }),
      )
      .mockResolvedValueOnce(
        makeFakeResponse({
          status: 200,
          jsonBody: {
            messages: makePageEntries("c", 100),
          },
        }),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await listJobKeywordMessages(1, new Date("2026-05-23T00:00:00.000Z"));

    expect(result.length).toBe(200);
    // Stopped after exactly two pages — the third page was never fetched.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result[0]).toBe("a-0");
    expect(result[199]).toBe("b-99");
  });

  it("throws the reconnect-at-/integrations error on a 401 response", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeFakeResponse({ status: 401, jsonBody: {}, textBody: "unauthorized" }),
      );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      listJobKeywordMessages(1, new Date("2026-05-23T00:00:00.000Z")),
    ).rejects.toThrow(/reconnect at \/integrations/u);
  });

  it("throws an error containing the status code for other non-2xx responses", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeFakeResponse({ status: 500, jsonBody: {}, textBody: "server down" }),
      );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      listJobKeywordMessages(1, new Date("2026-05-23T00:00:00.000Z")),
    ).rejects.toThrow(/Gmail API error: 500.*server down/u);
  });
});

describe("fetchMessage", () => {
  it("decodes a multipart payload with both HTML and plaintext parts", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({
        status: 200,
        jsonBody: {
          id: "msg-1",
          threadId: "thr-1",
          snippet: "Hi there, take a look",
          payload: {
            mimeType: "multipart/alternative",
            headers: [
              { name: "From", value: "\"Acme Recruiting\" <recruit@acme.example>" },
              { name: "Subject", value: "Senior Engineer opening" },
              { name: "Date", value: "Sat, 23 May 2026 12:00:00 +0000" },
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: toBase64Url("Plain text body!") },
              },
              {
                mimeType: "text/html",
                body: { data: toBase64Url("<p>HTML body!</p>") },
              },
            ],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchMessage(1, "msg-1");

    expect(result.messageId).toBe("msg-1");
    expect(result.threadId).toBe("thr-1");
    expect(result.fromName).toBe("Acme Recruiting");
    expect(result.fromAddress).toBe("recruit@acme.example");
    expect(result.subject).toBe("Senior Engineer opening");
    expect(result.snippet).toBe("Hi there, take a look");
    expect(result.bodyHtml).toBe("<p>HTML body!</p>");
    expect(result.bodyText).toBe("Plain text body!");
    expect(result.receivedAt.toISOString()).toBe("2026-05-23T12:00:00.000Z");

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-1?format=full",
    );
    const fetchInit = fetchSpy.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(fetchInit.headers["Authorization"]).toBe("Bearer fake-access-token");
  });

  it("parses a From header with no display name into matching name + address", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({
        status: 200,
        jsonBody: {
          id: "msg-2",
          threadId: "thr-2",
          snippet: null,
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "bare@example.com" },
              { name: "Subject", value: "" },
              { name: "Date", value: "Sat, 23 May 2026 12:00:00 +0000" },
            ],
            body: { data: toBase64Url("body") },
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchMessage(1, "msg-2");

    expect(result.fromAddress).toBe("bare@example.com");
    expect(result.fromName).toBe("bare@example.com");
  });

  it("returns null snippet when the API omits it", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({
        status: 200,
        jsonBody: {
          id: "msg-3",
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "x@example.com" },
              { name: "Date", value: "Sat, 23 May 2026 12:00:00 +0000" },
            ],
            body: { data: toBase64Url("plain") },
          },
          // snippet intentionally omitted
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchMessage(1, "msg-3");

    expect(result.snippet).toBeNull();
    expect(result.threadId).toBeNull();
    expect(result.subject).toBe("");
    expect(result.bodyText).toBe("plain");
    expect(result.bodyHtml).toBeNull();
  });

  it("throws the reconnect-at-/integrations error on a 401 response", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({ status: 401, jsonBody: {}, textBody: "unauth" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchMessage(1, "msg-x")).rejects.toThrow(/reconnect at \/integrations/u);
  });

  it("throws with the status code and body on other non-2xx responses", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({ status: 404, jsonBody: {}, textBody: "missing message" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchMessage(1, "msg-x")).rejects.toThrow(
      /Gmail API error: 404.*missing message/u,
    );
  });

  it("returns empty strings for fromName/fromAddress when the From header is missing", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({
        status: 200,
        jsonBody: {
          id: "msg-no-from",
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "Subject", value: "Just a subject" },
              { name: "Date", value: "Sat, 23 May 2026 12:00:00 +0000" },
            ],
            body: { data: toBase64Url("body") },
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchMessage(1, "msg-no-from");

    expect(result.fromName).toBe("");
    expect(result.fromAddress).toBe("");
  });

  // Covers line 218 binary-expr path 1: `headers ?? []` fallback when payload has no headers.
  // Covers line 372 cond-expr path 0: `dateHeaderValue === null ? new Date(NaN) : ...` (Date header missing).
  // Covers line 312 binary-expr path 1: `node.mimeType ?? ""` fallback when mimeType is undefined.
  // Covers line 308 if path 0: walk called with undefined (via undefined payload).
  it("handles a payload with no headers and no Date header (NaN receivedAt)", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({
        status: 200,
        jsonBody: {
          id: "msg-no-headers",
          // payload omitted entirely → headers undefined → findHeader's ?? [] fallback.
          // Also exercises collectBodiesFromPayload(undefined) → walk(undefined) → isMissingNode true.
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchMessage(1, "msg-no-headers");

    expect(result.fromName).toBe("");
    expect(result.fromAddress).toBe("");
    expect(result.subject).toBe("");
    expect(Number.isNaN(result.receivedAt.getTime())).toBe(true);
    expect(result.bodyHtml).toBeNull();
    expect(result.bodyText).toBeNull();
  });

  // Covers line 261 cond-expr path 1: unquoted display name returns rawName directly (no slice).
  it("parses a From header with an unquoted display name without stripping quotes", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({
        status: 200,
        jsonBody: {
          id: "msg-noquote",
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "Alice Wonderland <alice@example.com>" },
              { name: "Date", value: "Sat, 23 May 2026 12:00:00 +0000" },
            ],
            body: { data: toBase64Url("hello") },
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchMessage(1, "msg-noquote");

    // Unquoted display name is returned as-is (not stripped of any quotes).
    expect(result.fromName).toBe("Alice Wonderland");
    expect(result.fromAddress).toBe("alice@example.com");
  });

  // Covers line 312 binary-expr path 1: node.mimeType ?? "" fallback when mimeType is undefined on a part.
  it("walks past parts that have no mimeType without crashing", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({
        status: 200,
        jsonBody: {
          id: "msg-no-mime",
          payload: {
            mimeType: "multipart/mixed",
            headers: [
              { name: "From", value: "x@example.com" },
              { name: "Date", value: "Sat, 23 May 2026 12:00:00 +0000" },
            ],
            parts: [
              // Part with NO mimeType — exercises the ?? "" fallback. body.data present
              // but no mime → neither text/html nor text/plain match → no fragment pushed.
              { body: { data: toBase64Url("ignored") } },
              // Real text/plain part so we still produce a body.
              { mimeType: "text/plain", body: { data: toBase64Url("real body") } },
            ],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchMessage(1, "msg-no-mime");

    expect(result.bodyText).toBe("real body");
    expect(result.bodyHtml).toBeNull();
  });

  // Covers line 331 cond-expr path 0: textBodyFragments.length === 0 → bodyText null branch
  // when ONLY an HTML body is present (no text/plain part at all).
  it("returns null bodyText when the message has only an HTML part", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({
        status: 200,
        jsonBody: {
          id: "msg-html-only",
          payload: {
            mimeType: "text/html",
            headers: [
              { name: "From", value: "x@example.com" },
              { name: "Date", value: "Sat, 23 May 2026 12:00:00 +0000" },
            ],
            body: { data: toBase64Url("<p>only html</p>") },
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchMessage(1, "msg-html-only");

    expect(result.bodyHtml).toBe("<p>only html</p>");
    expect(result.bodyText).toBeNull();
  });

  // Covers line 190 binary-expr path 1: responseJson.messages ?? [] fallback when API
  // returns a body without a `messages` field (e.g., empty mailbox or no results).
  it("returns an empty array from listJobKeywordMessages when API omits the messages field", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      // No `messages` field at all on the response → exercise the ?? [] fallback.
      makeFakeResponse({ status: 200, jsonBody: {} }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await listJobKeywordMessages(1, new Date("2026-05-23T00:00:00.000Z"));

    expect(result).toEqual([]);
  });

  it("walks past child parts that have no body data without crashing", async () => {
    // Exercises the recursion edge in collectBodiesFromPayload where a
    // multipart container itself has no body.data — the walker must descend
    // into its parts rather than treating the container as a body fragment.
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      makeFakeResponse({
        status: 200,
        jsonBody: {
          id: "msg-nested",
          payload: {
            mimeType: "multipart/alternative",
            headers: [
              { name: "From", value: "x@example.com" },
              { name: "Date", value: "Sat, 23 May 2026 12:00:00 +0000" },
            ],
            // No body.data on the container itself.
            parts: [
              {
                mimeType: "multipart/related",
                // Also no body on this nested container.
                parts: [
                  { mimeType: "text/plain", body: { data: toBase64Url("hi") } },
                ],
              },
              // A part with no body and no parts is the leaf-edge case.
              { mimeType: "text/calendar" },
            ],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchMessage(1, "msg-nested");

    expect(result.bodyText).toBe("hi");
    expect(result.bodyHtml).toBeNull();
  });
});
