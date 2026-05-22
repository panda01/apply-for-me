import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";

vi.mock("../prismaClient.js", () => {
  return {
    default: {
      jobListing: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
      },
      managedContainer: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      applicationUrlResolutionLog: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      applicationAttemptLogs: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
    },
  };
});


vi.mock("../services/smartProxyScraperService.js", () => {
  return {
    scrapeJobViaContainer: vi.fn(),
    findFirstRunningContainer: vi.fn(),
  };
});

vi.mock("../services/managedContainerService.js", () => {
  // SpawnContainerError is constructed by callers AND inspected via instanceof
  // by the route handlers; declaring it inside the mock factory means both
  // sides resolve to the same class identity.
  class SpawnContainerError extends Error {
    public readonly kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
      this.name = "SpawnContainerError";
    }
  }
  return {
    findOrSpawnRunningContainer: vi.fn(),
    SpawnContainerError,
  };
});

vi.mock("../services/applicationUrlResolverService.js", () => {
  return {
    resolveApplicationUrl: vi.fn(),
    createContainerProgressReporter: vi.fn(() => ({
      startStep: vi.fn().mockResolvedValue(0),
      endStep: vi.fn().mockResolvedValue(undefined),
      finalize: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

const { mockParseDate } = vi.hoisted(() => ({
  mockParseDate: vi.fn(),
}));
vi.mock("chrono-node", () => ({
  parseDate: mockParseDate,
}));

import prisma from "../prismaClient.js";
import { scrapeJobViaContainer } from "../services/smartProxyScraperService.js";
import { findOrSpawnRunningContainer, SpawnContainerError } from "../services/managedContainerService.js";
import { resolveApplicationUrl } from "../services/applicationUrlResolverService.js";
import type { ResolverOutcome, ResolutionTrace } from "../services/applicationUrlResolverService.js";
import { resolve as resolvePath } from "node:path";
import { splitFormattedTitle, parseResolutionLogRow, parseAttemptLogRow } from "./jobListings.js";

/** Absolute path of a tiny PNG fixture checked into claude_tmp/ for the streaming-route tests. */
const FIXTURE_PNG_PATH = resolvePath(process.cwd(), "claude_tmp", "test-screenshot.png");
/** Path that is guaranteed not to exist on disk (used for the file-missing 404 branch). */
const MISSING_FILE_PATH = resolvePath(process.cwd(), "claude_tmp", "definitely-not-here.png");

/**
 * Builds a complete ResolveApplicationUrlResult from just an outcome so tests
 * don't have to repeat the empty-trace shape on every mock setup. Most tests
 * don't care about the trace contents (they're verified separately in the
 * resolver service tests).
 *
 * @param {ResolverOutcome} outcome - The outcome the resolver should return
 * @param {Partial<ResolutionTrace>} [traceOverrides] - Optional trace overrides for tests that DO inspect the trace
 * @returns {{ outcome: ResolverOutcome; trace: ResolutionTrace }} The full result
 */
function resolverResult(outcome: ResolverOutcome, traceOverrides: Partial<ResolutionTrace> = {}) {
  const trace: ResolutionTrace = {
    applyButtonUrlConsidered: null,
    searchQuery: null,
    braveResults: [],
    inspectedCandidates: [],
    ...traceOverrides,
  };
  return { outcome, trace };
}

const mockJobListing = {
  id: 1,
  title: "",
  url: "https://linkedin.com/jobs/1",
  application_url: null,
  description: "",
  salary: null,
  location: null,
  live_url: null,
  post_date: new Date("2026-03-07T00:00:00.000Z"),
  created_date: new Date("2026-03-07T00:00:00.000Z"),
  status: "init" as const,
};

const mockCompletedJobListing = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  application_url: null,
  description: "Build cool stuff",
  salary: "$120k - $150k",
  location: null,
  live_url: null,
  post_date: new Date("2026-03-01T00:00:00.000Z"),
  created_date: new Date("2026-03-07T00:00:00.000Z"),
  status: "init" as const,
};

const mockRunningContainer = { id: 1, hostPort: 41001 };

const baseScrapeResult = {
  title: "Software Engineer",
  company: "Acme Corp",
  description: "Build cool stuff",
  salary: "$120k - $150k",
  post_date: "2026-03-01",
  apply_button_url: null as string | null,
  is_job_description: true,
  reasoning: "Looks like a job description",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockParseDate.mockImplementation((dateString: string) => {
    const parsed = new Date(dateString);
    return isNaN(parsed.getTime()) ? null : parsed;
  });
  // Default mocks so beginResolutionLog returns a row id; per-test cases can
  // override these. update + findFirst default to "no-op" so missing-mock
  // failures surface clearly via assertions rather than thrown errors.
  vi.mocked(prisma.applicationUrlResolutionLog.create).mockResolvedValue({ id: 100 } as never);
  vi.mocked(prisma.applicationUrlResolutionLog.update).mockResolvedValue({ id: 100 } as never);
  vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
  // Stub global fetch so the container `/begin` push is a no-op in tests.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});

describe("POST /api/job-listings", () => {
  it("should return 202 with a pending record when url is provided", async () => {
    vi.mocked(prisma.jobListing.create).mockResolvedValue(mockJobListing);

    const response = await request(app)
      .post("/api/job-listings")
      .send({ url: "https://linkedin.com/jobs/1" });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe("init");
    expect(response.body.url).toBe("https://linkedin.com/jobs/1");
    expect(prisma.jobListing.create).toHaveBeenCalledOnce();
  });

  it("should not trigger scraping after creating the record", async () => {
    vi.mocked(prisma.jobListing.create).mockResolvedValue(mockJobListing);

    await request(app)
      .post("/api/job-listings")
      .send({ url: "https://linkedin.com/jobs/1" });

    expect(scrapeJobViaContainer).not.toHaveBeenCalled();
    expect(prisma.jobListing.update).not.toHaveBeenCalled();
  });

  it("should return 400 when url is missing", async () => {
    const response = await request(app)
      .post("/api/job-listings")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Missing required field: url/);
    expect(prisma.jobListing.create).not.toHaveBeenCalled();
  });

  it("should return 400 when url is not a string", async () => {
    const response = await request(app)
      .post("/api/job-listings")
      .send({ url: 12345 });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid url/);
  });

  it("should return 400 when url is not http or https", async () => {
    const response = await request(app)
      .post("/api/job-listings")
      .send({ url: "ftp://example.com" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid url/);
  });

  it("should return 400 when url is malformed", async () => {
    const response = await request(app)
      .post("/api/job-listings")
      .send({ url: "https://" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid url/);
  });
});

describe("POST /api/job-listings/bulk", () => {
  it("should create multiple records and return 201", async () => {
    // mockImplementation typing is awkward against Prisma's generic create signature;
    // resolve once for both — the route just counts the array length anyway.
    vi.mocked(prisma.jobListing.create).mockResolvedValue(mockJobListing);

    const response = await request(app)
      .post("/api/job-listings/bulk")
      .send({ urls: ["https://linkedin.com/jobs/1", "https://linkedin.com/jobs/2"] });

    expect(response.status).toBe(201);
    expect(response.body.count).toBe(2);
    expect(prisma.jobListing.create).toHaveBeenCalledTimes(2);
  });

  it("should return 400 when urls is missing", async () => {
    const response = await request(app)
      .post("/api/job-listings/bulk")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Missing required field: urls/);
  });

  it("should return 400 when urls is not an array", async () => {
    const response = await request(app)
      .post("/api/job-listings/bulk")
      .send({ urls: "not-an-array" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Missing required field: urls/);
  });

  it("should return 400 when urls array is empty", async () => {
    const response = await request(app)
      .post("/api/job-listings/bulk")
      .send({ urls: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/must not be empty/);
  });

  it("should return 400 when any url is invalid", async () => {
    const response = await request(app)
      .post("/api/job-listings/bulk")
      .send({ urls: ["https://linkedin.com/jobs/1", "not-a-url"] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid URLs found/);
    expect(response.body.invalidUrls).toEqual(["not-a-url"]);
  });
});

describe("POST /api/job-listings/:id/fetch", () => {
  it("auto-spawns a container when none is running and returns 202", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue(baseScrapeResult);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "direct", applicationUrl: "https://acme.com" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    const response = await request(app).post("/api/job-listings/1/fetch");

    expect(response.status).toBe(202);
    expect(findOrSpawnRunningContainer).toHaveBeenCalled();
  });

  it("returns 503 when auto-spawn fails (docker daemon down, image build error, etc.)", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockRejectedValue(new SpawnContainerError("docker_failed", "Docker daemon unavailable"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    const response = await request(app).post("/api/job-listings/1/fetch");

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/Docker daemon unavailable/);
    expect(scrapeJobViaContainer).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("returns 503 with a stringified reason for a non-Error spawn rejection", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockRejectedValue("string-spawn-failure");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    const response = await request(app).post("/api/job-listings/1/fetch");

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/string-spawn-failure/);
    consoleErrorSpy.mockRestore();
  });

  it("should return 404 when the listing does not exist", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);

    const response = await request(app).post("/api/job-listings/999/fetch");

    expect(response.status).toBe(404);
    expect(findOrSpawnRunningContainer).not.toHaveBeenCalled();
  });

  it("should return 400 when id is not a number", async () => {
    const response = await request(app).post("/api/job-listings/abc/fetch");

    expect(response.status).toBe(400);
  });

  it("should return 202 immediately when a container is available", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue(baseScrapeResult);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "direct", applicationUrl: "https://acme.com/jobs/1" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    const response = await request(app).post("/api/job-listings/1/fetch");

    expect(response.status).toBe(202);
    expect(response.body.url).toBe("https://linkedin.com/jobs/1");
  });

  it("should persist the scraped fields and the resolver application_url on resolver success", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({
      ...baseScrapeResult,
      apply_button_url: "https://acme.com/jobs/123/apply",
    });
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({
      outcome: "resolved_via_redirect",
      applicationUrl: "https://acme.com/jobs/123/apply",
    }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    await request(app).post("/api/job-listings/1/fetch");
    await vi.waitFor(() => {
      const updateCalls = vi.mocked(prisma.jobListing.update).mock.calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(2);
    });

    const updateCalls = vi.mocked(prisma.jobListing.update).mock.calls;
    const scrapeCall = updateCalls[0];
    expect(scrapeCall[0]).toEqual({
      where: { id: 1 },
      data: expect.objectContaining({
        title: "Acme Corp - Software Engineer",
        description: "Build cool stuff",
        salary: "$120k - $150k",
      }),
    });

    const resolverCall = updateCalls[1];
    expect(resolverCall[0]).toEqual({
      where: { id: 1 },
      data: { application_url: "https://acme.com/jobs/123/apply" },
    });
  });

  it("should flip status to missing_form_url when the resolver returns not_found", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue(baseScrapeResult);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "not_found", reason: "no matches" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    await request(app).post("/api/job-listings/1/fetch");
    await vi.waitFor(() => {
      expect(vi.mocked(prisma.jobListing.update).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const updateCalls = vi.mocked(prisma.jobListing.update).mock.calls;
    const resolverCall = updateCalls[1];
    expect(resolverCall[0]).toEqual({
      where: { id: 1 },
      data: { application_url: null, status: "missing_form_url" },
    });
  });

  it("should default post_date to now when scraper returns null post_date", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({ ...baseScrapeResult, post_date: null });
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "direct", applicationUrl: "https://acme.com" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    await request(app).post("/api/job-listings/1/fetch");
    await vi.waitFor(() => {
      expect(vi.mocked(prisma.jobListing.update)).toHaveBeenCalled();
    });

    const firstCall = vi.mocked(prisma.jobListing.update).mock.calls[0];
    const dataArg = firstCall[0].data as { post_date: Date };
    expect(dataArg.post_date).toBeInstanceOf(Date);
  });

  it("should log and swallow a scrape failure rather than crash the async handler", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockRejectedValue(new Error("container exploded"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    const response = await request(app).post("/api/job-listings/1/fetch");
    expect(response.status).toBe(202);

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/container exploded/));
    });

    consoleErrorSpy.mockRestore();
  });

  it("should log a non-Error scrape rejection with the stringified reason", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockRejectedValue("non-error-string");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    await request(app).post("/api/job-listings/1/fetch");

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/non-error-string/));
    });

    consoleErrorSpy.mockRestore();
  });
});

