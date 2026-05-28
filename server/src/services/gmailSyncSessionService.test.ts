import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  createMock,
  updateMock,
  updateManyMock,
  findFirstMock,
  findUniqueMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  updateManyMock: vi.fn(),
  findFirstMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("../prismaClient.js", () => ({
  default: {
    gmailSyncSession: {
      create: createMock,
      update: updateMock,
      updateMany: updateManyMock,
      findFirst: findFirstMock,
      findUnique: findUniqueMock,
    },
  },
}));

import {
  createSession,
  transitionStep,
  finishSucceeded,
  finishFailed,
  getActiveSession,
  getLastSession,
  getLastSucceededSession,
  getSessionById,
  markStaleRunningAsFailed,
  projectSessionRow,
} from "./gmailSyncSessionService.js";
import type { GmailSyncSession } from "../../prisma/generated/client/client.js";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Builds a Prisma-row-shaped fixture so the projection function and the
 * SELECT-returning services have something realistic to project from.
 */
function makeRow(overrides: Partial<GmailSyncSession> = {}): GmailSyncSession {
  return {
    id: 1,
    gmail_connection_id: 1,
    status: "running",
    current_step: null,
    started_at: new Date("2026-05-27T12:00:00.000Z"),
    finished_at: null,
    days_requested: 14,
    last_error: null,
    logs: "[]",
    result: null,
    created_date: new Date("2026-05-27T12:00:00.000Z"),
    updated_date: new Date("2026-05-27T12:00:00.000Z"),
    ...overrides,
  } as GmailSyncSession;
}

describe("projectSessionRow", () => {
  it("parses logs JSON and result JSON into typed values", () => {
    const logsArray = [
      { ts: "2026-05-27T12:00:00Z", step: "fetching_emails", level: "info", message: "hi" },
    ];
    const resultObject = { scanned: 3, found: 2, newDiscoveries: 1 };
    const row = makeRow({
      status: "succeeded",
      finished_at: new Date("2026-05-27T12:05:00.000Z"),
      logs: JSON.stringify(logsArray),
      result: JSON.stringify(resultObject),
    });
    const projected = projectSessionRow(row);
    expect(projected.status).toBe("succeeded");
    expect(projected.logs).toEqual(logsArray);
    expect(projected.result).toEqual(resultObject);
    expect(projected.startedAt).toBe("2026-05-27T12:00:00.000Z");
    expect(projected.finishedAt).toBe("2026-05-27T12:05:00.000Z");
  });

  it("degrades malformed logs JSON to []", () => {
    const projected = projectSessionRow(makeRow({ logs: "this is not json" }));
    expect(projected.logs).toEqual([]);
  });

  it("returns result=null when result column is null", () => {
    const projected = projectSessionRow(makeRow({ result: null }));
    expect(projected.result).toBeNull();
  });
});

describe("createSession", () => {
  it("inserts a row in running state with no current_step", async () => {
    createMock.mockResolvedValue(makeRow({ id: 42 }));
    const { sessionId } = await createSession({
      gmailConnectionId: 1,
      daysRequested: 7,
    });
    expect(sessionId).toBe(42);
    expect(createMock).toHaveBeenCalledWith({
      data: {
        gmail_connection_id: 1,
        days_requested: 7,
        status: "running",
        current_step: null,
      },
    });
  });
});

describe("transitionStep", () => {
  it("updates current_step on the row", async () => {
    updateMock.mockResolvedValue(makeRow());
    await transitionStep(5, "finding_jobs");
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { current_step: "finding_jobs" },
    });
  });
});

describe("finishSucceeded", () => {
  it("writes status=succeeded + result JSON + finished_at + clears current_step", async () => {
    updateMock.mockResolvedValue(makeRow());
    await finishSucceeded(8, { scanned: 10, found: 7, newDiscoveries: 3 });
    expect(updateMock).toHaveBeenCalledTimes(1);
    const callArgs = updateMock.mock.calls[0]?.[0] as {
      where: { id: number };
      data: { status: string; current_step: null; finished_at: Date; result: string };
    };
    expect(callArgs.where).toEqual({ id: 8 });
    expect(callArgs.data.status).toBe("succeeded");
    expect(callArgs.data.current_step).toBeNull();
    expect(callArgs.data.finished_at).toBeInstanceOf(Date);
    expect(JSON.parse(callArgs.data.result) as unknown).toEqual({
      scanned: 10,
      found: 7,
      newDiscoveries: 3,
    });
  });
});

