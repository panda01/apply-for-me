import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prismaClient.js", () => ({
  default: {
    jobListing: {
      findMany: vi.fn(),
    },
  },
}));

import prisma from "../prismaClient.js";
import {
  normalizeForMatch,
  findExistingJobListingByCompanyTitle,
} from "./jobListingMatchService.js";

/**
 * Minimal JobListing fixture matching what Prisma would return on findMany.
 * Only fields read by the matcher are populated meaningfully.
 */
function buildJobListingRow(overrides: Partial<{
  id: number;
  title: string | null;
  company: string | null;
  url: string;
  location: string | null;
}>) {
  // Use the `in overrides` check (not ??) so explicit null/empty overrides
  // are honored instead of falling back to the default.
  const baseRow = {
    id: 1,
    title: "Senior Engineer" as string | null,
    company: "Acme Corp" as string | null,
    url: "https://example.com/job/1",
    application_url: null,
    description: null,
    salary: null,
    location: null,
    // Structured Remote/On-Site/Hybrid classification; null = unknown. The
    // matcher never reads it, but the Prisma JobListing row type requires it.
    work_arrangement: null,
    live_url: null,
    status: "init" as const,
    post_date: null,
    created_date: new Date("2026-05-23T17:00:00.000Z"),
  };
  return { ...baseRow, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeForMatch", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeForMatch("  acme  ")).toBe("acme");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeForMatch("acme    corp")).toBe("acme corp");
  });

  it("lowercases the value", () => {
    expect(normalizeForMatch("Acme Corp")).toBe("acme corp");
  });

  it("collapses all three transformations together", () => {
    expect(normalizeForMatch("  Acme   CORP  ")).toBe("acme corp");
  });

  it("handles empty input by returning empty string", () => {
    expect(normalizeForMatch("")).toBe("");
  });

  it("handles whitespace-only input by returning empty string", () => {
    expect(normalizeForMatch("   ")).toBe("");
  });
});

