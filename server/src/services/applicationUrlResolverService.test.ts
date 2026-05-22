import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./braveSearchService.js", () => ({
  searchWeb: vi.fn(),
}));

vi.mock("./smartProxyScraperService.js", () => ({
  scrapeJobViaContainer: vi.fn(),
  findFirstRunningContainer: vi.fn(),
}));

vi.mock("./jobMatchService.js", () => ({
  evaluateJobMatch: vi.fn(),
}));

vi.mock("./careersPageHarvesterService.js", () => ({
  harvestCareersPage: vi.fn(),
}));

// Mock the LLM-backed classifier so tests don't hit the Anthropic SDK (which
// refuses to run inside jsdom). Re-exports the real types/errors so callers
// can still `instanceof PageClassifierProtocolError` if a test wants to.
vi.mock("./aiPageClassifierService.js", async () => {
  const actual = await vi.importActual<typeof import("./aiPageClassifierService.js")>("./aiPageClassifierService.js");
  return {
    ...actual,
    classifyPages: vi.fn(),
  };
});

import { searchWeb } from "./braveSearchService.js";
import { scrapeJobViaContainer, findFirstRunningContainer } from "./smartProxyScraperService.js";
import { evaluateJobMatch } from "./jobMatchService.js";
import { classifyPages } from "./aiPageClassifierService.js";
import { harvestCareersPage } from "./careersPageHarvesterService.js";
import {
  resolveApplicationUrl,
  isGatedHost,
  tryGetHostname,
  buildSearchQuery,
  createContainerProgressReporter,
  ResolutionPhase,
  StepStatus,
  type ResolverProgressReporter,
} from "./applicationUrlResolverService.js";

/**
 * Builds a stub ResolverProgressReporter that records every call so tests can
 * assert on the exact sequence the resolver emits.
 *
 * @returns {{ reporter: ResolverProgressReporter; events: Array<unknown> }} Reporter and the event log
 */
function makeStubReporter(): {
  reporter: ResolverProgressReporter;
  events: Array<{ type: string; phase?: ResolutionPhase; stepIndex?: number; status?: StepStatus; outcome?: string; applicationUrl?: string | null; reason?: string | null }>;
} {
  const events: Array<{ type: string; phase?: ResolutionPhase; stepIndex?: number; status?: StepStatus; outcome?: string; applicationUrl?: string | null; reason?: string | null }> = [];
  let nextStepIndex = 0;
  const reporter: ResolverProgressReporter = {
    async startStep(phase, message, payload) {
      const stepIndex = nextStepIndex++;
      events.push({ type: "start", phase, stepIndex });
      // The message and payload aren't asserted on but referencing them
      // keeps the parameters live for ESLint's no-unused-vars rule.
      void message;
      void payload;
      return stepIndex;
    },
    async endStep(stepIndex, status, message, payload) {
      events.push({ type: "end", stepIndex, status });
      void message;
      void payload;
    },
    async finalize(outcome, applicationUrl, reason) {
      events.push({ type: "finalize", outcome, applicationUrl, reason });
    },
  };
  return { reporter, events };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default classifier behavior: label every candidate as a direct listing.
  // Individual tests can override with mockResolvedValueOnce / mockImplementation
  // when they need careers-page or irrelevant labels, or when they want the
  // classifier itself to throw.
  vi.mocked(classifyPages).mockImplementation(async (input) => ({
    classifications: input.candidates.map((c) => ({ index: c.index, classification: "direct_job_listing" })),
  }));
});

describe("isGatedHost", () => {
  it("returns true for linkedin.com and indeed.com", () => {
    expect(isGatedHost("linkedin.com")).toBe(true);
    expect(isGatedHost("indeed.com")).toBe(true);
  });

  it("returns true for subdomains of gated hosts", () => {
    expect(isGatedHost("www.linkedin.com")).toBe(true);
    expect(isGatedHost("uk.indeed.com")).toBe(true);
  });

  it("returns false for non-gated hosts", () => {
    expect(isGatedHost("acme.com")).toBe(false);
    expect(isGatedHost("careers.acme.com")).toBe(false);
  });

  it("is case-insensitive on the input", () => {
    expect(isGatedHost("LinkedIn.com")).toBe(true);
  });
});

