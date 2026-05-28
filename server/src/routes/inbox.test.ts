import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Importing ../app.js pulls in routes that initialize the prisma client at
// module load — stub it so the suite doesn't require a real DATABASE_URL.
// Mirrors the block in gmail.test.ts.
vi.mock("../prismaClient.js", () => ({
  default: {
    jobListing: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
    managedContainer: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    applicationUrlResolutionLog: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    applicationAttemptLogs: { findMany: vi.fn(), findUnique: vi.fn() },
    applicationProfile: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    gmailConnection: { upsert: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    discoveredJob: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    gmailSyncSession: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

const {
  listDiscoveriesMock,
  importDiscoveriesMock,
  dismissDiscoveryMock,
  restoreDiscoveryMock,
  createSessionMock,
  getActiveSessionMock,
  getLastSessionMock,
  getSessionByIdMock,
  startScanWorkerMock,
  getFirstConnectionIdMock,
} = vi.hoisted(() => ({
  listDiscoveriesMock: vi.fn(),
  importDiscoveriesMock: vi.fn(),
  dismissDiscoveryMock: vi.fn(),
  restoreDiscoveryMock: vi.fn(),
  createSessionMock: vi.fn(),
  getActiveSessionMock: vi.fn(),
  getLastSessionMock: vi.fn(),
  getSessionByIdMock: vi.fn(),
  startScanWorkerMock: vi.fn(),
  getFirstConnectionIdMock: vi.fn(),
}));

vi.mock("../services/discoveredJobsService.js", () => ({
  listDiscoveries: listDiscoveriesMock,
  importDiscoveries: importDiscoveriesMock,
  dismissDiscovery: dismissDiscoveryMock,
  restoreDiscovery: restoreDiscoveryMock,
}));

vi.mock("../services/gmailSyncSessionService.js", () => ({
  createSession: createSessionMock,
  getActiveSession: getActiveSessionMock,
  getLastSession: getLastSessionMock,
  getSessionById: getSessionByIdMock,
}));

vi.mock("../services/gmailSyncWorker.js", () => ({
  startScanWorker: startScanWorkerMock,
}));

vi.mock("../services/gmailMessageReaderService.js", () => ({
  getFirstConnectionId: getFirstConnectionIdMock,
}));

import { app } from "../app.js";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Minimal PublicDiscoveredJob fixture used by happy-path assertions. Matches
 * inboxTypes.PublicDiscoveredJob shape so JSON round-trip is faithful.
 */
const sampleDiscovery = {
  id: 42,
  status: "pending" as const,
  title: "Staff Software Engineer",
  company: "Anthropic",
  jobUrl: "https://jobs.example.com/123",
  location: "Remote",
  salary: null,
  description: null,
  confidence: 0.92,
  email: {
    messageId: "abc",
    threadId: "thr",
    fromName: "LinkedIn Jobs",
    fromAddress: "jobs@linkedin.com",
    subject: "5 new jobs match your search",
    snippet: null,
    receivedAt: "2026-05-22T10:00:00.000Z",
    labelColor: null,
    gmailUrl: "https://mail.google.com/mail/u/0/#inbox/abc",
  },
  duplicateOf: null,
  importedAs: null,
  createdDate: "2026-05-22T10:05:00.000Z",
};

/**
 * Minimal DiscoveredJob row fixture used by dismiss/restore happy-path tests.
 * Just the columns the route layer round-trips; not strictly type-checked
 * against the generated client because we're mocking the service anyway.
 */
const sampleDiscoveryRow = {
  id: 42,
  status: "dismissed",
  title: "Staff Software Engineer",
  company: "Anthropic",
  job_url: "https://jobs.example.com/123",
};

describe("GET /api/inbox/discoveries", () => {
  it("defaults days to 14 when the query is omitted", async () => {
    listDiscoveriesMock.mockResolvedValue([sampleDiscovery]);

    const response = await request(app).get("/api/inbox/discoveries");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([sampleDiscovery]);
    expect(listDiscoveriesMock).toHaveBeenCalledWith({ days: 14 });
  });

  it("passes through a custom days query value", async () => {
    listDiscoveriesMock.mockResolvedValue([]);

    const response = await request(app).get("/api/inbox/discoveries").query({ days: "30" });

    expect(response.status).toBe(200);
    expect(listDiscoveriesMock).toHaveBeenCalledWith({ days: 30 });
  });

  it("passes through a valid status filter", async () => {
    listDiscoveriesMock.mockResolvedValue([]);

    const response = await request(app)
      .get("/api/inbox/discoveries")
      .query({ days: "7", status: "imported" });

    expect(response.status).toBe(200);
    expect(listDiscoveriesMock).toHaveBeenCalledWith({ days: 7, status: "imported" });
  });

  it("returns 400 when days is not a positive integer", async () => {
    const response = await request(app).get("/api/inbox/discoveries").query({ days: "-5" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/days/);
    expect(listDiscoveriesMock).not.toHaveBeenCalled();
  });

  it("returns 400 when days is a non-numeric string", async () => {
    const response = await request(app).get("/api/inbox/discoveries").query({ days: "soon" });

    expect(response.status).toBe(400);
    expect(listDiscoveriesMock).not.toHaveBeenCalled();
  });

  it("returns 400 when status is not one of the allowed values", async () => {
    const response = await request(app)
      .get("/api/inbox/discoveries")
      .query({ status: "archived" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/status/);
    expect(listDiscoveriesMock).not.toHaveBeenCalled();
  });
});

/**
 * Builds a PublicGmailSyncSession-shaped object for use as a mock return.
 * Centralized so individual tests can override just the fields they care
 * about without restating the rest of the shape.
 */
function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 100,
    gmailConnectionId: 1,
    status: "running",
    currentStep: null,
    startedAt: new Date("2026-05-27T12:00:00.000Z").toISOString(),
    finishedAt: null,
    daysRequested: 14,
    lastError: null,
    result: null,
    logs: [],
    ...overrides,
  };
}

describe("POST /api/inbox/scan", () => {
  it("starts a worker and returns sessionId on the happy path", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    getActiveSessionMock.mockResolvedValue(null);
    createSessionMock.mockResolvedValue({ sessionId: 42 });
    startScanWorkerMock.mockResolvedValue(undefined);

    const response = await request(app).post("/api/inbox/scan").send({ days: 14 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sessionId: 42, status: "running", reused: false });
    expect(createSessionMock).toHaveBeenCalledWith({
      gmailConnectionId: 1,
      daysRequested: 14,
    });
    expect(startScanWorkerMock).toHaveBeenCalledWith(42, 14);
  });

  it("returns 409 with the existing session id when a scan is already running", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    getActiveSessionMock.mockResolvedValue(makeSession({ id: 77, status: "running" }));

    const response = await request(app).post("/api/inbox/scan").send({ days: 14 });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "scan_already_running", sessionId: 77 });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(startScanWorkerMock).not.toHaveBeenCalled();
  });

  it("returns 400 when days is missing", async () => {
    const response = await request(app).post("/api/inbox/scan").send({});
    expect(response.status).toBe(400);
    expect(getFirstConnectionIdMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when days is not an integer", async () => {
    const response = await request(app).post("/api/inbox/scan").send({ days: 7.5 });
    expect(response.status).toBe(400);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when days is negative", async () => {
    const response = await request(app).post("/api/inbox/scan").send({ days: -3 });
    expect(response.status).toBe(400);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when days is an empty string", async () => {
    const response = await request(app).post("/api/inbox/scan").send({ days: "   " });
    expect(response.status).toBe(400);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when days is the wrong type entirely", async () => {
    const response = await request(app).post("/api/inbox/scan").send({ days: true });
    expect(response.status).toBe(400);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns 503 when no Gmail account is connected", async () => {
    getFirstConnectionIdMock.mockRejectedValue(new Error("No Gmail account connected"));

    const response = await request(app).post("/api/inbox/scan").send({ days: 14 });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/No Gmail account connected/);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("returns 500 when getFirstConnectionId throws a non-NoGmail error", async () => {
    getFirstConnectionIdMock.mockRejectedValue(new Error("DB exploded"));

    const response = await request(app).post("/api/inbox/scan").send({ days: 14 });

    expect(response.status).toBe(500);
  });

  it("returns 500 when getFirstConnectionId rejects with a non-Error value", async () => {
    getFirstConnectionIdMock.mockRejectedValue({ shape: "unknown" });

    const response = await request(app).post("/api/inbox/scan").send({ days: 14 });

    expect(response.status).toBe(500);
  });
});

describe("GET /api/inbox/scan/active", () => {
  it("returns the running session when one exists", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    const session = makeSession({ id: 10, status: "running", currentStep: "fetching_emails" });
    getActiveSessionMock.mockResolvedValue(session);

    const response = await request(app).get("/api/inbox/scan/active");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ session });
  });

  it("returns null when no session is running", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    getActiveSessionMock.mockResolvedValue(null);

    const response = await request(app).get("/api/inbox/scan/active");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ session: null });
  });

  it("returns 503 when no Gmail account is connected", async () => {
    getFirstConnectionIdMock.mockRejectedValue(new Error("No Gmail account connected"));

    const response = await request(app).get("/api/inbox/scan/active");

    expect(response.status).toBe(503);
  });

  it("returns 500 when getFirstConnectionId throws a non-NoGmail error", async () => {
    getFirstConnectionIdMock.mockRejectedValue(new Error("DB blew up"));

    const response = await request(app).get("/api/inbox/scan/active");

    expect(response.status).toBe(500);
  });

  it("returns 500 when getFirstConnectionId rejects with a non-Error value", async () => {
    getFirstConnectionIdMock.mockRejectedValue("not-an-error");

    const response = await request(app).get("/api/inbox/scan/active");

    expect(response.status).toBe(500);
  });
});

