import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prismaClient.js", () => ({
  default: {
    gmailConnection: { findFirst: vi.fn() },
    jobListing: { findMany: vi.fn(), create: vi.fn() },
    discoveredJob: {
      // findUnique is still used by importDiscoveries / dismiss / restore
      // (which read by primary id), but the scan path now uses findMany.
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const { getFirstConnIdMock, listMsgsMock, fetchMsgMock } = vi.hoisted(() => ({
  getFirstConnIdMock: vi.fn(),
  listMsgsMock: vi.fn(),
  fetchMsgMock: vi.fn(),
}));
vi.mock("./gmailMessageReaderService.js", () => ({
  getFirstConnectionId: getFirstConnIdMock,
  listJobKeywordMessages: listMsgsMock,
  fetchMessage: fetchMsgMock,
}));

const { extractMock } = vi.hoisted(() => ({ extractMock: vi.fn() }));
vi.mock("./jobDiscoveryExtractorService.js", () => ({
  extractFromMessage: extractMock,
}));

const { findExistingMatchMock } = vi.hoisted(() => ({
  findExistingMatchMock: vi.fn(),
}));
vi.mock("./jobListingMatchService.js", async () => {
  // Import the real module so normalizeForMatch is the real impl
  // (used inside importDiscoveries' sibling-refresh logic).
  const actualModule = await vi.importActual<
    typeof import("./jobListingMatchService.js")
  >("./jobListingMatchService.js");
  return {
    normalizeForMatch: actualModule.normalizeForMatch,
    findExistingJobListingByCompanyTitle: findExistingMatchMock,
  };
});

import prisma from "../prismaClient.js";
import {
  scanInbox,
  listDiscoveries,
  importDiscoveries,
  dismissDiscovery,
  restoreDiscovery,
  processWithConcurrency,
} from "./discoveredJobsService.js";

/**
 * Builds a GmailMessageSummary fixture suitable for fetchMessage's mocked
 * resolved value. Defaults match a single LinkedIn-style email.
 */
function buildGmailMessageSummary(overrides: Partial<{
  messageId: string;
  threadId: string | null;
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string | null;
  receivedAt: Date;
  bodyHtml: string | null;
  bodyText: string | null;
}> = {}) {
  return {
    messageId: overrides.messageId ?? "gmail-msg-1",
    threadId: overrides.threadId ?? "thread-1",
    fromName: overrides.fromName ?? "LinkedIn Jobs",
    fromAddress: overrides.fromAddress ?? "jobs-noreply@linkedin.com",
    subject: overrides.subject ?? "5 new jobs match your search",
    snippet: overrides.snippet ?? "We found new openings",
    receivedAt: overrides.receivedAt ?? new Date("2026-05-22T10:00:00.000Z"),
    bodyHtml: overrides.bodyHtml ?? "<html>...</html>",
    bodyText: overrides.bodyText ?? "plain text",
  };
}

/**
 * Builds an ExtractedJob fixture. Defaults to a single Senior Engineer
 * posting from Acme Corp.
 */
function buildExtractedJob(overrides: Partial<{
  title: string;
  company: string;
  jobUrl: string;
  location: string | null;
  salary: string | null;
  description: string | null;
  confidence: number;
}> = {}) {
  // Use `in`-checks for nullable fields so an explicit `location: null`
  // override is honored (a plain `??` would coerce null back to the default).
  const resolvedLocation = "location" in overrides ? overrides.location : "Remote";
  return {
    title: overrides.title ?? "Senior Engineer",
    company: overrides.company ?? "Acme Corp",
    jobUrl: overrides.jobUrl ?? "https://example.com/job/1",
    location: resolvedLocation ?? null,
    salary: overrides.salary ?? "$150k-$200k",
    description: overrides.description ?? "Job description",
    confidence: overrides.confidence ?? 0.9,
  };
}

/**
 * Builds a DiscoveredJob row fixture as returned by Prisma. Used to mock
 * findUnique / findMany / upsert. `created_date` and `updated_date` default
 * to the same Date so the row is treated as "newly inserted" by scanInbox.
 */
function buildDiscoveredJobRow(overrides: Partial<{
  id: number;
  gmail_connection_id: number;
  email_message_id: string;
  email_thread_id: string | null;
  email_from_name: string;
  email_from_address: string;
  email_subject: string;
  email_snippet: string | null;
  email_received_at: Date;
  email_label_color: string | null;
  title: string;
  company: string;
  job_url: string;
  location: string | null;
  salary: string | null;
  description: string | null;
  status: "pending" | "imported" | "duplicate" | "dismissed";
  imported_job_listing_id: number | null;
  duplicate_of_job_id: number | null;
  confidence: number;
  created_date: Date;
  updated_date: Date;
}> = {}) {
  const baseDate = new Date("2026-05-22T10:00:00.000Z");
  const baseRow = {
    id: 1,
    gmail_connection_id: 1,
    email_message_id: "gmail-msg-1",
    email_thread_id: "thread-1" as string | null,
    email_from_name: "LinkedIn Jobs",
    email_from_address: "jobs-noreply@linkedin.com",
    email_subject: "5 new jobs match your search",
    email_snippet: "We found new openings" as string | null,
    email_received_at: baseDate,
    email_label_color: "#0a66c2" as string | null,
    title: "Senior Engineer",
    company: "Acme Corp",
    job_url: "https://example.com/job/1",
    location: "Remote" as string | null,
    salary: "$150k-$200k" as string | null,
    description: "Job description" as string | null,
    status: "pending" as "pending" | "imported" | "duplicate" | "dismissed",
    imported_job_listing_id: null as number | null,
    duplicate_of_job_id: null as number | null,
    confidence: 0.9,
    created_date: baseDate,
    updated_date: baseDate,
  };
  return { ...baseRow, ...overrides };
}

/**
 * Builds a JobListing row fixture for the `duplicate_of_job` /
 * `imported_job_listing` relations on listDiscoveries.
 */
function buildJobListingRow(overrides: Partial<{
  id: number;
  title: string | null;
  company: string | null;
  url: string;
  status: "init" | "applying" | "applied" | "error_applying" | "closed" | "missing_form_url";
}> = {}) {
  const baseRow = {
    id: 1,
    title: "Senior Engineer" as string | null,
    company: "Acme Corp" as string | null,
    url: "https://example.com/job/1",
    application_url: null,
    description: null,
    salary: null,
    location: null,
    live_url: null,
    status: "init" as
      | "init"
      | "applying"
      | "applied"
      | "error_applying"
      | "closed"
      | "missing_form_url",
    post_date: null,
    created_date: new Date("2026-05-22T10:00:00.000Z"),
  };
  return { ...baseRow, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  getFirstConnIdMock.mockReset();
  listMsgsMock.mockReset();
  fetchMsgMock.mockReset();
  extractMock.mockReset();
  findExistingMatchMock.mockReset();
});

describe("scanInbox", () => {
  it("returns zero counts when the inbox has no matching messages", async () => {
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue([]);

    const result = await scanInbox({ days: 7 });

    expect(result).toEqual({ scanned: 0, found: 0, newDiscoveries: 0 });
    expect(fetchMsgMock).not.toHaveBeenCalled();
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("creates two rows and counts two newDiscoveries when one email yields two jobs", async () => {
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    const message = buildGmailMessageSummary({ messageId: "gmail-msg-1" });
    fetchMsgMock.mockResolvedValue(message);
    const firstJob = buildExtractedJob({
      jobUrl: "https://example.com/job/1",
      title: "Senior Engineer",
    });
    const secondJob = buildExtractedJob({
      jobUrl: "https://example.com/job/2",
      title: "Staff Engineer",
    });
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [firstJob, secondJob],
    });
    findExistingMatchMock.mockResolvedValue(null);
    // findMany returns no candidates for both jobs → CREATE path.
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([]);
    vi.mocked(prisma.discoveredJob.create).mockResolvedValueOnce(
      buildDiscoveredJobRow({ id: 10, job_url: firstJob.jobUrl, title: firstJob.title })
    );
    vi.mocked(prisma.discoveredJob.create).mockResolvedValueOnce(
      buildDiscoveredJobRow({ id: 11, job_url: secondJob.jobUrl, title: secondJob.title })
    );

    const result = await scanInbox({ days: 7 });

    expect(result).toEqual({ scanned: 1, found: 2, newDiscoveries: 2 });
    expect(prisma.discoveredJob.create).toHaveBeenCalledTimes(2);
  });

  it("counts zero newDiscoveries on a re-scan that only updates existing rows", async () => {
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    const message = buildGmailMessageSummary();
    fetchMsgMock.mockResolvedValue(message);
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [buildExtractedJob()],
    });
    findExistingMatchMock.mockResolvedValue(null);
    // findMany returns an existing candidate row → UPDATE path (no new discovery).
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([
      buildDiscoveredJobRow({
        id: 5,
        status: "pending",
        created_date: new Date("2026-05-20T10:00:00.000Z"),
        updated_date: new Date("2026-05-22T10:00:00.000Z"),
      }),
    ]);
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(
      buildDiscoveredJobRow({ id: 5 })
    );

    const result = await scanInbox({ days: 7 });

    expect(result).toEqual({ scanned: 1, found: 1, newDiscoveries: 0 });
    expect(prisma.discoveredJob.create).not.toHaveBeenCalled();
    expect(prisma.discoveredJob.update).toHaveBeenCalledTimes(1);
  });

  it("creates the row with status=duplicate and duplicate_of_job_id when a JobListing matches", async () => {
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    fetchMsgMock.mockResolvedValue(buildGmailMessageSummary());
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [buildExtractedJob()],
    });
    const matchingJobListing = buildJobListingRow({ id: 42 });
    findExistingMatchMock.mockResolvedValue(matchingJobListing);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([]);
    vi.mocked(prisma.discoveredJob.create).mockResolvedValue(
      buildDiscoveredJobRow({ status: "duplicate", duplicate_of_job_id: 42 })
    );

    await scanInbox({ days: 7 });

    const createCall = vi.mocked(prisma.discoveredJob.create).mock.calls[0]?.[0];
    expect(createCall?.data.status).toBe("duplicate");
    expect(createCall?.data.duplicate_of_job_id).toBe(42);
  });

  it("looks up within-email candidates via findMany scoped to (connection, message)", async () => {
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    fetchMsgMock.mockResolvedValue(buildGmailMessageSummary({ messageId: "gmail-msg-1" }));
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [
        buildExtractedJob({
          company: "Acme Corp",
          title: "Senior Engineer",
        }),
      ],
    });
    findExistingMatchMock.mockResolvedValue(null);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([]);
    vi.mocked(prisma.discoveredJob.create).mockResolvedValue(buildDiscoveredJobRow());

    await scanInbox({ days: 7 });

    // Scan path's findMany is scoped to (connection_id, message_id). The
    // (company, title, location) filter is applied in JS via normalizeForMatch.
    const findManyCall = vi.mocked(prisma.discoveredJob.findMany).mock.calls[0]?.[0];
    expect(findManyCall?.where).toEqual({
      gmail_connection_id: 1,
      email_message_id: "gmail-msg-1",
    });
  });

  it("skips a row whose extracted company is empty without inserting anything", async () => {
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    fetchMsgMock.mockResolvedValue(buildGmailMessageSummary());
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [buildExtractedJob({ company: "   " })],
    });

    const result = await scanInbox({ days: 7 });

    expect(result).toEqual({ scanned: 1, found: 1, newDiscoveries: 0 });
    // The scan path bails out before querying DB candidates when company/title
    // is empty, so findMany should not be invoked.
    expect(prisma.discoveredJob.findMany).not.toHaveBeenCalled();
    expect(prisma.discoveredJob.create).not.toHaveBeenCalled();
  });

  it("skips a row whose extracted title is empty without inserting anything", async () => {
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    fetchMsgMock.mockResolvedValue(buildGmailMessageSummary());
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [buildExtractedJob({ title: "" })],
    });

    const result = await scanInbox({ days: 7 });

    expect(result).toEqual({ scanned: 1, found: 1, newDiscoveries: 0 });
    expect(prisma.discoveredJob.create).not.toHaveBeenCalled();
  });

  it("light-normalizes title + company before writing (trim + collapse whitespace, keeps case)", async () => {
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    fetchMsgMock.mockResolvedValue(buildGmailMessageSummary());
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [
        buildExtractedJob({
          company: "  Acme   Corp  ",
          title: "  Senior  Software  Engineer  ",
        }),
      ],
    });
    findExistingMatchMock.mockResolvedValue(null);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([]);
    vi.mocked(prisma.discoveredJob.create).mockResolvedValue(buildDiscoveredJobRow());

    await scanInbox({ days: 7 });

    const createCall = vi.mocked(prisma.discoveredJob.create).mock.calls[0]?.[0];
    expect(createCall?.data.company).toBe("Acme Corp");
    expect(createCall?.data.title).toBe("Senior Software Engineer");
  });

  it("auto-flips pending → duplicate on re-scan when a JobListing has since appeared (location wildcard merge)", async () => {
    // Existing row stored with location=null; new extracted job has a valid
    // location. Under either-null-wildcard rules, this is the same job and
    // we merge into the existing row, AND auto-flip pending → duplicate
    // because findExistingJobListingByCompanyTitle now returns a match.
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    fetchMsgMock.mockResolvedValue(buildGmailMessageSummary());
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [buildExtractedJob({ location: "Remote" })],
    });
    findExistingMatchMock.mockResolvedValue(buildJobListingRow({ id: 99 }));
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([
      buildDiscoveredJobRow({ id: 5, status: "pending", location: null }),
    ]);
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(
      buildDiscoveredJobRow({ id: 5, status: "duplicate", duplicate_of_job_id: 99 })
    );

    await scanInbox({ days: 7 });

    const updateCall = vi.mocked(prisma.discoveredJob.update).mock.calls[0]?.[0];
    expect(updateCall?.where).toEqual({ id: 5 });
    expect(updateCall?.data.status).toBe("duplicate");
    expect(updateCall?.data.duplicate_of_job_id).toBe(99);
    // Location is promoted from null → "Remote" on the existing row.
    expect(updateCall?.data.location).toBe("Remote");
  });

  it("preserves status=imported on re-scan even when a JobListing matches", async () => {
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    fetchMsgMock.mockResolvedValue(buildGmailMessageSummary());
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [buildExtractedJob()],
    });
    findExistingMatchMock.mockResolvedValue(buildJobListingRow({ id: 99 }));
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([
      buildDiscoveredJobRow({
        id: 5,
        status: "imported",
        imported_job_listing_id: 99,
      }),
    ]);
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(buildDiscoveredJobRow({ id: 5 }));

    await scanInbox({ days: 7 });

    const updateCall = vi.mocked(prisma.discoveredJob.update).mock.calls[0]?.[0];
    // No `status` key on the update payload — the imported status survives.
    expect(updateCall?.data).not.toHaveProperty("status");
    expect(updateCall?.data).not.toHaveProperty("imported_job_listing_id");
  });

  it("within-email merge: new location=null + existing valid location → existing preserved, no overwrite", async () => {
    // Extracted job omits location; existing row already has "New York".
    // pickMergeTarget should pick the existing row (wildcard absorbs into
    // specific) and the update must NOT overwrite location with null.
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    fetchMsgMock.mockResolvedValue(buildGmailMessageSummary());
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [buildExtractedJob({ location: null })],
    });
    findExistingMatchMock.mockResolvedValue(null);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([
      buildDiscoveredJobRow({
        id: 7,
        status: "pending",
        location: "New York",
      }),
    ]);
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(
      buildDiscoveredJobRow({ id: 7, location: "New York" })
    );

    const result = await scanInbox({ days: 7 });

    expect(result.newDiscoveries).toBe(0);
    expect(prisma.discoveredJob.create).not.toHaveBeenCalled();
    expect(prisma.discoveredJob.update).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(prisma.discoveredJob.update).mock.calls[0]?.[0];
    expect(updateCall?.where).toEqual({ id: 7 });
    expect(updateCall?.data.location).toBe("New York");
  });

  it("within-email merge: new location valid + existing null location → existing updated, location promoted", async () => {
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    fetchMsgMock.mockResolvedValue(buildGmailMessageSummary());
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [buildExtractedJob({ location: "San Francisco" })],
    });
    findExistingMatchMock.mockResolvedValue(null);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([
      buildDiscoveredJobRow({
        id: 8,
        status: "pending",
        location: null,
      }),
    ]);
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(
      buildDiscoveredJobRow({ id: 8, location: "San Francisco" })
    );

    const result = await scanInbox({ days: 7 });

    expect(result.newDiscoveries).toBe(0);
    expect(prisma.discoveredJob.create).not.toHaveBeenCalled();
    expect(prisma.discoveredJob.update).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(prisma.discoveredJob.update).mock.calls[0]?.[0];
    expect(updateCall?.where).toEqual({ id: 8 });
    expect(updateCall?.data.location).toBe("San Francisco");
  });

  it("within-email separate rows: both locations valid and differ → create a new row", async () => {
    // Existing row has location="Remote"; new extracted job has
    // location="New York". Neither side is wildcard, locations don't match.
    // pickMergeTarget must return null → CREATE branch.
    getFirstConnIdMock.mockResolvedValue(1);
    listMsgsMock.mockResolvedValue(["gmail-msg-1"]);
    fetchMsgMock.mockResolvedValue(buildGmailMessageSummary());
    extractMock.mockResolvedValue({
      extractor: "claude-haiku-4-5",
      jobs: [buildExtractedJob({ location: "New York" })],
    });
    findExistingMatchMock.mockResolvedValue(null);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([
      buildDiscoveredJobRow({ id: 9, status: "pending", location: "Remote" }),
    ]);
    vi.mocked(prisma.discoveredJob.create).mockResolvedValue(
      buildDiscoveredJobRow({ id: 10, location: "New York" })
    );

    const result = await scanInbox({ days: 7 });

    expect(result.newDiscoveries).toBe(1);
    expect(prisma.discoveredJob.create).toHaveBeenCalledTimes(1);
    expect(prisma.discoveredJob.update).not.toHaveBeenCalled();
    const createCall = vi.mocked(prisma.discoveredJob.create).mock.calls[0]?.[0];
    expect(createCall?.data.location).toBe("New York");
  });
});

