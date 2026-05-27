import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// The gmail route doesn't use prisma directly, but importing ../app.js pulls
// in other routes that initialize the prisma client at module load — stub it
// so the suite doesn't require a real DATABASE_URL.
vi.mock("../prismaClient.js", () => ({
  default: {
    jobListing: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
    managedContainer: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    applicationUrlResolutionLog: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    applicationAttemptLogs: { findMany: vi.fn(), findUnique: vi.fn() },
    applicationProfile: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    gmailConnection: { upsert: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

const {
  buildAuthorizationUrlMock,
  consumeStateMock,
  createConnectionFromCodeMock,
  listConnectionsMock,
  deleteConnectionMock,
} = vi.hoisted(() => ({
  buildAuthorizationUrlMock: vi.fn(),
  consumeStateMock: vi.fn(),
  createConnectionFromCodeMock: vi.fn(),
  listConnectionsMock: vi.fn(),
  deleteConnectionMock: vi.fn(),
}));

vi.mock("../services/gmailOAuthService.js", () => ({
  buildAuthorizationUrl: buildAuthorizationUrlMock,
  consumeState: consumeStateMock,
}));

vi.mock("../services/gmailConnectionService.js", () => ({
  createConnectionFromCode: createConnectionFromCodeMock,
  listConnections: listConnectionsMock,
  deleteConnection: deleteConnectionMock,
}));

import { app } from "../app.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env["CLIENT_PORT"] = "4173";
});

describe("GET /api/gmail/auth/url", () => {
  it("returns the URL and state from the OAuth service", async () => {
    buildAuthorizationUrlMock.mockReturnValue({
      url: "https://accounts.google.com/o/oauth2/v2/auth?fake",
      state: "abcdef",
    });

    const response = await request(app).get("/api/gmail/auth/url");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      url: "https://accounts.google.com/o/oauth2/v2/auth?fake",
      state: "abcdef",
    });
  });
});

describe("GET /api/oauth/gmail (OAuth callback)", () => {
  it("redirects to /integrations?connected=… on a successful code exchange", async () => {
    consumeStateMock.mockReturnValue(true);
    createConnectionFromCodeMock.mockResolvedValue({
      id: 1,
      google_email: "user@example.com",
      scopes: "openid email",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      created_date: "2026-05-23T00:00:00.000Z",
      updated_date: "2026-05-23T00:00:00.000Z",
    });

    const response = await request(app).get("/api/oauth/gmail").query({ code: "good-code", state: "good-state" });

    expect(response.status).toBe(302);
    expect(consumeStateMock).toHaveBeenCalledWith("good-state");
    expect(createConnectionFromCodeMock).toHaveBeenCalledWith("good-code");
    expect(response.headers["location"]).toBe(
      "http://localhost:4173/integrations?connected=user%40example.com"
    );
  });

  it("redirects to /integrations?error=… when Google returned an error param", async () => {
    const response = await request(app).get("/api/oauth/gmail").query({ error: "access_denied" });

    expect(response.status).toBe(302);
    expect(response.headers["location"]).toBe(
      "http://localhost:4173/integrations?error=access_denied"
    );
    expect(consumeStateMock).not.toHaveBeenCalled();
    expect(createConnectionFromCodeMock).not.toHaveBeenCalled();
  });

  it("redirects with invalid_or_expired_state when consumeState rejects the token", async () => {
    consumeStateMock.mockReturnValue(false);

    const response = await request(app).get("/api/oauth/gmail").query({ code: "c", state: "stale" });

    expect(response.status).toBe(302);
    expect(response.headers["location"]).toContain("error=invalid_or_expired_state");
    expect(createConnectionFromCodeMock).not.toHaveBeenCalled();
  });

  it("redirects with missing_code_or_state when either param is absent", async () => {
    const response = await request(app).get("/api/oauth/gmail").query({ state: "only-state" });
    expect(response.status).toBe(302);
    expect(response.headers["location"]).toContain("error=missing_code_or_state");
  });

  it("redirects with token_exchange_failed when the service throws", async () => {
    consumeStateMock.mockReturnValue(true);
    createConnectionFromCodeMock.mockRejectedValue(new Error("Google rejected token"));

    const response = await request(app).get("/api/oauth/gmail").query({ code: "c", state: "s" });

    expect(response.status).toBe(302);
    expect(response.headers["location"]).toContain("error=token_exchange_failed");
  });

  it("redirects with token_exchange_failed when the service throws a non-Error", async () => {
    consumeStateMock.mockReturnValue(true);
    createConnectionFromCodeMock.mockRejectedValue("plain string failure");

    const response = await request(app).get("/api/oauth/gmail").query({ code: "c", state: "s" });
    expect(response.status).toBe(302);
    expect(response.headers["location"]).toContain("error=token_exchange_failed");
  });
});

describe("GET /api/gmail/connections", () => {
  it("returns the list from the connection service", async () => {
    listConnectionsMock.mockResolvedValue([
      {
        id: 1,
        google_email: "user@example.com",
        scopes: "openid",
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
        created_date: "2026-05-23T00:00:00.000Z",
        updated_date: "2026-05-23T00:00:00.000Z",
      },
    ]);

    const response = await request(app).get("/api/gmail/connections");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: 1, google_email: "user@example.com" });
  });
});

describe("DELETE /api/gmail/connections/:id", () => {
  it("returns 200 with the deleted row and any revoke warning", async () => {
    deleteConnectionMock.mockResolvedValue({
      deleted: {
        id: 7,
        google_email: "user@example.com",
        scopes: "openid",
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
        created_date: "2026-05-23T00:00:00.000Z",
        updated_date: "2026-05-23T00:00:00.000Z",
      },
      revokeWarning: null,
    });

    const response = await request(app).delete("/api/gmail/connections/7");

    expect(response.status).toBe(200);
    expect(deleteConnectionMock).toHaveBeenCalledWith(7);
    expect(response.body.deleted.id).toBe(7);
    expect(response.body.revokeWarning).toBeNull();
  });

  it("returns 400 when the id is not a number", async () => {
    const response = await request(app).delete("/api/gmail/connections/not-a-number");
    expect(response.status).toBe(400);
    expect(deleteConnectionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the service reports the row is missing", async () => {
    deleteConnectionMock.mockRejectedValue(new Error("GmailConnection 99 not found"));

    const response = await request(app).delete("/api/gmail/connections/99");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/i);
  });

  it("returns 500 when the service throws a non-NotFound error", async () => {
    deleteConnectionMock.mockRejectedValue(new Error("database is on fire"));

    // express by default sends 500 for unhandled rejections in async handlers.
    const response = await request(app).delete("/api/gmail/connections/7");
    expect(response.status).toBe(500);
  });
});

describe("buildClientRedirectUrl env handling", () => {
  it("throws when CLIENT_PORT is unset (callback path falls through to default 500)", async () => {
    delete process.env["CLIENT_PORT"];
    consumeStateMock.mockReturnValue(true);
    createConnectionFromCodeMock.mockResolvedValue({
      id: 1, google_email: "user@example.com", scopes: "", access_token_expires_at: "",
      created_date: "", updated_date: "",
    });

    const response = await request(app).get("/api/oauth/gmail").query({ code: "c", state: "s" });
    expect(response.status).toBe(500);
  });
});