describe("POST /api/job-listings/:id/resolve-application-url", () => {
  const scrapedListing = { ...mockCompletedJobListing };

  it("returns 400 when title or description is missing", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);

    const response = await request(app).post("/api/job-listings/1/resolve-application-url");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/has not been scraped yet/);
  });

  it("returns 503 when auto-spawn fails", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(scrapedListing);
    vi.mocked(findOrSpawnRunningContainer).mockRejectedValue(new SpawnContainerError("docker_failed", "boom"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    const response = await request(app).post("/api/job-listings/1/resolve-application-url");

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/boom/);
    consoleErrorSpy.mockRestore();
  });

  it("returns 503 with a stringified message when auto-spawn rejects with a non-Error value", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(scrapedListing);
    vi.mocked(findOrSpawnRunningContainer).mockRejectedValue("docker bus error");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    const response = await request(app).post("/api/job-listings/1/resolve-application-url");

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/docker bus error/);
    consoleErrorSpy.mockRestore();
  });

  it("auto-spawns a container before running the resolver async", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(scrapedListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "direct", applicationUrl: "https://acme.com" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(scrapedListing);

    const response = await request(app).post("/api/job-listings/1/resolve-application-url");

    expect(response.status).toBe(202);
    expect(findOrSpawnRunningContainer).toHaveBeenCalled();
  });

  it("returns 404 when the listing does not exist", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);

    const response = await request(app).post("/api/job-listings/999/resolve-application-url");

    expect(response.status).toBe(404);
  });

  it("returns 400 when id is not a number", async () => {
    const response = await request(app).post("/api/job-listings/abc/resolve-application-url");

    expect(response.status).toBe(400);
  });

  it("INSERTs the placeholder log row synchronously and returns 202 with its id", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue({
      ...scrapedListing,
      status: "missing_form_url",
    });
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(prisma.applicationUrlResolutionLog.create).mockResolvedValue({ id: 77 } as never);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "direct", applicationUrl: "https://acme.com" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(scrapedListing);

    const response = await request(app).post("/api/job-listings/1/resolve-application-url");

    expect(response.status).toBe(202);
    expect(response.body.latest_resolution_log_id).toBe(77);
    // We no longer reset status to init on the JobListing row — in-progress is
    // signaled by the freshly-inserted log row having outcome=null instead.
    expect(prisma.applicationUrlResolutionLog.create).toHaveBeenCalled();
    const createArgs = vi.mocked(prisma.applicationUrlResolutionLog.create).mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      job_listing_id: 1,
      managed_container_id: mockRunningContainer.id,
      outcome: null,
    });
  });

  it("calls the resolver with the company and title split from the formatted title", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(scrapedListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "direct", applicationUrl: "https://acme.com" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(scrapedListing);

    await request(app).post("/api/job-listings/1/resolve-application-url");

    await vi.waitFor(() => {
      expect(resolveApplicationUrl).toHaveBeenCalled();
    });

    expect(resolveApplicationUrl).toHaveBeenCalledWith(expect.objectContaining({
      originalUrl: scrapedListing.url,
      originalTitle: "Software Engineer",
      originalDescription: scrapedListing.description,
      originalCompany: "Acme Corp",
      // The retry path also threads in a progressReporter created by the route.
      progressReporter: expect.any(Object),
    }));
  });

  it("logs and swallows a thrown resolver error", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(scrapedListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(resolveApplicationUrl).mockRejectedValue(new Error("boom"));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(scrapedListing);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    await request(app).post("/api/job-listings/1/resolve-application-url");

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/boom/));
    });

    consoleErrorSpy.mockRestore();
  });

  it("logs a non-Error resolver rejection with stringified reason", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(scrapedListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(resolveApplicationUrl).mockRejectedValue("non-error-reason");
    vi.mocked(prisma.jobListing.update).mockResolvedValue(scrapedListing);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    await request(app).post("/api/job-listings/1/resolve-application-url");

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/non-error-reason/));
    });

    consoleErrorSpy.mockRestore();
  });
});