describe("listDiscoveries", () => {
  it("maps rows to PublicDiscoveredJob including gmailUrl, duplicateOf, importedAs", async () => {
    const duplicateOfListing = buildJobListingRow({
      id: 100,
      title: "Senior Engineer",
      status: "applied",
    });
    const importedListing = buildJobListingRow({
      id: 200,
      title: "Staff Engineer",
      status: "applying",
    });
    const rowWithDuplicateRelation = {
      ...buildDiscoveredJobRow({
        id: 1,
        duplicate_of_job_id: 100,
        email_message_id: "msg-A",
      }),
      duplicate_of_job: duplicateOfListing,
      imported_job_listing: null,
    };
    const rowWithImportedRelation = {
      ...buildDiscoveredJobRow({
        id: 2,
        status: "imported",
        imported_job_listing_id: 200,
        email_message_id: "msg-B",
      }),
      duplicate_of_job: null,
      imported_job_listing: importedListing,
    };
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([
      rowWithDuplicateRelation,
      rowWithImportedRelation,
    ] as unknown as never);

    const result = await listDiscoveries({ days: 14 });

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(1);
    expect(result[0]?.email.gmailUrl).toBe(
      "https://mail.google.com/mail/u/0/#inbox/msg-A"
    );
    expect(result[0]?.duplicateOf).toEqual({
      jobListingId: 100,
      title: "Senior Engineer",
      status: "applied",
    });
    expect(result[0]?.importedAs).toBeNull();
    expect(result[1]?.duplicateOf).toBeNull();
    expect(result[1]?.importedAs).toEqual({
      jobListingId: 200,
      title: "Staff Engineer",
      status: "applying",
    });

    // Verify the query shape (where + include + orderBy)
    const findManyCall = vi.mocked(prisma.discoveredJob.findMany).mock.calls[0]?.[0];
    expect(findManyCall?.include).toEqual({
      duplicate_of_job: true,
      imported_job_listing: true,
    });
    expect(findManyCall?.orderBy).toEqual({ email_received_at: "desc" });
  });

  it("applies the status filter when provided", async () => {
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([]);

    await listDiscoveries({ days: 14, status: "pending" });

    const findManyCall = vi.mocked(prisma.discoveredJob.findMany).mock.calls[0]?.[0];
    expect(findManyCall?.where).toMatchObject({ status: "pending" });
  });

  it("omits the status filter when not provided", async () => {
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([]);

    await listDiscoveries({ days: 14 });

    const findManyCall = vi.mocked(prisma.discoveredJob.findMany).mock.calls[0]?.[0];
    expect(findManyCall?.where).not.toHaveProperty("status");
  });

  it("falls back to empty string when the related JobListing has a null title", async () => {
    // Exercises the `relatedJobListing.title ?? ''` defensive fallback in
    // buildJobListingReference — historically possible since JobListing.title
    // is nullable.
    const duplicateOfWithNullTitle = buildJobListingRow({
      id: 300,
      title: null,
      status: "init",
    });
    const rowWithNullTitleRef = {
      ...buildDiscoveredJobRow({
        id: 99,
        duplicate_of_job_id: 300,
        email_message_id: "msg-Z",
      }),
      duplicate_of_job: duplicateOfWithNullTitle,
      imported_job_listing: null,
    };
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([rowWithNullTitleRef] as unknown as never);

    const result = await listDiscoveries({ days: 14 });

    expect(result[0]?.duplicateOf?.title).toBe("");
  });
});