describe("GET /api/inbox/scan/last", () => {
  it("returns the most recent session regardless of status", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    const session = makeSession({ id: 9, status: "succeeded", currentStep: null });
    getLastSessionMock.mockResolvedValue(session);

    const response = await request(app).get("/api/inbox/scan/last");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ session });
  });

  it("returns null when no sessions have ever run", async () => {
    getFirstConnectionIdMock.mockResolvedValue(1);
    getLastSessionMock.mockResolvedValue(null);

    const response = await request(app).get("/api/inbox/scan/last");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ session: null });
  });

  it("returns 503 when no Gmail account is connected", async () => {
    getFirstConnectionIdMock.mockRejectedValue(new Error("No Gmail account connected"));

    const response = await request(app).get("/api/inbox/scan/last");

    expect(response.status).toBe(503);
  });

  it("returns 500 when getFirstConnectionId throws a non-NoGmail error", async () => {
    getFirstConnectionIdMock.mockRejectedValue(new Error("DB unhappy"));

    const response = await request(app).get("/api/inbox/scan/last");

    expect(response.status).toBe(500);
  });

  it("returns 500 when getFirstConnectionId rejects with a non-Error value", async () => {
    getFirstConnectionIdMock.mockRejectedValue("string-rejection");

    const response = await request(app).get("/api/inbox/scan/last");

    expect(response.status).toBe(500);
  });
});