describe("parsePostDate (exported for coverage)", () => {
  it("falls back to the current date when chrono-node returns null", async () => {
    // chrono-node returns null for unparseable strings; ensure parsePostDate gives a Date back.
    mockParseDate.mockReturnValueOnce(null);
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({ ...baseScrapeResult, post_date: "garbage string" });
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "direct", applicationUrl: "https://acme.com" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    await request(app).post("/api/job-listings/1/fetch");
    await vi.waitFor(() => {
      expect(vi.mocked(prisma.jobListing.update)).toHaveBeenCalled();
    });

    const firstCall = vi.mocked(prisma.jobListing.update).mock.calls[0];
    const dataArg = firstCall[0].data as { post_date: Date };
    expect(dataArg.post_date).toBeInstanceOf(Date);
  });
});

describe("POST /:id/fetch persists a resolution log", () => {
  it("INSERTs a placeholder log row up-front and UPDATEs it with the terminal trace data", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({
      ...baseScrapeResult,
      apply_button_url: "https://acme.com/jobs/123/apply",
    });
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult(
      { outcome: "resolved_via_search", applicationUrl: "https://acme.com/jobs/123" },
      {
        applyButtonUrlConsidered: "https://acme.com/jobs/123/apply",
        searchQuery: "Acme Software Engineer",
        braveResults: [{ title: "Acme careers", url: "https://acme.com/jobs/123", description: "" }],
        inspectedCandidates: [{ url: "https://acme.com/jobs/123", scrapedTitle: "Software Engineer", matched: true, rejectionReason: "matched" }],
      }
    ));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.create).mockResolvedValue({ id: 42 } as never);

    await request(app).post("/api/job-listings/1/fetch");
    await vi.waitFor(() => {
      expect(prisma.applicationUrlResolutionLog.update).toHaveBeenCalled();
    });

    // INSERT step: placeholder data with managed_container_id and outcome=null.
    const createArgs = vi.mocked(prisma.applicationUrlResolutionLog.create).mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      job_listing_id: 1,
      managed_container_id: mockRunningContainer.id,
      outcome: null,
      brave_results: "[]",
      inspected_candidates: "[]",
    });
    // UPDATE step: terminal data, written against the row created above.
    const updateArgs = vi.mocked(prisma.applicationUrlResolutionLog.update).mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 42 });
    expect(updateArgs.data).toMatchObject({
      outcome: "resolved_via_search",
      search_query: "Acme Software Engineer",
      final_application_url: "https://acme.com/jobs/123",
      reason: null,
    });
    expect(JSON.parse(updateArgs.data.brave_results as string)).toEqual([
      { title: "Acme careers", url: "https://acme.com/jobs/123", description: "" },
    ]);
    expect(JSON.parse(updateArgs.data.inspected_candidates as string)).toHaveLength(1);
  });

  it("UPDATEs the row with not_found, a null final_application_url, and the reason", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue(baseScrapeResult);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "not_found", reason: "nothing matched" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    await request(app).post("/api/job-listings/1/fetch");
    await vi.waitFor(() => {
      expect(prisma.applicationUrlResolutionLog.update).toHaveBeenCalled();
    });

    const updateArgs = vi.mocked(prisma.applicationUrlResolutionLog.update).mock.calls[0][0];
    expect(updateArgs.data).toMatchObject({
      outcome: "not_found",
      final_application_url: null,
      reason: "nothing matched",
    });
  });

  it("swallows a finalize-log failure and continues with the row update", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue(baseScrapeResult);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "direct", applicationUrl: "https://acme.com" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.update).mockRejectedValue(new Error("DB log failure"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    await request(app).post("/api/job-listings/1/fetch");
    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/DB log failure/));
    });
    // The application_url update on the JobListing row still runs even though the
    // finalize-log step failed.
    await vi.waitFor(() => {
      const updateCalls = vi.mocked(prisma.jobListing.update).mock.calls;
      expect(updateCalls.some((c) => "application_url" in (c[0].data as Record<string, unknown>))).toBe(true);
    });

    consoleErrorSpy.mockRestore();
  });

  it("logs a non-Error finalize-log rejection with stringified reason", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue(baseScrapeResult);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "direct", applicationUrl: "https://acme.com" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.update).mockRejectedValue("non-error-log");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    await request(app).post("/api/job-listings/1/fetch");
    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/non-error-log/));
    });

    consoleErrorSpy.mockRestore();
  });

  it("warns and continues when the container /begin POST fails", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(findOrSpawnRunningContainer).mockResolvedValue(mockRunningContainer);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue(baseScrapeResult);
    vi.mocked(resolveApplicationUrl).mockResolvedValue(resolverResult({ outcome: "direct", applicationUrl: "https://acme.com" }));
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("container down")));
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* swallow */ });

    await request(app).post("/api/job-listings/1/fetch");
    await vi.waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringMatching(/\/begin POST to container failed/));
    });
    // Resolver still ran and the row was finalized.
    await vi.waitFor(() => {
      expect(prisma.applicationUrlResolutionLog.update).toHaveBeenCalled();
    });

    consoleWarnSpy.mockRestore();
  });
});

