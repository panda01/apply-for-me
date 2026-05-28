import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listInboxDiscoveries,
  scanInbox,
  importInboxDiscoveries,
  dismissInboxDiscovery,
  restoreInboxDiscovery,
  getActiveScanSession,
  getLastScanSession,
  getScanSession,
  ScanAlreadyRunningError,
  type DiscoveredJobResponse,
  type ImportResultResponse,
  type StartScanResponse,
  type GmailSyncSessionResponse,
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
    workArrangement: null,
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
  it("POSTs /api/inbox/scan and returns { sessionId, status, reused } on 200", async () => {
    const responseBody: StartScanResponse = { sessionId: 7, status: "running", reused: false };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseBody),
      })
    );

    const result = await scanInbox(7);

    expect(result).toEqual(responseBody);
    expect(fetch).toHaveBeenCalledWith("/api/inbox/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 7 }),
    });
  });

  it("throws ScanAlreadyRunningError with the existing sessionId on a 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: "scan_already_running", sessionId: 77 }),
      })
    );

    await expect(scanInbox(7)).rejects.toBeInstanceOf(ScanAlreadyRunningError);
  });

  it("sets sessionId=0 on the error when the 409 body is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.reject(new Error("not json")),
      })
    );

    try {
      await scanInbox(7);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ScanAlreadyRunningError);
      expect((err as ScanAlreadyRunningError).sessionId).toBe(0);
    }
  });

  it("throws a generic Error with the server's error field on non-409 non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: "No Gmail account connected" }),
      })
    );

    await expect(scanInbox(7)).rejects.toThrow(/No Gmail account connected/);
  });

  it("falls back to the default error message on non-2xx with no JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
      })
    );

    await expect(scanInbox(7)).rejects.toThrow("Failed to scan inbox");
  });
});

describe("getActiveScanSession", () => {
  it("returns the session when one is running", async () => {
    const session = { id: 1, status: "running" } as unknown as GmailSyncSessionResponse;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ session }),
      })
    );

    const result = await getActiveScanSession();

    expect(result).toEqual(session);
    expect(fetch).toHaveBeenCalledWith("/api/inbox/scan/active");
  });

  it("returns null when no scan is running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ session: null }),
      })
    );

    const result = await getActiveScanSession();
    expect(result).toBeNull();
  });
});

describe("getLastScanSession", () => {
  it("returns the most recent session regardless of status", async () => {
    const session = { id: 9, status: "succeeded" } as unknown as GmailSyncSessionResponse;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ session }),
      })
    );

    const result = await getLastScanSession();
    expect(result).toEqual(session);
    expect(fetch).toHaveBeenCalledWith("/api/inbox/scan/last");
  });
});

describe("getScanSession", () => {
  it("returns the session by id", async () => {
    const session = { id: 33, status: "running" } as unknown as GmailSyncSessionResponse;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ session }),
      })
    );

    const result = await getScanSession(33);
    expect(result).toEqual(session);
    expect(fetch).toHaveBeenCalledWith("/api/inbox/scan/33");
  });

  it("throws on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "session not found" }),
      })
    );

    await expect(getScanSession(999)).rejects.toThrow(/session not found/);
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
