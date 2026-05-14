import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSessionsStop = vi.fn();
const mockSessionsGet = vi.fn();

/**
 * Creates a mock SessionRun object that mimics the Browser Use SDK's SessionRun.
 * Has a sessionId property and implements PromiseLike via .then().
 * @param {object} result - The resolved result value
 * @param {string} sessionId - The session ID to expose on the run object
 * @returns {object} A mock SessionRun with sessionId and .then()
 */
function createMockSessionRun(result: Record<string, unknown>, sessionId: string) {
  return {
    sessionId,
    then(onFulfilled: (value: Record<string, unknown>) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
}

/**
 * Creates a mock SessionRun that rejects when awaited.
 * @param {Error} error - The error to reject with
 * @returns {object} A mock SessionRun that rejects
 */
function createMockRejectedSessionRun(error: Error) {
  return {
    sessionId: null,
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.reject(error).then(onFulfilled, onRejected);
    },
  };
}

const mockRun = vi.fn();

vi.mock("browser-use-sdk/v3", () => {
  return {
    BrowserUse: class MockBrowserUse {
      run = mockRun;
      sessions = {
        stop: mockSessionsStop,
        get: mockSessionsGet,
      };
    },
  };
});

import { fetchJobListingFromUrl } from "./jobListingScraperService.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionsGet.mockResolvedValue({ liveUrl: "https://live.example.com/session" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchJobListingFromUrl", () => {
  it("should throw when BROWSER_USE_API is not set", async () => {
    delete process.env["BROWSER_USE_API"];

    await expect(fetchJobListingFromUrl("https://linkedin.com/jobs/1", null))
      .rejects.toThrow("BROWSER_USE_API environment variable is not set");
  });

  it("should extract job listing without credentials for non-LinkedIn URLs", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const result = {
      id: "session-1",
      status: "idle",
      output: {
        title: "Software Engineer",
        company: "Example Inc",
        description: "Build things",
        postDate: "3 days ago",
      },
    };
    mockRun.mockReturnValue(createMockSessionRun(result, "session-1"));

    const listing = await fetchJobListingFromUrl("https://example.com/jobs/1", null);

    expect(listing).toEqual({
      title: "Software Engineer",
      company: "Example Inc",
      description: "Build things",
      postDate: "3 days ago",
      url: "https://example.com/jobs/1",
    });

    expect(mockRun).toHaveBeenCalledOnce();
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("https://example.com/jobs/1"),
      expect.objectContaining({ keepAlive: false }),
    );
  });

  it("should include credentials in the prompt when provided for LinkedIn URLs", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const result = {
      id: "session-linkedin",
      status: "idle",
      output: {
        title: "Software Engineer",
        company: "Acme Corp",
        description: "Build cool stuff",
        postDate: "2 days ago",
      },
    };
    mockRun.mockReturnValue(createMockSessionRun(result, "session-linkedin"));

    const credentials = { email: "user@example.com", password: "pass123" };
    const listing = await fetchJobListingFromUrl("https://www.linkedin.com/jobs/view/123", credentials);

    expect(listing).toEqual({
      title: "Software Engineer",
      company: "Acme Corp",
      description: "Build cool stuff",
      postDate: "2 days ago",
      url: "https://www.linkedin.com/jobs/view/123",
    });

    expect(mockRun).toHaveBeenCalledOnce();

    // Single call should contain both the job URL and credentials in the prompt
    const promptArg = mockRun.mock.calls[0][0] as string;
    expect(promptArg).toContain("https://www.linkedin.com/jobs/view/123");
    expect(promptArg).toContain("user@example.com");
    expect(promptArg).toContain("pass123");
    expect(promptArg).toContain("log in");
    expect(mockRun.mock.calls[0][1]).toEqual(expect.objectContaining({ keepAlive: false }));
  });

  it("should throw when extraction fails", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    mockRun.mockReturnValue(createMockSessionRun({
      id: "session-extract-fail",
      status: "timed_out",
      output: null,
    }, "session-extract-fail"));

    await expect(fetchJobListingFromUrl("https://example.com/jobs/1", null))
      .rejects.toThrow("Job extraction failed with status: timed_out");

    expect(mockSessionsStop).toHaveBeenCalledWith("session-extract-fail");
  });

  it("should throw when agent returns no output", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    mockRun.mockReturnValue(createMockSessionRun({
      id: "session-no-output",
      status: "idle",
      output: null,
    }, "session-no-output"));

    await expect(fetchJobListingFromUrl("https://example.com/jobs/1", null))
      .rejects.toThrow("Browser Use agent returned no output");

    expect(mockSessionsStop).toHaveBeenCalledWith("session-no-output");
  });

  it("should stop the session even when an error occurs during run", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    mockRun.mockReturnValue(createMockRejectedSessionRun(new Error("Network error")));

    await expect(fetchJobListingFromUrl("https://example.com/jobs/1", null))
      .rejects.toThrow("Network error");

    // No sessionId captured since run failed (sessionId is null), so stop should not be called
    expect(mockSessionsStop).not.toHaveBeenCalled();
  });

  it("should stringify a non-Error rejection from run in the scraping-failed log line", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mockRun.mockReturnValue({
      sessionId: null,
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.reject("non-error-scraper-failure").then(onFulfilled, onRejected);
      },
    });

    await expect(fetchJobListingFromUrl("https://example.com/jobs/1", null))
      .rejects.toBe("non-error-scraper-failure");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Scraping failed for https://example.com/jobs/1: non-error-scraper-failure")
    );
    errorSpy.mockRestore();
  });

  it("should stop the session after successful extraction", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    mockRun.mockReturnValue(createMockSessionRun({
      id: "session-cleanup",
      status: "idle",
      output: {
        title: "Engineer",
        company: "Corp",
        description: "Work",
        postDate: "1 day ago",
      },
    }, "session-cleanup"));

    await fetchJobListingFromUrl("https://example.com/jobs/1", null);

    expect(mockSessionsStop).toHaveBeenCalledWith("session-cleanup");
  });

  it("should call onLiveUrlReady callback with the live URL when provided", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    mockRun.mockReturnValue(createMockSessionRun({
      id: "session-live",
      status: "idle",
      output: {
        title: "Engineer",
        company: "Corp",
        description: "Work",
        postDate: "1 day ago",
      },
    }, "session-live"));

    mockSessionsGet.mockResolvedValue({ liveUrl: "https://live.browser-use.com/abc123" });

    const onLiveUrlReady = vi.fn();
    await fetchJobListingFromUrl("https://example.com/jobs/1", null, onLiveUrlReady);

    expect(mockSessionsGet).toHaveBeenCalledWith("session-live");
    expect(onLiveUrlReady).toHaveBeenCalledWith("https://live.browser-use.com/abc123");
  });

  it("should not call onLiveUrlReady when callback is not provided", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    mockRun.mockReturnValue(createMockSessionRun({
      id: "session-no-cb",
      status: "idle",
      output: {
        title: "Engineer",
        company: "Corp",
        description: "Work",
        postDate: "1 day ago",
      },
    }, "session-no-cb"));

    await fetchJobListingFromUrl("https://example.com/jobs/1", null);

    expect(mockSessionsGet).not.toHaveBeenCalled();
  });

  it("should handle session stop failure gracefully", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    mockRun.mockReturnValue(createMockSessionRun({
      id: "session-stop-fail",
      status: "idle",
      output: {
        title: "Engineer",
        company: "Corp",
        description: "Work",
        postDate: "1 day ago",
      },
    }, "session-stop-fail"));

    mockSessionsStop.mockRejectedValue(new Error("Session already stopped"));

    const listing = await fetchJobListingFromUrl("https://example.com/jobs/1", null);

    expect(listing.title).toBe("Engineer");
    expect(mockSessionsStop).toHaveBeenCalledWith("session-stop-fail");
  });

  it("should handle sessions.get failure when fetching live URL", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    mockRun.mockReturnValue(createMockSessionRun({
      id: "session-get-fail",
      status: "idle",
      output: {
        title: "Engineer",
        company: "Corp",
        description: "Work",
        postDate: "1 day ago",
      },
    }, "session-get-fail"));

    mockSessionsGet.mockRejectedValue(new Error("Session not found"));

    const onLiveUrlReady = vi.fn();
    const listing = await fetchJobListingFromUrl("https://example.com/jobs/1", null, onLiveUrlReady);

    expect(listing.title).toBe("Engineer");
    expect(onLiveUrlReady).not.toHaveBeenCalled();
  });

  it("should warn when sessionId is not available within timeout", async () => {
    process.env["BROWSER_USE_API"] = "test-key";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const originalSetTimeout = globalThis.setTimeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: any) => {
      return originalSetTimeout(fn, 0);
    });

    const mockSessionRunWithNullId = {
      sessionId: null as string | null,
      then(onFulfilled: (value: Record<string, unknown>) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve({
          id: "session-timeout",
          status: "idle",
          output: { title: "Engineer", company: "Corp", description: "Work", postDate: "1 day ago" },
        }).then(onFulfilled, onRejected);
      },
    };
    mockRun.mockReturnValue(mockSessionRunWithNullId);

    const onLiveUrlReady = vi.fn();
    await fetchJobListingFromUrl("https://example.com/jobs/1", null, onLiveUrlReady);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Session ID not available within timeout"));
    expect(onLiveUrlReady).not.toHaveBeenCalled();

    vi.mocked(globalThis.setTimeout).mockRestore();
    warnSpy.mockRestore();
  });

  it("should not call onLiveUrlReady when session has no liveUrl", async () => {
    process.env["BROWSER_USE_API"] = "test-key";

    mockRun.mockReturnValue(createMockSessionRun({
      id: "session-no-live",
      status: "idle",
      output: {
        title: "Engineer",
        company: "Corp",
        description: "Work",
        postDate: "1 day ago",
      },
    }, "session-no-live"));

    mockSessionsGet.mockResolvedValue({ liveUrl: null });

    const onLiveUrlReady = vi.fn();
    await fetchJobListingFromUrl("https://example.com/jobs/1", null, onLiveUrlReady);

    expect(mockSessionsGet).toHaveBeenCalledWith("session-no-live");
    expect(onLiveUrlReady).not.toHaveBeenCalled();
  });
});