describe("GET /api/job-listings/:id/resolution-logs", () => {
  const mockLogRow = {
    id: 1,
    job_listing_id: 1,
    managed_container_id: 7,
    outcome: "resolved_via_search" as const,
    search_query: "Acme Software Engineer",
    brave_results: JSON.stringify([{ title: "Acme", url: "https://acme.com/jobs/1", description: "" }]),
    inspected_candidates: JSON.stringify([{ url: "https://acme.com/jobs/1", scrapedTitle: "SE", matched: true, rejectionReason: "matched" }]),
    final_application_url: "https://acme.com/jobs/1",
    reason: null,
    created_date: new Date("2026-05-16T13:00:00.000Z"),
  };

  it("returns the parsed log rows newest-first", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findMany).mockResolvedValue([mockLogRow]);

    const response = await request(app).get("/api/job-listings/1/resolution-logs");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: 1,
      outcome: "resolved_via_search",
      search_query: "Acme Software Engineer",
      final_application_url: "https://acme.com/jobs/1",
    });
    expect(response.body[0].brave_results).toEqual([
      { title: "Acme", url: "https://acme.com/jobs/1", description: "" },
    ]);
    expect(response.body[0].inspected_candidates).toHaveLength(1);
    expect(prisma.applicationUrlResolutionLog.findMany).toHaveBeenCalledWith({
      where: { job_listing_id: 1 },
      orderBy: { created_date: "desc" },
    });
  });

  it("returns 404 when the listing does not exist", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);
    const response = await request(app).get("/api/job-listings/999/resolution-logs");
    expect(response.status).toBe(404);
    expect(prisma.applicationUrlResolutionLog.findMany).not.toHaveBeenCalled();
  });

  it("returns 400 when id is not a number", async () => {
    const response = await request(app).get("/api/job-listings/abc/resolution-logs");
    expect(response.status).toBe(400);
  });

  it("returns empty array when the listing has no logs", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findMany).mockResolvedValue([]);

    const response = await request(app).get("/api/job-listings/1/resolution-logs");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe("parseResolutionLogRow", () => {
  const baseRow = {
    id: 1,
    job_listing_id: 1,
    managed_container_id: 7,
    outcome: "direct" as const,
    search_query: null,
    final_application_url: "https://acme.com",
    reason: null,
    created_date: new Date(),
  };

  it("parses well-formed JSON columns into arrays", () => {
    const parsed = parseResolutionLogRow({
      ...baseRow,
      brave_results: JSON.stringify([{ title: "x", url: "https://x.com", description: "" }]),
      inspected_candidates: JSON.stringify([{ url: "https://y.com", scrapedTitle: "t", matched: true, rejectionReason: "matched" }]),
    });
    expect(parsed.brave_results).toHaveLength(1);
    expect(parsed.inspected_candidates).toHaveLength(1);
  });

  it("falls back to [] when a JSON column is malformed", () => {
    const parsed = parseResolutionLogRow({
      ...baseRow,
      brave_results: "{not json",
      inspected_candidates: "[",
    });
    expect(parsed.brave_results).toEqual([]);
    expect(parsed.inspected_candidates).toEqual([]);
  });

  it("falls back to [] when the parsed JSON is not an array", () => {
    const parsed = parseResolutionLogRow({
      ...baseRow,
      brave_results: JSON.stringify({ not: "an array" }),
      inspected_candidates: JSON.stringify("oops"),
    });
    expect(parsed.brave_results).toEqual([]);
    expect(parsed.inspected_candidates).toEqual([]);
  });
});

