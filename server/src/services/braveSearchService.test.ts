import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchWeb } from "./braveSearchService.js";

describe("searchWeb", () => {
  const originalEnv = process.env["BRAVE_SEARCH_API_KEY"];

  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env["BRAVE_SEARCH_API_KEY"] = "test-key";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["BRAVE_SEARCH_API_KEY"];
    } else {
      process.env["BRAVE_SEARCH_API_KEY"] = originalEnv;
    }
  });

  it("throws when BRAVE_SEARCH_API_KEY is not set", async () => {
    delete process.env["BRAVE_SEARCH_API_KEY"];
    await expect(searchWeb("anything")).rejects.toThrow(/BRAVE_SEARCH_API_KEY/);
  });

  it("throws when BRAVE_SEARCH_API_KEY is an empty string", async () => {
    process.env["BRAVE_SEARCH_API_KEY"] = "";
    await expect(searchWeb("anything")).rejects.toThrow(/BRAVE_SEARCH_API_KEY/);
  });

  it("throws when query is empty after trimming", async () => {
    await expect(searchWeb("   ")).rejects.toThrow(/non-empty query/);
  });

  it("returns parsed results when the API responds with web.results", async () => {
    const fakeJson = {
      web: {
        results: [
          { title: "Acme Careers", url: "https://acme.com/jobs/123", description: "Software Engineer" },
          { title: "Other Site", url: "https://acme.com/jobs/124", description: "" },
        ],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeJson),
    }));

    const results = await searchWeb("Acme Software Engineer");

    expect(results).toEqual([
      { title: "Acme Careers", url: "https://acme.com/jobs/123", description: "Software Engineer" },
      { title: "Other Site", url: "https://acme.com/jobs/124", description: "" },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.search.brave.com"),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Subscription-Token": "test-key" }),
      })
    );
  });

  it("filters out results missing a title or url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        web: {
          results: [
            { title: "OK", url: "https://acme.com/a", description: "" },
            { title: "", url: "https://acme.com/b", description: "" },
            { title: "No URL", url: "", description: "" },
            { title: "Bad URL", url: "not a url", description: "" },
            { title: "FTP URL", url: "ftp://acme.com", description: "" },
          ],
        },
      }),
    }));

    const results = await searchWeb("test");

    expect(results.map((r) => r.url)).toEqual(["https://acme.com/a"]);
  });

  it("defaults description to empty string when missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        web: { results: [{ title: "OK", url: "https://acme.com/a" }] },
      }),
    }));

    const results = await searchWeb("test");
    expect(results).toEqual([{ title: "OK", url: "https://acme.com/a", description: "" }]);
  });

  it("returns empty array when web.results is missing entirely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }));

    const results = await searchWeb("test");
    expect(results).toEqual([]);
  });

  it("throws when the API returns a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    }));

    await expect(searchWeb("test")).rejects.toThrow(/429 Too Many Requests/);
  });

  it("wraps a thrown Error from fetch in a descriptive message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(searchWeb("test")).rejects.toThrow(/Brave Search request failed: ECONNREFUSED/);
  });

  it("wraps a non-Error thrown from fetch with a stringified reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("network-string"));

    await expect(searchWeb("test")).rejects.toThrow(/Brave Search request failed: network-string/);
  });

  it("respects the limit parameter via the count query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ web: { results: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await searchWeb("test", 3);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("count=3");
  });
});
