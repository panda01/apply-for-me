import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listInboxDiscoveries,
  scanInbox,
  importInboxDiscoveries,
  dismissInboxDiscovery,
  restoreInboxDiscovery,
  type DiscoveredJobResponse,
  type ScanResultResponse,
  type ImportResultResponse,
} from "./inboxApi";

/**
 * Builds a DiscoveredJobResponse fixture with safe defaults. Tests pass
 * overrides for fields they care about (e.g. `id`, `status`).
 *
 * @param {Partial<DiscoveredJobResponse>} overrides - Fields to override on the fixture
 * @returns {DiscoveredJobResponse} A fully-populated discovery row
 */
function buildSampleDiscovery(overrides: Partial<DiscoveredJobResponse> = {}): DiscoveredJobResponse {
  return {
    id: 1,
    status: "pending",
    title: "Senior Software Engineer",
    company: "Acme Co",
    jobUrl: "https://example.com/jobs/1",
    location: "Remote",
    salary: "$160k–$200k",
    description: null,
    confidence: 0.92,
    email: {
      messageId: "msg-1",
      threadId: "thr-1",
      fromName: "LinkedIn Jobs",
      fromAddress: "jobs-noreply@linkedin.com",
      subject: "New jobs that match your search",
      snippet: "We found a few jobs you might like",
      receivedAt: "2026-05-22T12:00:00.000Z",
      labelColor: "#4f46e5",
      gmailUrl: "https://mail.google.com/mail/u/0/#inbox/msg-1",
    },
    duplicateOf: null,
    importedAs: null,
    createdDate: "2026-05-22T12:05:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("listInboxDiscoveries", () => {
  it("GETs /api/inbox/discoveries with days query and returns the array", async () => {
    const sampleRow = buildSampleDiscovery();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([sampleRow]),
    }));

    const result = await listInboxDiscoveries(14);

    expect(result).toEqual([sampleRow]);
    expect(fetch).toHaveBeenCalledWith("/api/inbox/discoveries?days=14");
  });

  it("includes the status query param when provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }));

    await listInboxDiscoveries(14, "pending");

    expect(fetch).toHaveBeenCalledWith("/api/inbox/discoveries?days=14&status=pending");
  });

  it("throws with the server-provided error message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "inbox unavailable" }),
    }));

    await expect(listInboxDiscoveries(14)).rejects.toThrow("inbox unavailable");
  });

  it("falls back to the default error message when the response has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(listInboxDiscoveries(14)).rejects.toThrow("Failed to list inbox discoveries");
  });
});

describe("scanInbox", () => {
  it("POSTs /api/inbox/scan with the days body and returns counters", async () => {
    const responseBody: ScanResultResponse = { scanned: 12, found: 5, newDiscoveries: 3 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(responseBody),
    }));

    const result = await scanInbox(7);

    expect(result).toEqual(responseBody);
    expect(fetch).toHaveBeenCalledWith("/api/inbox/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 7 }),
    });
  });

  it("throws with the server-provided error message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "scan failed" }),
    }));

    await expect(scanInbox(7)).rejects.toThrow("scan failed");
  });
});

describe("importInboxDiscoveries", () => {
  it("POSTs /api/inbox/import with the ids array and returns per-id outcomes", async () => {
    const responseBody: ImportResultResponse = {
      imported: [{ discoveryId: 1, jobListingId: 101 }],
      failed: [],
      duplicates: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(responseBody),
    }));

    const result = await importInboxDiscoveries([1, 2, 3]);

    expect(result).toEqual(responseBody);
    expect(fetch).toHaveBeenCalledWith("/api/inbox/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [1, 2, 3] }),
    });
  });

  it("throws with the server-provided error message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "import rejected" }),
    }));

    await expect(importInboxDiscoveries([1])).rejects.toThrow("import rejected");
  });
});

describe("dismissInboxDiscovery", () => {
  it("POSTs /api/inbox/discoveries/:id/dismiss and returns the updated row", async () => {
    const updatedRow = buildSampleDiscovery({ id: 5, status: "dismissed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(updatedRow),
    }));

    const result = await dismissInboxDiscovery(5);

    expect(result).toEqual(updatedRow);
    expect(fetch).toHaveBeenCalledWith("/api/inbox/discoveries/5/dismiss", { method: "POST" });
  });

  it("throws with the server-provided error message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Discovered job not found" }),
    }));

    await expect(dismissInboxDiscovery(99)).rejects.toThrow(/not found/i);
  });
});

describe("restoreInboxDiscovery", () => {
  it("POSTs /api/inbox/discoveries/:id/restore and returns the updated row", async () => {
    const updatedRow = buildSampleDiscovery({ id: 5, status: "pending" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(updatedRow),
    }));

    const result = await restoreInboxDiscovery(5);

    expect(result).toEqual(updatedRow);
    expect(fetch).toHaveBeenCalledWith("/api/inbox/discoveries/5/restore", { method: "POST" });
  });

  it("throws with the server-provided error message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "cannot restore non-dismissed discovery" }),
    }));

    await expect(restoreInboxDiscovery(99)).rejects.toThrow(/cannot restore/i);
  });
});