describe("splitFormattedTitle", () => {
  it("splits a 'Company - Title' formatted string into company and title", () => {
    const result = splitFormattedTitle("Acme Corp - Software Engineer");
    expect(result).toEqual({ company: "Acme Corp", title: "Software Engineer" });
  });

  it("returns empty company when no separator is present", () => {
    const result = splitFormattedTitle("Just a Title");
    expect(result).toEqual({ company: "", title: "Just a Title" });
  });

  it("trims whitespace around each part", () => {
    const result = splitFormattedTitle("  Acme Corp   -  Software Engineer  ");
    expect(result.company).toBe("Acme Corp");
    expect(result.title).toBe("Software Engineer");
  });

  it("splits on the first separator only", () => {
    const result = splitFormattedTitle("Acme - Sub-team - Senior Engineer");
    expect(result.company).toBe("Acme");
    expect(result.title).toBe("Sub-team - Senior Engineer");
  });
});

describe("GET /api/job-listings", () => {
  it("returns all listings ordered by created_date desc", async () => {
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([mockCompletedJobListing]);

    const response = await request(app).get("/api/job-listings");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(prisma.jobListing.findMany).toHaveBeenCalledWith({
      orderBy: { created_date: "desc" },
    });
  });
});

describe("GET /api/job-listings/:id", () => {
  it("returns 200 with the listing when it exists", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);

    const response = await request(app).get("/api/job-listings/1");

    expect(response.status).toBe(200);
    expect(response.body.url).toBe(mockCompletedJobListing.url);
  });

  it("includes resolution_in_progress=true when the latest log has outcome=null", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue({ id: 9, outcome: null } as never);

    const response = await request(app).get("/api/job-listings/1");

    expect(response.status).toBe(200);
    expect(response.body.resolution_in_progress).toBe(true);
    expect(response.body.latest_resolution_log_id).toBe(9);
  });

  it("includes resolution_in_progress=false when the latest log has terminated", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue({ id: 4, outcome: "resolved_via_search" } as never);

    const response = await request(app).get("/api/job-listings/1");

    expect(response.body.resolution_in_progress).toBe(false);
    expect(response.body.latest_resolution_log_id).toBe(4);
  });

  it("includes resolution_in_progress=false and latest_resolution_log_id=null when no attempts exist", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue(null);

    const response = await request(app).get("/api/job-listings/1");

    expect(response.body.resolution_in_progress).toBe(false);
    expect(response.body.latest_resolution_log_id).toBeNull();
  });

  it("returns 404 when the listing does not exist", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);

    const response = await request(app).get("/api/job-listings/999");

    expect(response.status).toBe(404);
  });

  it("returns 400 when id is not a number", async () => {
    const response = await request(app).get("/api/job-listings/abc");

    expect(response.status).toBe(400);
  });
});

