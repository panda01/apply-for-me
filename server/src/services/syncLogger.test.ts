import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { gmailSyncSessionFindUniqueMock, gmailSyncSessionUpdateMock, transactionMock } =
  vi.hoisted(() => ({
    gmailSyncSessionFindUniqueMock: vi.fn(),
    gmailSyncSessionUpdateMock: vi.fn(),
    transactionMock: vi.fn(),
  }));

// Build a fake prisma client where $transaction simply invokes the callback
// with a tx object that re-exposes the same mocked findUnique/update — this
// is how the production code accesses them inside the transaction body.
vi.mock("../prismaClient.js", () => ({
  default: {
    $transaction: transactionMock,
    gmailSyncSession: {
      findUnique: gmailSyncSessionFindUniqueMock,
      update: gmailSyncSessionUpdateMock,
    },
  },
}));

import { createSyncLogger } from "./syncLogger.js";

beforeEach(() => {
  vi.clearAllMocks();
  // Default $transaction: invoke the callback with a tx mirroring the mocked
  // model methods.
  transactionMock.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      callback({
        gmailSyncSession: {
          findUnique: gmailSyncSessionFindUniqueMock,
          update: gmailSyncSessionUpdateMock,
        },
      })
  );
});

describe("createSyncLogger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("log() writes a formatted line to stdout AND appends a SyncLogEntry to the row", async () => {
    gmailSyncSessionFindUniqueMock.mockResolvedValue({ logs: "[]" });
    gmailSyncSessionUpdateMock.mockResolvedValue({});

    const logger = createSyncLogger(7);
    await logger.log("fetching_emails", "Listing messages", { count: 5 });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const stdoutLine = stdoutSpy.mock.calls[0]?.[0] as string;
    expect(stdoutLine).toContain("[gmail-sync session=7 step=fetching_emails]");
    expect(stdoutLine).toContain("Listing messages");
    expect(stdoutLine).toContain('"count":5');

    expect(gmailSyncSessionUpdateMock).toHaveBeenCalledTimes(1);
    const writtenLogs = JSON.parse(
      (gmailSyncSessionUpdateMock.mock.calls[0]?.[0] as { data: { logs: string } }).data.logs
    ) as unknown[];
    expect(writtenLogs).toHaveLength(1);
    const writtenEntry = writtenLogs[0] as Record<string, unknown>;
    expect(writtenEntry.step).toBe("fetching_emails");
    expect(writtenEntry.level).toBe("info");
    expect(writtenEntry.message).toBe("Listing messages");
    expect(writtenEntry.detail).toEqual({ count: 5 });
    expect(typeof writtenEntry.ts).toBe("string");
  });

  it("error() writes to stderr with level=error", async () => {
    gmailSyncSessionFindUniqueMock.mockResolvedValue({ logs: "[]" });
    gmailSyncSessionUpdateMock.mockResolvedValue({});

    const logger = createSyncLogger(11);
    await logger.error("finding_jobs", "Extractor crashed");

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).not.toHaveBeenCalled();
    const writtenLogs = JSON.parse(
      (gmailSyncSessionUpdateMock.mock.calls[0]?.[0] as { data: { logs: string } }).data.logs
    ) as unknown[];
    expect((writtenLogs[0] as Record<string, unknown>).level).toBe("error");
  });

  it("error() preserves the detail payload when provided", async () => {
    gmailSyncSessionFindUniqueMock.mockResolvedValue({ logs: "[]" });
    gmailSyncSessionUpdateMock.mockResolvedValue({});

    const logger = createSyncLogger(12);
    await logger.error("saving_jobs", "Failed to finalize", { sessionId: 12, code: "E_DB" });

    const writtenLogs = JSON.parse(
      (gmailSyncSessionUpdateMock.mock.calls[0]?.[0] as { data: { logs: string } }).data.logs
    ) as unknown[];
    expect((writtenLogs[0] as Record<string, unknown>).detail).toEqual({
      sessionId: 12,
      code: "E_DB",
    });
  });

  it("appends onto existing log entries (does not overwrite)", async () => {
    const existingEntries = [
      { ts: "2026-05-27T12:00:00Z", step: "fetching_emails", level: "info", message: "first" },
    ];
    gmailSyncSessionFindUniqueMock.mockResolvedValue({ logs: JSON.stringify(existingEntries) });
    gmailSyncSessionUpdateMock.mockResolvedValue({});

    const logger = createSyncLogger(3);
    await logger.log("saving_jobs", "second");

    const writtenLogs = JSON.parse(
      (gmailSyncSessionUpdateMock.mock.calls[0]?.[0] as { data: { logs: string } }).data.logs
    ) as unknown[];
    expect(writtenLogs).toHaveLength(2);
    expect((writtenLogs[0] as Record<string, unknown>).message).toBe("first");
    expect((writtenLogs[1] as Record<string, unknown>).message).toBe("second");
  });

  it("starts a fresh array when the existing logs JSON is malformed", async () => {
    gmailSyncSessionFindUniqueMock.mockResolvedValue({ logs: "not-json" });
    gmailSyncSessionUpdateMock.mockResolvedValue({});

    const logger = createSyncLogger(4);
    await logger.log(null, "fresh entry");

    const writtenLogs = JSON.parse(
      (gmailSyncSessionUpdateMock.mock.calls[0]?.[0] as { data: { logs: string } }).data.logs
    ) as unknown[];
    expect(writtenLogs).toHaveLength(1);
    expect((writtenLogs[0] as Record<string, unknown>).message).toBe("fresh entry");
  });

  it("renders step=- when step is null", async () => {
    gmailSyncSessionFindUniqueMock.mockResolvedValue({ logs: "[]" });
    gmailSyncSessionUpdateMock.mockResolvedValue({});

    const logger = createSyncLogger(2);
    await logger.log(null, "pre-step message");

    const stdoutLine = stdoutSpy.mock.calls[0]?.[0] as string;
    expect(stdoutLine).toContain("step=-");
  });

  it("no-ops the DB append (without throwing) when the session row has vanished", async () => {
    gmailSyncSessionFindUniqueMock.mockResolvedValue(null);

    const logger = createSyncLogger(99);
    await expect(logger.log("saving_jobs", "row gone")).resolves.toBeUndefined();
    // findUnique was called, update was NOT — nothing to append onto.
    expect(gmailSyncSessionFindUniqueMock).toHaveBeenCalled();
    expect(gmailSyncSessionUpdateMock).not.toHaveBeenCalled();
    // Stdout line still emitted so the worker has a debug trail.
    expect(stdoutSpy).toHaveBeenCalled();
  });
});