describe("tryGetHostname", () => {
  it("returns the lowercase hostname for a valid URL", () => {
    expect(tryGetHostname("https://Example.COM/path")).toBe("example.com");
  });

  it("returns null for malformed URLs", () => {
    expect(tryGetHostname("not a url")).toBeNull();
  });

  it("returns null when the input is empty", () => {
    expect(tryGetHostname("")).toBeNull();
  });
});

describe("buildSearchQuery", () => {
  it("joins company and title with a single space and trims", () => {
    expect(buildSearchQuery(" Acme ", " Software Engineer ")).toBe("Acme Software Engineer");
  });

  it("collapses extra internal whitespace", () => {
    expect(buildSearchQuery("Acme  Corp", "Senior   Engineer")).toBe("Acme Corp Senior Engineer");
  });
});

describe("resolveApplicationUrl", () => {
  const baseInput = {
    originalUrl: "https://www.linkedin.com/jobs/view/123",
    originalTitle: "Software Engineer",
    originalDescription: "We build cool things at Acme",
    originalCompany: "Acme",
  };

  const matchedVerdict = { matched: true, reason: "title matched and description overlap 60% >= 40%" };
  const rejectedVerdict = { matched: false, reason: "title mismatch" };

  it("returns 'not_found' when the original URL is malformed", async () => {
    const result = await resolveApplicationUrl({ ...baseInput, originalUrl: "not a url" });
    expect(result.outcome.outcome).toBe("not_found");
    expect(result.trace.searchQuery).toBeNull();
    expect(result.trace.braveResults).toEqual([]);
    expect(result.trace.inspectedCandidates).toEqual([]);
  });

  it("returns 'direct' when the original URL is already off-platform", async () => {
    const result = await resolveApplicationUrl({
      ...baseInput,
      originalUrl: "https://acme.com/careers/123",
    });
    expect(result.outcome).toEqual({ outcome: "direct", applicationUrl: "https://acme.com/careers/123" });
    expect(result.trace.applyButtonUrlConsidered).toBeNull();
    expect(result.trace.searchQuery).toBeNull();
    expect(findFirstRunningContainer).not.toHaveBeenCalled();
  });

  it("returns 'not_found' with a hint to spawn a container when none is running", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue(null);

    const result = await resolveApplicationUrl(baseInput);

    expect(result.outcome.outcome).toBe("not_found");
    if (result.outcome.outcome === "not_found") {
      expect(result.outcome.reason).toMatch(/Containers page/);
    }
  });

  it("uses the pre-supplied apply button URL without re-scraping when it's off-platform", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: "https://acme.com/apply/123",
    });

    expect(result.outcome).toEqual({ outcome: "resolved_via_redirect", applicationUrl: "https://acme.com/apply/123" });
    expect(result.trace.applyButtonUrlConsidered).toBe("https://acme.com/apply/123");
    expect(scrapeJobViaContainer).not.toHaveBeenCalled();
  });

  it("ignores the pre-supplied apply button URL when it's still on a gated host", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue([]);

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: "https://www.linkedin.com/jobs/view/123/apply",
    });

    expect(result.outcome.outcome).toBe("not_found");
    expect(result.trace.applyButtonUrlConsidered).toBe("https://www.linkedin.com/jobs/view/123/apply");
    expect(searchWeb).toHaveBeenCalled();
  });

  it("re-scrapes the original URL when no apply-button hint is provided", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme",
      description: "",
      salary: null,
      post_date: null,
      apply_button_url: "https://acme.com/apply/123",
      is_job_description: true,
      reasoning: "",
    });

    const result = await resolveApplicationUrl(baseInput);

    expect(result.outcome).toEqual({ outcome: "resolved_via_redirect", applicationUrl: "https://acme.com/apply/123" });
    expect(scrapeJobViaContainer).toHaveBeenCalledWith(41010, baseInput.originalUrl);
  });

  it("falls through to web search when the re-scrape of the original URL throws (does not bail)", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    // First call (re-scrape of original) throws; second call (search candidate) succeeds.
    vi.mocked(scrapeJobViaContainer)
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({
        title: "Software Engineer",
        company: "Acme",
        description: "Build cool things at Acme",
        salary: null,
        post_date: null,
        apply_button_url: null,
        is_job_description: true,
        reasoning: "",
      });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "Acme careers", url: "https://acme.com/jobs/1", description: "" },
    ]);
    vi.mocked(evaluateJobMatch).mockReturnValue({ matched: true, reason: "matched" });

    const result = await resolveApplicationUrl(baseInput);

    expect(result.outcome).toEqual({ outcome: "resolved_via_search", applicationUrl: "https://acme.com/jobs/1" });
    expect(searchWeb).toHaveBeenCalledWith("Acme Software Engineer");
    // Trace records the apply-button URL as null because the re-scrape failed
    expect(result.trace.applyButtonUrlConsidered).toBeNull();
  });

  it("still produces a not_found outcome when re-scrape fails AND search yields no match", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(scrapeJobViaContainer).mockRejectedValue(new Error("fetch failed"));
    vi.mocked(searchWeb).mockResolvedValue([]);

    const result = await resolveApplicationUrl(baseInput);
    expect(result.outcome.outcome).toBe("not_found");
    if (result.outcome.outcome === "not_found") {
      // Reason should reflect the search-step outcome, not the re-scrape failure
      expect(result.outcome.reason).toMatch(/Inspected/);
    }
  });

  it("returns 'not_found' when company and title are both empty (cannot search)", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalCompany: "",
      originalTitle: "",
      originalApplyButtonUrl: null,
    });

    expect(result.outcome.outcome).toBe("not_found");
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("returns 'resolved_via_search' when a candidate matches, and records the verdict in the trace", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "Acme - Software Engineer", url: "https://acme.com/jobs/123", description: "Build cool things" },
    ]);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme",
      description: "Build cool things at Acme",
      salary: null,
      post_date: null,
      apply_button_url: null,
      is_job_description: true,
      reasoning: "",
    });
    vi.mocked(evaluateJobMatch).mockReturnValue(matchedVerdict);

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: null,
    });

    expect(result.outcome).toEqual({ outcome: "resolved_via_search", applicationUrl: "https://acme.com/jobs/123" });
    expect(result.trace.searchQuery).toBe("Acme Software Engineer");
    expect(result.trace.braveResults).toHaveLength(1);
    expect(result.trace.inspectedCandidates).toHaveLength(1);
    expect(result.trace.inspectedCandidates[0]).toMatchObject({
      url: "https://acme.com/jobs/123",
      scrapedTitle: "Software Engineer",
      matched: true,
    });
  });

  it("skips gated and malformed search candidates but records them in trace.brave_results", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "LI", url: "https://linkedin.com/jobs/123", description: "" },
      { title: "Bad URL", url: "not-a-url", description: "" },
      { title: "Acme", url: "https://acme.com/jobs/123", description: "" },
    ]);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme",
      description: "Build cool things at Acme",
      salary: null,
      post_date: null,
      apply_button_url: null,
      is_job_description: true,
      reasoning: "",
    });
    vi.mocked(evaluateJobMatch).mockReturnValue(matchedVerdict);

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: null,
    });

    expect(result.outcome.outcome).toBe("resolved_via_search");
    expect(scrapeJobViaContainer).toHaveBeenCalledTimes(1);
    expect(scrapeJobViaContainer).toHaveBeenCalledWith(41010, "https://acme.com/jobs/123");
    // All three brave results are recorded, but only the non-gated, well-formed one was inspected
    expect(result.trace.braveResults).toHaveLength(3);
    expect(result.trace.inspectedCandidates).toHaveLength(1);
    expect(result.trace.inspectedCandidates[0].url).toBe("https://acme.com/jobs/123");
  });

  it("records a candidate that fails to scrape with a scrape-failure reason", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "First", url: "https://first.com/j", description: "" },
      { title: "Second", url: "https://second.com/j", description: "" },
    ]);
    vi.mocked(scrapeJobViaContainer)
      .mockRejectedValueOnce(new Error("first scrape failed"))
      .mockResolvedValueOnce({
        title: "Software Engineer",
        company: "Acme",
        description: "Build cool things at Acme",
        salary: null,
        post_date: null,
        apply_button_url: null,
        is_job_description: true,
        reasoning: "",
      });
    vi.mocked(evaluateJobMatch).mockReturnValue(matchedVerdict);

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: null,
    });

    expect(result.outcome).toEqual({ outcome: "resolved_via_search", applicationUrl: "https://second.com/j" });
    expect(result.trace.inspectedCandidates).toHaveLength(2);
    expect(result.trace.inspectedCandidates[0]).toMatchObject({
      url: "https://first.com/j",
      matched: false,
      rejectionReason: expect.stringMatching(/scrape failed: first scrape failed/),
    });
    expect(result.trace.inspectedCandidates[1].matched).toBe(true);
  });

  it("records non-Error scrape failure as a stringified reason", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "First", url: "https://first.com/j", description: "" },
    ]);
    vi.mocked(scrapeJobViaContainer).mockRejectedValue("non-error-scrape");

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: null,
    });

    expect(result.outcome.outcome).toBe("not_found");
    expect(result.trace.inspectedCandidates[0].rejectionReason).toMatch(/non-error-scrape/);
  });

  it("returns 'not_found' when search throws", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockRejectedValue(new Error("brave down"));

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: null,
    });

    expect(result.outcome.outcome).toBe("not_found");
    if (result.outcome.outcome === "not_found") {
      expect(result.outcome.reason).toMatch(/brave down/);
    }
  });

  it("returns 'not_found' when search throws a non-Error", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockRejectedValue("non-error-string-reason");

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: null,
    });

    expect(result.outcome.outcome).toBe("not_found");
    if (result.outcome.outcome === "not_found") {
      expect(result.outcome.reason).toMatch(/non-error-string-reason/);
    }
  });

  it("records the rejection verdict reason for each rejected candidate", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "Candidate", url: "https://acme.com/jobs/999", description: "" },
    ]);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({
      title: "Different Role",
      company: "Acme",
      description: "Different work",
      salary: null,
      post_date: null,
      apply_button_url: null,
      is_job_description: true,
      reasoning: "",
    });
    vi.mocked(evaluateJobMatch).mockReturnValue({ matched: false, reason: "title mismatch (original=\"x\", candidate=\"y\")" });

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: null,
    });

    expect(result.outcome.outcome).toBe("not_found");
    expect(result.trace.inspectedCandidates[0].rejectionReason).toMatch(/title mismatch/);
  });

  it("stops inspecting after the candidate cap", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        title: `T${String(i)}`,
        url: `https://site${String(i)}.com/job`,
        description: "",
      }))
    );
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({
      title: "Different",
      company: "Different",
      description: "Different",
      salary: null,
      post_date: null,
      apply_button_url: null,
      is_job_description: true,
      reasoning: "",
    });
    vi.mocked(evaluateJobMatch).mockReturnValue(rejectedVerdict);

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: null,
    });

    expect(scrapeJobViaContainer).toHaveBeenCalledTimes(5);
    expect(result.trace.inspectedCandidates).toHaveLength(5);
  });

  it("returns 'not_found' when no candidates are returned and the inspected list is empty", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue([]);

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: null,
    });

    expect(result.outcome.outcome).toBe("not_found");
    expect(result.trace.braveResults).toEqual([]);
    expect(result.trace.inspectedCandidates).toEqual([]);
  });

  it("resolves via a careers page when no direct listing matches but a careers-page link does", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "Acme Careers", url: "https://acme.com/careers", description: "All openings" },
    ]);
    // Classifier labels the only Brave result as a careers_page so the resolver
    // takes the harvest-then-scrape branch.
    vi.mocked(classifyPages).mockResolvedValueOnce({
      classifications: [{ index: 0, classification: "careers_page" }],
    });
    vi.mocked(harvestCareersPage).mockResolvedValue({
      careersPageUrl: "https://acme.com/careers",
      rawLinkCount: 5,
      topHrefs: [{ href: "https://acme.com/jobs/swe", text: "SWE", accessibleName: "SWE", score: 0.9 }],
    });
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme",
      description: "Build cool things at Acme",
      salary: null,
      post_date: null,
      apply_button_url: null,
      is_job_description: true,
      reasoning: "",
    });
    vi.mocked(evaluateJobMatch).mockReturnValue(matchedVerdict);

    const result = await resolveApplicationUrl({ ...baseInput, originalApplyButtonUrl: null });

    expect(result.outcome).toEqual({
      outcome: "resolved_via_careers_page",
      applicationUrl: "https://acme.com/jobs/swe",
    });
    expect(harvestCareersPage).toHaveBeenCalledWith(41010, "https://acme.com/careers", "Software Engineer");
  });

  it("falls back to not_found when the careers-page harvest itself throws", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "Acme Careers", url: "https://acme.com/careers", description: "All openings" },
    ]);
    vi.mocked(classifyPages).mockResolvedValueOnce({
      classifications: [{ index: 0, classification: "careers_page" }],
    });
    vi.mocked(harvestCareersPage).mockRejectedValue(new Error("container unreachable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await resolveApplicationUrl({ ...baseInput, originalApplyButtonUrl: null });

    expect(result.outcome.outcome).toBe("not_found");
    warnSpy.mockRestore();
  });

  it("skips careers-page harvested hrefs that are gated or malformed", async () => {
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41010 });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "Acme Careers", url: "https://acme.com/careers", description: "All openings" },
    ]);
    vi.mocked(classifyPages).mockResolvedValueOnce({
      classifications: [{ index: 0, classification: "careers_page" }],
    });
    vi.mocked(harvestCareersPage).mockResolvedValue({
      careersPageUrl: "https://acme.com/careers",
      rawLinkCount: 3,
      topHrefs: [
        { href: "not-a-url", text: "Bad", accessibleName: "Bad", score: 0.8 },
        { href: "https://linkedin.com/jobs/123", text: "LI", accessibleName: "LI", score: 0.7 },
        { href: "https://acme.com/jobs/swe", text: "SWE", accessibleName: "SWE", score: 0.9 },
      ],
    });
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme",
      description: "Build cool things at Acme",
      salary: null,
      post_date: null,
      apply_button_url: null,
      is_job_description: true,
      reasoning: "",
    });
    vi.mocked(evaluateJobMatch).mockReturnValue(matchedVerdict);

    const result = await resolveApplicationUrl({ ...baseInput, originalApplyButtonUrl: null });

    expect(result.outcome.outcome).toBe("resolved_via_careers_page");
    // The bad URL and the gated LinkedIn href should have been skipped — only
    // the valid acme.com URL is scraped.
    expect(scrapeJobViaContainer).toHaveBeenCalledWith(41010, "https://acme.com/jobs/swe");
  });
});