describe("GET /api/inbox/scan/:sessionId", () => {
  it("returns the session by id", async () => {
    const session = makeSession({ id: 55, status: "succeeded" });
    getSessionByIdMock.mockResolvedValue(session);

    const response = await request(app).get("/api/inbox/scan/55");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ session });
    expect(getSessionByIdMock).toHaveBeenCalledWith(55);
  });

  it("returns 400 for a non-numeric sessionId", async () => {
    const response = await request(app).get("/api/inbox/scan/not-a-number");
    expect(response.status).toBe(400);
    expect(getSessionByIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the session does not exist", async () => {
    getSessionByIdMock.mockResolvedValue(null);

    const response = await request(app).get("/api/inbox/scan/9999");

    expect(response.status).toBe(404);
  });
});

describe("POST /api/inbox/import", () => {
  it("returns the ImportResult on the happy path", async () => {
    const importResult = {
      imported: [{ discoveryId: 1, jobListingId: 100 }],
      failed: [],
      duplicates: [],
    };
    importDiscoveriesMock.mockResolvedValue(importResult);

    const response = await request(app).post("/api/inbox/import").send({ ids: [1, 2, 3] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(importResult);
    expect(importDiscoveriesMock).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("returns 400 when ids is missing", async () => {
    const response = await request(app).post("/api/inbox/import").send({});
    expect(response.status).toBe(400);
    expect(importDiscoveriesMock).not.toHaveBeenCalled();
  });

  it("returns 400 when ids is an empty array", async () => {
    const response = await request(app).post("/api/inbox/import").send({ ids: [] });
    expect(response.status).toBe(400);
    expect(importDiscoveriesMock).not.toHaveBeenCalled();
  });

  it("returns 400 when ids is not an array", async () => {
    const response = await request(app).post("/api/inbox/import").send({ ids: "1,2,3" });
    expect(response.status).toBe(400);
    expect(importDiscoveriesMock).not.toHaveBeenCalled();
  });

  it("returns 400 when ids contains a non-integer", async () => {
    const response = await request(app)
      .post("/api/inbox/import")
      .send({ ids: [1, "two", 3] });
    expect(response.status).toBe(400);
    expect(importDiscoveriesMock).not.toHaveBeenCalled();
  });

  it("returns 400 when ids contains a negative number", async () => {
    const response = await request(app)
      .post("/api/inbox/import")
      .send({ ids: [1, -2, 3] });
    expect(response.status).toBe(400);
    expect(importDiscoveriesMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/inbox/discoveries/:id/dismiss", () => {
  it("returns the updated row on the happy path", async () => {
    dismissDiscoveryMock.mockResolvedValue(sampleDiscoveryRow);

    const response = await request(app).post("/api/inbox/discoveries/42/dismiss");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(sampleDiscoveryRow);
    expect(dismissDiscoveryMock).toHaveBeenCalledWith(42);
  });

  it("returns 400 when the id is not numeric", async () => {
    const response = await request(app).post("/api/inbox/discoveries/not-a-number/dismiss");
    expect(response.status).toBe(400);
    expect(dismissDiscoveryMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the service reports the row is not found", async () => {
    dismissDiscoveryMock.mockRejectedValue(new Error("DiscoveredJob 99 not found"));

    const response = await request(app).post("/api/inbox/discoveries/99/dismiss");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/);
  });

  it("returns 409 when the service reports the discovery is already imported", async () => {
    dismissDiscoveryMock.mockRejectedValue(
      new Error("Cannot dismiss/restore an imported discovery")
    );

    const response = await request(app).post("/api/inbox/discoveries/7/dismiss");

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/imported discovery/);
  });

  it("returns 500 when the service throws an unmapped error", async () => {
    dismissDiscoveryMock.mockRejectedValue(new Error("database is on fire"));

    const response = await request(app).post("/api/inbox/discoveries/7/dismiss");

    expect(response.status).toBe(500);
  });
});

describe("POST /api/inbox/discoveries/:id/restore", () => {
  it("returns the updated row on the happy path", async () => {
    const restoredRow = { ...sampleDiscoveryRow, status: "pending" };
    restoreDiscoveryMock.mockResolvedValue(restoredRow);

    const response = await request(app).post("/api/inbox/discoveries/42/restore");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(restoredRow);
    expect(restoreDiscoveryMock).toHaveBeenCalledWith(42);
  });

  it("returns 400 when the id is not numeric", async () => {
    const response = await request(app).post("/api/inbox/discoveries/abc/restore");
    expect(response.status).toBe(400);
    expect(restoreDiscoveryMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the service reports the row is not found", async () => {
    restoreDiscoveryMock.mockRejectedValue(new Error("DiscoveredJob 99 not found"));

    const response = await request(app).post("/api/inbox/discoveries/99/restore");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/);
  });

  it("returns 409 when the service reports the discovery is already imported", async () => {
    restoreDiscoveryMock.mockRejectedValue(
      new Error("Cannot dismiss/restore an imported discovery")
    );

    const response = await request(app).post("/api/inbox/discoveries/7/restore");

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/imported discovery/);
  });
});