describe("GET /api/job-listings/:id/url-resolution/live", () => {
  const inProgressLog = {
    id: 50,
    job_listing_id: 1,
    managed_container_id: 7,
    outcome: null,
    search_query: null,
    brave_results: "[]",
    inspected_candidates: "[]",
    final_application_url: null,
    reason: null,
    created_date: new Date("2026-05-18T00:00:00.000Z"),
  };
  const terminalLog = {
    id: 51,
    job_listing_id: 1,
    managed_container_id: 7,
    outcome: "resolved_via_search" as const,
    search_query: "Acme Software Engineer",
    brave_results: JSON.stringify([{ title: "Acme", url: "https://acme.com/jobs/1", description: "" }]),
    inspected_candidates: JSON.stringify([{ url: "https://acme.com/jobs/1", scrapedTitle: "SE", matched: true, rejectionReason: "title and description matched" }]),
    final_application_url: "https://acme.com/jobs/1",
    reason: null,
    created_date: new Date("2026-05-18T00:01:00.000Z"),
  };

  it("returns 404 when the job listing does not exist", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);

    const response = await request(app).get("/api/job-listings/999/url-resolution/live");

    expect(response.status).toBe(404);
  });

  it("returns 404 when the listing has no resolution attempts", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue(null);

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/No resolution attempts/);
  });

  it("proxies live progress from the container when the attempt is still running", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue(inProgressLog as never);
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue({ hostPort: 41001 } as never);
    const liveBody = { logId: 50, jobListingId: 1, isFinished: false, steps: [{ stepIndex: 0, phase: "direct_check", status: "running", message: "starting", payload: {}, startedAt: "2026-05-18T00:00:00.000Z", endedAt: null, durationMs: null }], finalOutcome: null, finalApplicationUrl: null, reason: null, startedAt: "2026-05-18T00:00:00.000Z", finishedAt: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(liveBody), { status: 200, headers: { "Content-Type": "application/json" } })));

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.status).toBe(200);
    expect(response.body.logId).toBe(50);
    expect(response.body.isFinished).toBe(false);
    expect(response.body.steps).toHaveLength(1);
  });

  it("returns a crashed terminal payload when the container 404s on the live endpoint", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue(inProgressLog as never);
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue({ hostPort: 41001 } as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "gone" }), { status: 404 })));

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.status).toBe(200);
    expect(response.body.isFinished).toBe(true);
    expect(response.body.finalOutcome).toBeNull();
    expect(response.body.reason).toMatch(/may have crashed/);
  });

  it("returns a crashed terminal payload when the container returns a 500", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue(inProgressLog as never);
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue({ hostPort: 41001 } as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.body.isFinished).toBe(true);
    expect(response.body.finalOutcome).toBeNull();
    expect(response.body.reason).toMatch(/status 500/);
  });

  it("returns a crashed terminal payload when the container is unreachable", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue(inProgressLog as never);
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue({ hostPort: 41001 } as never);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.body.isFinished).toBe(true);
    expect(response.body.reason).toMatch(/Container unreachable: connection refused/);
  });

  it("stringifies a non-Error rejection from the container fetch", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue(inProgressLog as never);
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue({ hostPort: 41001 } as never);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("abort"));

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.body.reason).toMatch(/Container unreachable: abort/);
  });

  it("returns a crashed terminal payload when the log row has no managed_container_id", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue({ ...inProgressLog, managed_container_id: null } as never);

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.body.isFinished).toBe(true);
    expect(response.body.reason).toMatch(/missing its managed container/);
  });

  it("returns a crashed terminal payload when the managed_container_id no longer exists", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue(inProgressLog as never);
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.body.isFinished).toBe(true);
    expect(response.body.reason).toMatch(/missing its managed container/);
  });

  it("synthesized finalize step uses the outcome string when reason is null", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue({
      ...terminalLog,
      reason: null,
    } as never);

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    const finalizeStep = (response.body.steps as Array<{ phase: string; message: string }>).find((s) => s.phase === "finalize");
    expect(finalizeStep?.message).toBe("Outcome: resolved_via_search");
  });

  it("synthesizes a terminal payload from the log row for finished attempts", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue(terminalLog as never);

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.status).toBe(200);
    expect(response.body.isFinished).toBe(true);
    expect(response.body.finalOutcome).toBe("resolved_via_search");
    expect(response.body.finalApplicationUrl).toBe("https://acme.com/jobs/1");
    // Synthesized steps: brave_search + 1 candidate_evaluate + finalize
    expect(response.body.steps).toHaveLength(3);
    const phases = (response.body.steps as Array<{ phase: string }>).map((s) => s.phase);
    expect(phases).toEqual(["brave_search", "candidate_evaluate", "finalize"]);
  });

  it("synthesized payload handles a not_found outcome with no search query", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue({
      ...terminalLog,
      outcome: "not_found",
      search_query: null,
      brave_results: "[]",
      inspected_candidates: "[]",
      final_application_url: null,
      reason: "nothing matched",
    } as never);

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.body.finalOutcome).toBe("not_found");
    expect(response.body.reason).toBe("nothing matched");
    // No brave_search and no candidate steps, only the finalize step.
    expect(response.body.steps).toHaveLength(1);
    expect((response.body.steps as Array<{ phase: string }>)[0].phase).toBe("finalize");
  });

  it("synthesized payload tolerates malformed JSON in brave_results and inspected_candidates", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue({
      ...terminalLog,
      brave_results: "{not json",
      inspected_candidates: "[oops",
    } as never);

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.status).toBe(200);
    expect(response.body.isFinished).toBe(true);
    // brave_search step still emitted (search_query was non-null), but with an empty result list.
    const braveSearchStep = (response.body.steps as Array<{ phase: string; payload: { resultCount?: number } }>).find((s) => s.phase === "brave_search");
    expect(braveSearchStep?.payload.resultCount).toBe(0);
  });

  it("synthesized payload tolerates non-array JSON in brave_results and inspected_candidates", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue({
      ...terminalLog,
      brave_results: JSON.stringify({ not: "an array" }),
      inspected_candidates: JSON.stringify("nope"),
    } as never);

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    expect(response.status).toBe(200);
    expect(response.body.isFinished).toBe(true);
  });

  it("synthesized payload renders a candidate row with default values when fields are malformed", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationUrlResolutionLog.findFirst).mockResolvedValue({
      ...terminalLog,
      inspected_candidates: JSON.stringify([{}]), // missing all fields
    } as never);

    const response = await request(app).get("/api/job-listings/1/url-resolution/live");

    const candidateStep = (response.body.steps as Array<{ phase: string; status: string; payload: { url: string; scrapedTitle: string; matched: boolean } }>).find((s) => s.phase === "candidate_evaluate");
    expect(candidateStep?.status).toBe("skipped"); // matched defaults to false
    expect(candidateStep?.payload.url).toBe("(unknown)");
    expect(candidateStep?.payload.scrapedTitle).toBe("");
  });
});