describe("findExistingJobListingByCompanyTitle", () => {
  it("returns a matching row case-insensitively", async () => {
    const matchingRow = buildJobListingRow({
      id: 7,
      company: "Acme Corp",
      title: "Senior Engineer",
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([matchingRow]);

    const result = await findExistingJobListingByCompanyTitle(
      "acme corp",
      "senior engineer",
      null
    );

    expect(result?.id).toBe(7);
  });

  it("returns null when the input company is an empty string", async () => {
    const result = await findExistingJobListingByCompanyTitle("", "Senior Engineer", null);

    expect(result).toBeNull();
    expect(prisma.jobListing.findMany).not.toHaveBeenCalled();
  });

  it("returns null when the input company is only whitespace", async () => {
    const result = await findExistingJobListingByCompanyTitle("   ", "Senior Engineer", null);

    expect(result).toBeNull();
    expect(prisma.jobListing.findMany).not.toHaveBeenCalled();
  });

  it("returns null when no row matches", async () => {
    const nonMatchingRow = buildJobListingRow({
      id: 1,
      company: "Other Co",
      title: "Junior Engineer",
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([nonMatchingRow]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      null
    );

    expect(result).toBeNull();
  });

  it("skips rows where company is null (treated as 'unknown')", async () => {
    // Even though the query filter excludes null companies, this asserts the
    // app-side filter is also defensive against any rows that slip through.
    const rowWithNullCompany = buildJobListingRow({
      id: 1,
      company: null,
      title: "Senior Engineer",
    });
    const matchingRow = buildJobListingRow({
      id: 2,
      company: "Acme Corp",
      title: "Senior Engineer",
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([
      rowWithNullCompany,
      matchingRow,
    ]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      null
    );

    expect(result?.id).toBe(2);
  });

  it("skips rows where company is an empty string (treated as 'unknown')", async () => {
    const rowWithEmptyCompany = buildJobListingRow({
      id: 1,
      company: "",
      title: "Senior Engineer",
    });
    const matchingRow = buildJobListingRow({
      id: 2,
      company: "Acme Corp",
      title: "Senior Engineer",
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([
      rowWithEmptyCompany,
      matchingRow,
    ]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      null
    );

    expect(result?.id).toBe(2);
  });

  it("treats a candidate row with null title as having an empty title", async () => {
    // Exercises the `candidateRow.title ?? ''` fallback. The row has a real
    // company but a null title; the search for a non-empty title should NOT
    // match (since normalize('') !== normalize('Senior Engineer')).
    const rowWithNullTitle = buildJobListingRow({
      id: 7,
      company: "Acme Corp",
      title: null,
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([rowWithNullTitle]);

    const result = await findExistingJobListingByCompanyTitle("Acme Corp", "Senior Engineer", null);
    expect(result).toBeNull();
  });

  it("matches across whitespace differences ('acme  corp' vs 'Acme Corp')", async () => {
    const matchingRow = buildJobListingRow({
      id: 9,
      company: "acme  corp",
      title: "Senior   Engineer",
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([matchingRow]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      null
    );

    expect(result?.id).toBe(9);
  });

  it("queries with the company-not-null / not-empty predicate", async () => {
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([]);

    await findExistingJobListingByCompanyTitle("Acme Corp", "Senior Engineer", null);

    const findManyArg = vi.mocked(prisma.jobListing.findMany).mock.calls[0]?.[0];
    expect(findManyArg).toEqual({
      where: {
        company: { not: null },
        NOT: { company: "" },
      },
    });
  });

  it("returns the FIRST matching row when multiple rows match", async () => {
    const firstMatch = buildJobListingRow({
      id: 5,
      company: "Acme Corp",
      title: "Senior Engineer",
    });
    const secondMatch = buildJobListingRow({
      id: 6,
      company: "ACME CORP",
      title: "senior engineer",
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([
      firstMatch,
      secondMatch,
    ]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      null
    );

    expect(result?.id).toBe(5);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Location wildcard behavior (either-side-null acts as wildcard)
  // ──────────────────────────────────────────────────────────────────────

  it("matches when both call-side and candidate location are null", async () => {
    // Both sides null → location is effectively ignored, match on (company, title) alone.
    const matchingRow = buildJobListingRow({
      id: 11,
      company: "Acme Corp",
      title: "Senior Engineer",
      location: null,
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([matchingRow]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      null
    );

    expect(result?.id).toBe(11);
  });

  it("matches when call-side location is null but candidate has a valid location (wildcard)", async () => {
    // Call-side null wildcards the comparison even though candidate has "Remote".
    const matchingRow = buildJobListingRow({
      id: 12,
      company: "Acme Corp",
      title: "Senior Engineer",
      location: "Remote",
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([matchingRow]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      null
    );

    expect(result?.id).toBe(12);
  });

  it("matches when candidate location is null but call-side has a valid location (wildcard)", async () => {
    // Candidate-side null wildcards the comparison even though call-side has "Remote".
    const matchingRow = buildJobListingRow({
      id: 13,
      company: "Acme Corp",
      title: "Senior Engineer",
      location: null,
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([matchingRow]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      "Remote"
    );

    expect(result?.id).toBe(13);
  });

  it("matches when both locations are present and equal case-insensitively ('Remote' vs 'remote')", async () => {
    const matchingRow = buildJobListingRow({
      id: 14,
      company: "Acme Corp",
      title: "Senior Engineer",
      location: "remote",
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([matchingRow]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      "Remote"
    );

    expect(result?.id).toBe(14);
  });

  it("does NOT match when both sides have different valid locations ('Remote' vs 'NYC')", async () => {
    const nonMatchingRow = buildJobListingRow({
      id: 15,
      company: "Acme Corp",
      title: "Senior Engineer",
      location: "NYC",
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([nonMatchingRow]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      "Remote"
    );

    expect(result).toBeNull();
  });

  it("matches when both locations have only whitespace variation ('  Remote  ' vs 'Remote')", async () => {
    const matchingRow = buildJobListingRow({
      id: 16,
      company: "Acme Corp",
      title: "Senior Engineer",
      location: "Remote",
    });
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([matchingRow]);

    const result = await findExistingJobListingByCompanyTitle(
      "Acme Corp",
      "Senior Engineer",
      "  Remote  "
    );

    expect(result?.id).toBe(16);
  });
});