describe("finishFailed", () => {
  it("writes status=failed + last_error + clears current_step", async () => {
    updateMock.mockResolvedValue(makeRow());
    await finishFailed(8, "Claude API timeout");
    const callArgs = updateMock.mock.calls[0]?.[0] as {
      data: { status: string; current_step: null; last_error: string };
    };
    expect(callArgs.data.status).toBe("failed");
    expect(callArgs.data.last_error).toBe("Claude API timeout");
    expect(callArgs.data.current_step).toBeNull();
  });
});

describe("getActiveSession", () => {
  it("returns the running session projected as PublicGmailSyncSession", async () => {
    findFirstMock.mockResolvedValue(makeRow({ id: 17, status: "running" }));
    const session = await getActiveSession(1);
    expect(session).not.toBeNull();
    expect(session?.id).toBe(17);
    expect(session?.status).toBe("running");
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { gmail_connection_id: 1, status: "running" },
      orderBy: { started_at: "desc" },
    });
  });

  it("returns null when no running session exists", async () => {
    findFirstMock.mockResolvedValue(null);
    const session = await getActiveSession(1);
    expect(session).toBeNull();
  });
});

describe("getLastSession", () => {
  it("returns the most recent session regardless of status", async () => {
    findFirstMock.mockResolvedValue(makeRow({ id: 88, status: "succeeded" }));
    const session = await getLastSession(1);
    expect(session?.id).toBe(88);
    expect(session?.status).toBe("succeeded");
    // No status filter — last session regardless of status.
    const callArgs = findFirstMock.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(callArgs.where).toEqual({ gmail_connection_id: 1 });
  });

  it("returns null when no sessions exist for the connection", async () => {
    findFirstMock.mockResolvedValue(null);
    const session = await getLastSession(1);
    expect(session).toBeNull();
  });
});

describe("getLastSucceededSession", () => {
  it("returns the most recent succeeded session for the connection", async () => {
    findFirstMock.mockResolvedValue(makeRow({ id: 75, status: "succeeded" }));
    const session = await getLastSucceededSession(1);
    expect(session?.id).toBe(75);
    expect(session?.status).toBe("succeeded");
    const callArgs = findFirstMock.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(callArgs.where).toEqual({
      gmail_connection_id: 1,
      status: "succeeded",
    });
  });

  it("returns null when no succeeded session exists (e.g. only failed/running)", async () => {
    findFirstMock.mockResolvedValue(null);
    const session = await getLastSucceededSession(1);
    expect(session).toBeNull();
  });
});

describe("getSessionById", () => {
  it("returns the row by id", async () => {
    findUniqueMock.mockResolvedValue(makeRow({ id: 33 }));
    const session = await getSessionById(33);
    expect(session?.id).toBe(33);
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 33 } });
  });

  it("returns null when no row exists", async () => {
    findUniqueMock.mockResolvedValue(null);
    const session = await getSessionById(999);
    expect(session).toBeNull();
  });
});

describe("markStaleRunningAsFailed", () => {
  it("UPDATEs every running row to failed with last_error='server restart'", async () => {
    updateManyMock.mockResolvedValue({ count: 3 });
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const { markedCount } = await markStaleRunningAsFailed();
    expect(markedCount).toBe(3);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const callArgs = updateManyMock.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: { status: string; current_step: null; last_error: string };
    };
    expect(callArgs.where).toEqual({ status: "running" });
    expect(callArgs.data.status).toBe("failed");
    expect(callArgs.data.last_error).toBe("server restart");
    expect(callArgs.data.current_step).toBeNull();
    expect(stdoutSpy).toHaveBeenCalled();

    stdoutSpy.mockRestore();
  });

  it("does not log when zero rows were marked", async () => {
    updateManyMock.mockResolvedValue({ count: 0 });
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const { markedCount } = await markStaleRunningAsFailed();
    expect(markedCount).toBe(0);
    expect(stdoutSpy).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
  });
});