describe("DELETE /api/job-listings/:id", () => {
  it("deletes a listing and returns 200", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.jobListing.delete).mockResolvedValue(mockCompletedJobListing);

    const response = await request(app).delete("/api/job-listings/1");

    expect(response.status).toBe(200);
    expect(prisma.jobListing.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("returns 404 when the listing does not exist", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);

    const response = await request(app).delete("/api/job-listings/999");

    expect(response.status).toBe(404);
    expect(prisma.jobListing.delete).not.toHaveBeenCalled();
  });

  it("returns 400 when id is not a number", async () => {
    const response = await request(app).delete("/api/job-listings/abc");

    expect(response.status).toBe(400);
  });
});

/**
 * Builds an ApplicationAttemptLogs-shaped row for the new-route tests.
 * Mirrors the Prisma client's returned shape including the new enum field
 * and the two nullable on-disk-path fields.
 *
 * @param {Partial<{ id: number; job_listing_id: number; logs: string; end_response: "applied" | "failed" | "closed_listing" | "captcha_blocked" | "stuck"; submission_screenshot_path: string | null; log_directory: string | null; created_date: Date }>} [overrides] - Field overrides
 * @returns The mock attempt row
 */
function buildMockAttemptRow(overrides: Partial<{
  id: number;
  job_listing_id: number;
  logs: string;
  end_response: "applied" | "failed" | "closed_listing" | "captcha_blocked" | "stuck";
  submission_screenshot_path: string | null;
  log_directory: string | null;
  created_date: Date;
}> = {}) {
  return {
    id: 1,
    job_listing_id: 1,
    logs: "[]",
    end_response: "applied" as const,
    submission_screenshot_path: null as string | null,
    log_directory: null as string | null,
    created_date: new Date("2026-05-21T00:00:00.000Z"),
    ...overrides,
  };
}

describe("parseAttemptLogRow", () => {
  it("parses well-formed step_logs JSON and derives has_submission_screenshot=true", () => {
    const stepLogs = [
      { stepNumber: 1, phase: 1, phaseLabel: "Opening job URL", url: "x", nextGoal: "x", actions: [], screenshotSaved: true, captchaDetected: false, stuckDetected: false, timestamp: "t" },
    ];
    const row = buildMockAttemptRow({ logs: JSON.stringify(stepLogs), submission_screenshot_path: "/abs/logs/1/step-4.png" });

    const parsed = parseAttemptLogRow(row);

    expect(parsed.step_logs).toHaveLength(1);
    expect(parsed.step_logs[0].stepNumber).toBe(1);
    expect(parsed.has_submission_screenshot).toBe(true);
  });

  it("derives has_submission_screenshot=false when submission_screenshot_path is null", () => {
    const row = buildMockAttemptRow({ submission_screenshot_path: null });
    expect(parseAttemptLogRow(row).has_submission_screenshot).toBe(false);
  });

  it("returns an empty step_logs array on malformed JSON", () => {
    const row = buildMockAttemptRow({ logs: "{not-json}" });
    expect(parseAttemptLogRow(row).step_logs).toEqual([]);
  });

  it("returns an empty step_logs array when the JSON parses to a non-array", () => {
    const row = buildMockAttemptRow({ logs: "{}" });
    expect(parseAttemptLogRow(row).step_logs).toEqual([]);
  });
});

describe("GET /api/job-listings/:id/attempts", () => {
  it("returns the job + parsed attempts ordered desc", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationAttemptLogs.findMany).mockResolvedValue([
      buildMockAttemptRow({ id: 10, end_response: "applied", submission_screenshot_path: "/abs/x.png" }),
      buildMockAttemptRow({ id: 9, end_response: "failed" }),
    ] as never);

    const response = await request(app).get("/api/job-listings/1/attempts");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(1);
    expect(response.body.attempts).toHaveLength(2);
    expect(response.body.attempts[0].id).toBe(10);
    expect(response.body.attempts[0].has_submission_screenshot).toBe(true);
    expect(response.body.attempts[1].has_submission_screenshot).toBe(false);
    expect(prisma.applicationAttemptLogs.findMany).toHaveBeenCalledWith({
      where: { job_listing_id: 1 },
      orderBy: { created_date: "desc" },
    });
  });

  it("returns the job with attempts: [] when none exist", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.applicationAttemptLogs.findMany).mockResolvedValue([] as never);

    const response = await request(app).get("/api/job-listings/1/attempts");

    expect(response.status).toBe(200);
    expect(response.body.attempts).toEqual([]);
  });

  it("returns 404 when the job is missing", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);
    const response = await request(app).get("/api/job-listings/999/attempts");
    expect(response.status).toBe(404);
  });
});