describe("importDiscoveries", () => {
  /**
   * Helper that wires `prisma.$transaction` to invoke its callback with a
   * `tx` object whose methods proxy through to the mocked prisma client.
   * The callback's resolved value is returned by $transaction, matching the
   * real Prisma behavior.
   */
  function wireTransactionPassthrough() {
    vi.mocked(prisma.$transaction).mockImplementation(
      async (callback: unknown) => {
        const tx = {
          jobListing: prisma.jobListing,
          discoveredJob: prisma.discoveredJob,
        } as unknown as Parameters<typeof callback extends (arg: infer A) => unknown ? (arg: A) => unknown : never>[0];
        // Cast through unknown because Prisma's $transaction overload set is large.
        return await (callback as (txArg: unknown) => Promise<unknown>)(tx);
      }
    );
  }

  it("happy path: creates a JobListing and flips the discovery to imported", async () => {
    const pendingRow = buildDiscoveredJobRow({
      id: 1,
      status: "pending",
      duplicate_of_job_id: null,
    });
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(pendingRow);
    const newJobListing = buildJobListingRow({ id: 500 });
    vi.mocked(prisma.jobListing.create).mockResolvedValue(newJobListing);
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(pendingRow);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([]);
    wireTransactionPassthrough();

    const result = await importDiscoveries([1]);

    expect(result.imported).toEqual([{ discoveryId: 1, jobListingId: 500 }]);
    expect(result.failed).toEqual([]);
    expect(result.duplicates).toEqual([]);

    const createCall = vi.mocked(prisma.jobListing.create).mock.calls[0]?.[0];
    expect(createCall?.data).toMatchObject({
      url: pendingRow.job_url,
      title: pendingRow.title,
      company: pendingRow.company,
      status: "init",
    });
    const updateCall = vi.mocked(prisma.discoveredJob.update).mock.calls[0]?.[0];
    expect(updateCall?.data).toMatchObject({
      status: "imported",
      imported_job_listing_id: 500,
    });
  });

  it("flips sibling pending rows with matching (company, title) to duplicate_of_job_id", async () => {
    const importedRow = buildDiscoveredJobRow({
      id: 1,
      title: "Senior Engineer",
      company: "Acme Corp",
    });
    const matchingSibling = buildDiscoveredJobRow({
      id: 2,
      title: "senior engineer", // case-different but matches under normalize
      company: "ACME corp",
      job_url: "https://other.example.com/job/2",
    });
    const nonMatchingSibling = buildDiscoveredJobRow({
      id: 3,
      title: "Junior Engineer",
      company: "OtherCo",
    });
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(importedRow);
    const newJobListing = buildJobListingRow({ id: 999 });
    vi.mocked(prisma.jobListing.create).mockResolvedValue(newJobListing);
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(importedRow);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([
      matchingSibling,
      nonMatchingSibling,
    ]);
    vi.mocked(prisma.discoveredJob.updateMany).mockResolvedValue({ count: 1 });
    wireTransactionPassthrough();

    await importDiscoveries([1]);

    const updateManyCall = vi.mocked(prisma.discoveredJob.updateMany).mock.calls[0]?.[0];
    expect(updateManyCall?.where).toEqual({ id: { in: [2] } });
    expect(updateManyCall?.data).toEqual({
      status: "duplicate",
      duplicate_of_job_id: 999,
    });
  });

  it("flips a sibling with null location when imported row has a valid location (wildcard rule)", async () => {
    const importedRow = buildDiscoveredJobRow({
      id: 1,
      title: "Senior Engineer",
      company: "Acme Corp",
      location: "Remote",
    });
    // Sibling has matching (company, title) but a NULL location. Either-null-
    // wildcard rule says this still matches → it should be flipped.
    const wildcardSibling = buildDiscoveredJobRow({
      id: 2,
      title: "Senior Engineer",
      company: "Acme Corp",
      location: null,
    });
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(importedRow);
    vi.mocked(prisma.jobListing.create).mockResolvedValue(buildJobListingRow({ id: 555 }));
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(importedRow);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([wildcardSibling]);
    vi.mocked(prisma.discoveredJob.updateMany).mockResolvedValue({ count: 1 });
    wireTransactionPassthrough();

    await importDiscoveries([1]);

    const updateManyCall = vi.mocked(prisma.discoveredJob.updateMany).mock.calls[0]?.[0];
    expect(updateManyCall?.where).toEqual({ id: { in: [2] } });
    expect(updateManyCall?.data).toEqual({
      status: "duplicate",
      duplicate_of_job_id: 555,
    });
  });

  it("does NOT flip a sibling whose valid location DIFFERS from the imported row", async () => {
    const importedRow = buildDiscoveredJobRow({
      id: 1,
      title: "Senior Engineer",
      company: "Acme Corp",
      location: "Remote",
    });
    // Sibling has matching (company, title) but a DIFFERENT valid location.
    // Neither side is wildcard, locations don't match → no flip.
    const conflictingLocationSibling = buildDiscoveredJobRow({
      id: 2,
      title: "Senior Engineer",
      company: "Acme Corp",
      location: "New York",
    });
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(importedRow);
    vi.mocked(prisma.jobListing.create).mockResolvedValue(buildJobListingRow({ id: 555 }));
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(importedRow);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([conflictingLocationSibling]);
    wireTransactionPassthrough();

    await importDiscoveries([1]);

    expect(prisma.discoveredJob.updateMany).not.toHaveBeenCalled();
  });

  it("does NOT call updateMany when no sibling rows match", async () => {
    const importedRow = buildDiscoveredJobRow({ id: 1 });
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(importedRow);
    vi.mocked(prisma.jobListing.create).mockResolvedValue(buildJobListingRow({ id: 7 }));
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(importedRow);
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValue([]);
    wireTransactionPassthrough();

    await importDiscoveries([1]);

    expect(prisma.discoveredJob.updateMany).not.toHaveBeenCalled();
  });

  it("returns the id in duplicates (NOT imported) when duplicate_of_job_id is already set", async () => {
    const flaggedRow = buildDiscoveredJobRow({
      id: 5,
      status: "pending",
      duplicate_of_job_id: 77,
    });
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(flaggedRow);
    wireTransactionPassthrough();

    const result = await importDiscoveries([5]);

    expect(result.duplicates).toEqual([{ discoveryId: 5, jobListingId: 77 }]);
    expect(result.imported).toEqual([]);
    expect(prisma.jobListing.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns an unknown id in failed with reason 'not found'", async () => {
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(null);

    const result = await importDiscoveries([999]);

    expect(result.failed).toEqual([{ discoveryId: 999, reason: "not found" }]);
    expect(result.imported).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns an already-imported id in failed with reason 'already imported'", async () => {
    const importedRow = buildDiscoveredJobRow({ id: 8, status: "imported" });
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(importedRow);

    const result = await importDiscoveries([8]);

    expect(result.failed).toEqual([
      { discoveryId: 8, reason: "already imported" },
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("dismissDiscovery", () => {
  it("flips a pending row to dismissed", async () => {
    const pendingRow = buildDiscoveredJobRow({ id: 1, status: "pending" });
    const dismissedRow = { ...pendingRow, status: "dismissed" as const };
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(pendingRow);
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(dismissedRow);

    const result = await dismissDiscovery(1);

    expect(result.status).toBe("dismissed");
    const updateCall = vi.mocked(prisma.discoveredJob.update).mock.calls[0]?.[0];
    expect(updateCall?.data).toEqual({ status: "dismissed" });
  });

  it("throws when the row does not exist", async () => {
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(null);
    await expect(dismissDiscovery(99)).rejects.toThrow(/not found/);
  });

  it("throws when the row is already imported", async () => {
    const importedRow = buildDiscoveredJobRow({ id: 1, status: "imported" });
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(importedRow);
    await expect(dismissDiscovery(1)).rejects.toThrow(/imported/);
    expect(prisma.discoveredJob.update).not.toHaveBeenCalled();
  });
});

describe("restoreDiscovery", () => {
  it("flips a dismissed row back to pending", async () => {
    const dismissedRow = buildDiscoveredJobRow({ id: 1, status: "dismissed" });
    const restoredRow = { ...dismissedRow, status: "pending" as const };
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(dismissedRow);
    vi.mocked(prisma.discoveredJob.update).mockResolvedValue(restoredRow);

    const result = await restoreDiscovery(1);

    expect(result.status).toBe("pending");
    const updateCall = vi.mocked(prisma.discoveredJob.update).mock.calls[0]?.[0];
    expect(updateCall?.data).toEqual({ status: "pending" });
  });

  it("throws when restoring an imported row", async () => {
    const importedRow = buildDiscoveredJobRow({ id: 1, status: "imported" });
    vi.mocked(prisma.discoveredJob.findUnique).mockResolvedValue(importedRow);
    await expect(restoreDiscovery(1)).rejects.toThrow(/imported/);
  });
});

describe("processWithConcurrency", () => {
  it("never runs more than `concurrencyLimit` workers in parallel", async () => {
    let activeWorkerCount = 0;
    let observedPeakConcurrency = 0;

    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const concurrencyLimit = 3;

    /**
     * Each worker increments the live counter on entry, awaits a fake-timer
     * tick, then decrements on exit. The peak observed count is asserted
     * against the configured limit.
     */
    async function worker(_item: number): Promise<number> {
      activeWorkerCount += 1;
      if (activeWorkerCount > observedPeakConcurrency) {
        observedPeakConcurrency = activeWorkerCount;
      }
      // Yield two microtasks so all currently-launched workers have a chance
      // to enter their critical section before any of them finish.
      await Promise.resolve();
      await Promise.resolve();
      activeWorkerCount -= 1;
      return _item * 2;
    }

    const results = await processWithConcurrency(items, concurrencyLimit, worker);

    expect(observedPeakConcurrency).toBeLessThanOrEqual(concurrencyLimit);
    expect(observedPeakConcurrency).toBeGreaterThan(0);
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it("preserves input order in the results array even with parallel completion", async () => {
    const items = ["a", "b", "c"];
    /**
     * Earlier items take longer than later items, so completion order is
     * the reverse of input order. The result array must still be in input
     * order.
     */
    async function worker(item: string, index: number): Promise<string> {
      const delayMs = (items.length - index) * 5;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return item.toUpperCase();
    }

    const results = await processWithConcurrency(items, 3, worker);

    expect(results).toEqual(["A", "B", "C"]);
  });

  it("returns an empty array when given no items", async () => {
    const workerSpy = vi.fn();
    const results = await processWithConcurrency([], 3, workerSpy);
    expect(results).toEqual([]);
    expect(workerSpy).not.toHaveBeenCalled();
  });
});