describe("resolveApplicationUrl with progressReporter", () => {
  const baseInput = {
    originalUrl: "https://www.linkedin.com/jobs/view/123",
    originalTitle: "Software Engineer",
    originalDescription: "Build cool things at Acme",
    originalCompany: "Acme",
  };

  it("emits direct_check + finalize for an immediately-direct outcome", async () => {
    const { reporter, events } = makeStubReporter();
    await resolveApplicationUrl({
      ...baseInput,
      originalUrl: "https://acme.com/careers/123",
      progressReporter: reporter,
    });
    const phases = events.filter((e) => e.type === "start").map((e) => e.phase);
    expect(phases).toEqual([ResolutionPhase.DirectCheck]);
    const finalize = events.find((e) => e.type === "finalize");
    expect(finalize).toMatchObject({ outcome: "direct", applicationUrl: "https://acme.com/careers/123" });
  });

  it("finalizes with not_found on a malformed URL", async () => {
    const { reporter, events } = makeStubReporter();
    await resolveApplicationUrl({ ...baseInput, originalUrl: "not a url", progressReporter: reporter });
    const directEnd = events.find((e) => e.type === "end" && e.stepIndex === 0);
    expect(directEnd?.status).toBe(StepStatus.Failed);
    const finalize = events.find((e) => e.type === "finalize");
    expect(finalize?.outcome).toBe("not_found");
  });

  it("emits acquire_container + finalize when no container is available", async () => {
    const { reporter, events } = makeStubReporter();
    vi.mocked(findFirstRunningContainer).mockResolvedValue(null);
    await resolveApplicationUrl({ ...baseInput, progressReporter: reporter });
    const phases = events.filter((e) => e.type === "start").map((e) => e.phase);
    expect(phases).toEqual([ResolutionPhase.DirectCheck, ResolutionPhase.AcquireContainer]);
    const acquireEnd = events.find((e) => e.type === "end" && e.phase === undefined && e.stepIndex === 1);
    expect(acquireEnd?.status).toBe(StepStatus.Failed);
    expect(events.find((e) => e.type === "finalize")?.outcome).toBe("not_found");
  });

  it("emits apply_button_decision succeeded + finalize for the redirect outcome", async () => {
    const { reporter, events } = makeStubReporter();
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41001 });
    await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: "https://acme.com/jobs/123/apply",
      progressReporter: reporter,
    });
    const phases = events.filter((e) => e.type === "start").map((e) => e.phase);
    expect(phases).toEqual([
      ResolutionPhase.DirectCheck,
      ResolutionPhase.AcquireContainer,
      ResolutionPhase.ApplyButtonScrape,
      ResolutionPhase.ApplyButtonDecision,
    ]);
    expect(events.find((e) => e.type === "finalize")).toMatchObject({ outcome: "resolved_via_redirect" });
  });

  it("emits apply_button_scrape skipped when caller supplied the apply button", async () => {
    const { reporter, events } = makeStubReporter();
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41001 });
    await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: "https://acme.com/jobs/123/apply",
      progressReporter: reporter,
    });
    // Step index 2 is the apply_button_scrape pair; its end event should be Skipped.
    const scrapeEnd = events.find((e) => e.type === "end" && e.stepIndex === 2);
    expect(scrapeEnd?.status).toBe(StepStatus.Skipped);
  });

  it("emits apply_button_scrape failed but continues to search on a re-scrape error", async () => {
    const { reporter, events } = makeStubReporter();
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41001 });
    vi.mocked(scrapeJobViaContainer).mockRejectedValueOnce(new Error("scrape boom"));
    vi.mocked(searchWeb).mockResolvedValue([]);
    await resolveApplicationUrl({ ...baseInput, progressReporter: reporter });
    const scrapeEnd = events.find((e) => e.type === "end" && e.stepIndex === 2);
    expect(scrapeEnd?.status).toBe(StepStatus.Failed);
    // Resolution still completed (with not_found, given the empty Brave result list).
    expect(events.find((e) => e.type === "finalize")?.outcome).toBe("not_found");
  });

  it("emits a candidate_scrape + candidate_evaluate pair per candidate and stops on match", async () => {
    const { reporter, events } = makeStubReporter();
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41001 });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "Acme Careers - SE", url: "https://acme.com/jobs/123", description: "Acme description" },
    ]);
    vi.mocked(scrapeJobViaContainer).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme",
      description: "Build cool things at Acme",
      salary: null,
      post_date: null,
      apply_button_url: null,
      is_job_description: true,
      reasoning: "ok",
    });
    vi.mocked(evaluateJobMatch).mockReturnValue({ matched: true, reason: "title matched" });

    await resolveApplicationUrl({
      ...baseInput,
      originalApplyButtonUrl: null,
      progressReporter: reporter,
    });

    const phases = events.filter((e) => e.type === "start").map((e) => e.phase);
    expect(phases).toContain(ResolutionPhase.CandidateScrape);
    expect(phases).toContain(ResolutionPhase.CandidateEvaluate);
    expect(events.find((e) => e.type === "finalize")).toMatchObject({ outcome: "resolved_via_search" });
  });

  it("emits candidate_scrape failed and continues to the next candidate", async () => {
    const { reporter, events } = makeStubReporter();
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41001 });
    vi.mocked(searchWeb).mockResolvedValue([
      { title: "Bad", url: "https://bad.com/job", description: "" },
      { title: "Good", url: "https://good.com/job", description: "" },
    ]);
    vi.mocked(scrapeJobViaContainer)
      .mockRejectedValueOnce(new Error("first candidate broken"))
      .mockResolvedValueOnce({
        title: "Software Engineer",
        company: "Acme",
        description: "Build cool things at Acme",
        salary: null,
        post_date: null,
        apply_button_url: null,
        is_job_description: true,
        reasoning: "ok",
      });
    vi.mocked(evaluateJobMatch).mockReturnValue({ matched: true, reason: "matched" });

    await resolveApplicationUrl({ ...baseInput, originalApplyButtonUrl: null, progressReporter: reporter });

    // First candidate's scrape step ends with Failed; the next candidate's pair runs and matches.
    const failedScrapes = events.filter((e) => e.type === "end" && e.status === StepStatus.Failed);
    expect(failedScrapes.length).toBeGreaterThan(0);
    expect(events.find((e) => e.type === "finalize")?.outcome).toBe("resolved_via_search");
  });

  it("emits build_query failed when company and title are empty", async () => {
    const { reporter, events } = makeStubReporter();
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41001 });
    await resolveApplicationUrl({
      ...baseInput,
      originalCompany: "",
      originalTitle: "",
      originalApplyButtonUrl: null,
      progressReporter: reporter,
    });
    const finalize = events.find((e) => e.type === "finalize");
    expect(finalize?.outcome).toBe("not_found");
    expect(finalize?.reason).toMatch(/empty/);
  });

  it("emits brave_search failed when the Brave API throws", async () => {
    const { reporter, events } = makeStubReporter();
    vi.mocked(findFirstRunningContainer).mockResolvedValue({ id: 1, hostPort: 41001 });
    vi.mocked(searchWeb).mockRejectedValue(new Error("brave down"));
    await resolveApplicationUrl({ ...baseInput, originalApplyButtonUrl: null, progressReporter: reporter });
    expect(events.find((e) => e.type === "finalize")?.outcome).toBe("not_found");
  });

  it("swallows progressReporter errors so a flaky sink never aborts the resolver", async () => {
    const reporter: ResolverProgressReporter = {
      startStep: vi.fn().mockRejectedValue(new Error("sink down")),
      endStep: vi.fn().mockRejectedValue(new Error("sink down")),
      finalize: vi.fn().mockRejectedValue(new Error("sink down")),
    };
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* swallow */ });

    const result = await resolveApplicationUrl({
      ...baseInput,
      originalUrl: "https://acme.com/careers",
      progressReporter: reporter,
    });

    expect(result.outcome.outcome).toBe("direct");
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });
});