describe("GET /api/job-listings/:jobId/attempts/:attemptId", () => {
  it("returns the attempt plus parent job_listing block", async () => {
    vi.mocked(prisma.applicationAttemptLogs.findUnique).mockResolvedValue({
      ...buildMockAttemptRow({ id: 10, job_listing_id: 1, end_response: "applied", submission_screenshot_path: "/abs/x.png" }),
      job_listing: { id: 1, title: "Acme - Engineer", url: "https://x" },
    } as never);

    const response = await request(app).get("/api/job-listings/1/attempts/10");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(10);
    expect(response.body.has_submission_screenshot).toBe(true);
    expect(response.body.job_listing.title).toBe("Acme - Engineer");
  });

  it("returns 400 on a non-integer attemptId", async () => {
    const response = await request(app).get("/api/job-listings/1/attempts/abc");
    expect(response.status).toBe(400);
  });

  it("returns 404 when the attempt is missing", async () => {
    vi.mocked(prisma.applicationAttemptLogs.findUnique).mockResolvedValue(null);
    const response = await request(app).get("/api/job-listings/1/attempts/999");
    expect(response.status).toBe(404);
  });

  it("returns 404 when the attempt belongs to a different job", async () => {
    vi.mocked(prisma.applicationAttemptLogs.findUnique).mockResolvedValue({
      ...buildMockAttemptRow({ id: 10, job_listing_id: 7 }),
      job_listing: { id: 7, title: "Other", url: "https://other" },
    } as never);
    const response = await request(app).get("/api/job-listings/1/attempts/10");
    expect(response.status).toBe(404);
  });
});

describe("GET /api/job-listings/:jobId/attempts/:attemptId/submission-screenshot", () => {
  it("streams the PNG with image/png + no-store when the file exists", async () => {
    vi.mocked(prisma.applicationAttemptLogs.findUnique).mockResolvedValue(
      buildMockAttemptRow({ id: 10, job_listing_id: 1, submission_screenshot_path: FIXTURE_PNG_PATH }) as never,
    );

    const response = await request(app).get("/api/job-listings/1/attempts/10/submission-screenshot");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("returns 404 when submission_screenshot_path is null", async () => {
    vi.mocked(prisma.applicationAttemptLogs.findUnique).mockResolvedValue(
      buildMockAttemptRow({ id: 10, job_listing_id: 1, submission_screenshot_path: null }) as never,
    );

    const response = await request(app).get("/api/job-listings/1/attempts/10/submission-screenshot");

    expect(response.status).toBe(404);
  });

  it("returns 404 when the file is missing on disk", async () => {
    vi.mocked(prisma.applicationAttemptLogs.findUnique).mockResolvedValue(
      buildMockAttemptRow({ id: 10, job_listing_id: 1, submission_screenshot_path: MISSING_FILE_PATH }) as never,
    );

    const response = await request(app).get("/api/job-listings/1/attempts/10/submission-screenshot");

    expect(response.status).toBe(404);
  });

  it("returns 404 when the attempt belongs to a different job", async () => {
    vi.mocked(prisma.applicationAttemptLogs.findUnique).mockResolvedValue(
      buildMockAttemptRow({ id: 10, job_listing_id: 7, submission_screenshot_path: FIXTURE_PNG_PATH }) as never,
    );
    const response = await request(app).get("/api/job-listings/1/attempts/10/submission-screenshot");
    expect(response.status).toBe(404);
  });
});

describe("GET /api/job-listings/:jobId/attempts/:attemptId/steps/:stepNumber/screenshot", () => {
  it("streams the per-step PNG from log_directory when the file exists", async () => {
    vi.mocked(prisma.applicationAttemptLogs.findUnique).mockResolvedValue(
      buildMockAttemptRow({ id: 10, job_listing_id: 1, log_directory: resolvePath(process.cwd(), "claude_tmp") }) as never,
    );

    const response = await request(app).get("/api/job-listings/1/attempts/10/steps/4/screenshot");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
  });

  it("returns 400 on a non-integer stepNumber", async () => {
    const response = await request(app).get("/api/job-listings/1/attempts/10/steps/abc/screenshot");
    expect(response.status).toBe(400);
  });

  it("returns 404 when log_directory is null", async () => {
    vi.mocked(prisma.applicationAttemptLogs.findUnique).mockResolvedValue(
      buildMockAttemptRow({ id: 10, job_listing_id: 1, log_directory: null }) as never,
    );
    const response = await request(app).get("/api/job-listings/1/attempts/10/steps/4/screenshot");
    expect(response.status).toBe(404);
  });

  it("returns 404 when the per-step file is missing on disk", async () => {
    vi.mocked(prisma.applicationAttemptLogs.findUnique).mockResolvedValue(
      buildMockAttemptRow({ id: 10, job_listing_id: 1, log_directory: resolvePath(process.cwd(), "claude_tmp") }) as never,
    );
    // step-9999.png is not present in claude_tmp/, so the access check fails
    const response = await request(app).get("/api/job-listings/1/attempts/10/steps/9999/screenshot");
    expect(response.status).toBe(404);
  });
});