describe("createContainerProgressReporter", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-05-18T12:00:00.000Z") });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("posts a 'running' step to /resolution-progress/:logId/step on startStep with a monotonic index", async () => {
    const reporter = createContainerProgressReporter(41001, 42);
    const firstIndex = await reporter.startStep(ResolutionPhase.DirectCheck, "first", { foo: 1 });
    const secondIndex = await reporter.startStep(ResolutionPhase.AcquireContainer, "second", {});
    expect(firstIndex).toBe(0);
    expect(secondIndex).toBe(1);

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstCallUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstCallUrl).toBe("http://127.0.0.1:41001/resolution-progress/42/step");
    const firstCallInit = fetchMock.mock.calls[0][1] as { method: string; body: string };
    const firstCallBody = JSON.parse(firstCallInit.body) as { phase: string; status: string; stepIndex: number };
    expect(firstCallBody).toMatchObject({ phase: "direct_check", status: "running", stepIndex: 0 });
  });

  it("posts a terminal-status step with merged payload and computed durationMs on endStep", async () => {
    const reporter = createContainerProgressReporter(41001, 42);
    const stepIndex = await reporter.startStep(ResolutionPhase.BraveSearch, "starting", { query: "Acme" });
    vi.advanceTimersByTime(2500);
    await reporter.endStep(stepIndex, StepStatus.Succeeded, "ok", { resultCount: 5 });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const endCallInit = fetchMock.mock.calls[1][1] as { body: string };
    const endCallBody = JSON.parse(endCallInit.body) as { status: string; durationMs: number; payload: { query: string; resultCount: number }; message: string };
    expect(endCallBody.status).toBe("succeeded");
    expect(endCallBody.durationMs).toBe(2500);
    expect(endCallBody.message).toBe("ok");
    // Payload from startStep is merged with the endStep payload.
    expect(endCallBody.payload).toMatchObject({ query: "Acme", resultCount: 5 });
  });

  it("posts to /finalize with the outcome, url, and reason on finalize", async () => {
    const reporter = createContainerProgressReporter(41001, 42);
    await reporter.finalize("resolved_via_search", "https://acme.com/jobs/1", null);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const finalizeUrl = fetchMock.mock.calls[0][0] as string;
    expect(finalizeUrl).toBe("http://127.0.0.1:41001/resolution-progress/42/finalize");
    const finalizeBody = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as { finalOutcome: string; finalApplicationUrl: string };
    expect(finalizeBody).toMatchObject({ finalOutcome: "resolved_via_search", finalApplicationUrl: "https://acme.com/jobs/1" });
  });

  it("swallows network errors and logs a warning", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* swallow */ });

    const reporter = createContainerProgressReporter(41001, 42);
    await expect(reporter.startStep(ResolutionPhase.DirectCheck, "hi", {})).resolves.toBe(0);

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringMatching(/POST \/step failed for log=42: connection refused/));
    consoleWarnSpy.mockRestore();
  });

  it("falls back to the start message when endStep is called without an override", async () => {
    const reporter = createContainerProgressReporter(41001, 42);
    const stepIndex = await reporter.startStep(ResolutionPhase.Finalize, "start-msg", { a: 1 });
    await reporter.endStep(stepIndex, StepStatus.Succeeded);

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const endCallBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body) as { message: string };
    expect(endCallBody.message).toBe("start-msg");
  });

  it("uses default values when endStep is called without a known stepIndex", async () => {
    const reporter = createContainerProgressReporter(41001, 42);
    // endStep with an unknown step index (no matching startStep) — exercises the
    // fallback branches that default phase to finalize and durationMs to null.
    await reporter.endStep(99, StepStatus.Failed, "oops", { foo: 1 });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as { phase: string; durationMs: number | null; payload: Record<string, unknown> };
    expect(body.phase).toBe("finalize");
    expect(body.durationMs).toBeNull();
    expect(body.payload).toMatchObject({ foo: 1 });
  });
});
