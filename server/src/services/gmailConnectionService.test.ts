import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prismaClient.js", () => ({
  default: {
    gmailConnection: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const {
  exchangeCodeForTokensMock,
  refreshAccessTokenMock,
  revokeRefreshTokenMock,
} = vi.hoisted(() => ({
  exchangeCodeForTokensMock: vi.fn(),
  refreshAccessTokenMock: vi.fn(),
  revokeRefreshTokenMock: vi.fn(),
}));

vi.mock("./gmailOAuthService.js", () => ({
  exchangeCodeForTokens: exchangeCodeForTokensMock,
  refreshAccessToken: refreshAccessTokenMock,
  revokeRefreshToken: revokeRefreshTokenMock,
}));

import prisma from "../prismaClient.js";
import {
  createConnectionFromCode,
  deleteConnection,
  getValidAccessToken,
  listConnections,
} from "./gmailConnectionService.js";

/**
 * Minimal GmailConnection fixture matching what Prisma would return on a
 * happy-path findUnique. Dates are real Date instances since the service
 * uses .getTime() on access_token_expires_at.
 */
const sampleRow = {
  id: 1,
  google_email: "user@example.com",
  refresh_token: "stored-refresh-token",
  access_token: "stored-access-token",
  access_token_expires_at: new Date("2099-01-01T00:00:00.000Z"),
  scopes: "https://www.googleapis.com/auth/gmail.readonly openid email",
  created_date: new Date("2026-05-23T17:00:00.000Z"),
  updated_date: new Date("2026-05-23T17:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createConnectionFromCode", () => {
  it("upserts on google_email and returns the row stripped of token fields", async () => {
    exchangeCodeForTokensMock.mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      scopes: "scope-a scope-b",
      googleEmail: "user@example.com",
    });
    vi.mocked(prisma.gmailConnection.upsert).mockResolvedValue(sampleRow);

    const result = await createConnectionFromCode("auth-code");

    expect(exchangeCodeForTokensMock).toHaveBeenCalledWith("auth-code");
    const upsertCall = vi.mocked(prisma.gmailConnection.upsert).mock.calls[0]?.[0];
    expect(upsertCall?.where).toEqual({ google_email: "user@example.com" });
    expect(upsertCall?.create.refresh_token).toBe("new-refresh");
    expect(upsertCall?.update.access_token).toBe("new-access");
    expect(result).toMatchObject({ id: 1, google_email: "user@example.com" });
    expect(result).not.toHaveProperty("refresh_token");
    expect(result).not.toHaveProperty("access_token");
  });
});

describe("listConnections", () => {
  it("returns rows sorted by created_date desc with token fields stripped", async () => {
    vi.mocked(prisma.gmailConnection.findMany).mockResolvedValue([sampleRow]);

    const result = await listConnections();

    expect(vi.mocked(prisma.gmailConnection.findMany).mock.calls[0]?.[0]).toEqual({
      orderBy: { created_date: "desc" },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("refresh_token");
    expect(result[0]?.google_email).toBe("user@example.com");
  });
});

describe("deleteConnection", () => {
  it("revokes the refresh token before deleting the local row", async () => {
    vi.mocked(prisma.gmailConnection.findUnique).mockResolvedValue(sampleRow);
    revokeRefreshTokenMock.mockResolvedValue(undefined);
    vi.mocked(prisma.gmailConnection.delete).mockResolvedValue(sampleRow);

    const { deleted, revokeWarning } = await deleteConnection(1);

    expect(revokeRefreshTokenMock).toHaveBeenCalledWith("stored-refresh-token");
    expect(vi.mocked(prisma.gmailConnection.delete).mock.calls[0]?.[0]).toEqual({ where: { id: 1 } });
    expect(deleted.google_email).toBe("user@example.com");
    expect(revokeWarning).toBeNull();
  });

  it("still deletes the row when revoke fails, surfacing the warning", async () => {
    vi.mocked(prisma.gmailConnection.findUnique).mockResolvedValue(sampleRow);
    revokeRefreshTokenMock.mockRejectedValue(new Error("token already revoked"));
    vi.mocked(prisma.gmailConnection.delete).mockResolvedValue(sampleRow);

    const { deleted, revokeWarning } = await deleteConnection(1);

    expect(deleted.id).toBe(1);
    expect(revokeWarning).toMatch(/token already revoked/);
  });

  it("stringifies non-Error rejections from revoke into the warning text", async () => {
    vi.mocked(prisma.gmailConnection.findUnique).mockResolvedValue(sampleRow);
    revokeRefreshTokenMock.mockRejectedValue("plain string failure");
    vi.mocked(prisma.gmailConnection.delete).mockResolvedValue(sampleRow);

    const { revokeWarning } = await deleteConnection(1);
    expect(revokeWarning).toContain("plain string failure");
  });

  it("throws when the connection does not exist (no revoke, no delete)", async () => {
    vi.mocked(prisma.gmailConnection.findUnique).mockResolvedValue(null);

    await expect(deleteConnection(42)).rejects.toThrow(/not found/);
    expect(revokeRefreshTokenMock).not.toHaveBeenCalled();
    expect(prisma.gmailConnection.delete).not.toHaveBeenCalled();
  });
});

describe("getValidAccessToken", () => {
  it("returns the cached access token when it is comfortably in the future", async () => {
    vi.mocked(prisma.gmailConnection.findUnique).mockResolvedValue(sampleRow);

    const token = await getValidAccessToken(1);

    expect(token).toBe("stored-access-token");
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
    expect(prisma.gmailConnection.update).not.toHaveBeenCalled();
  });

  it("refreshes and persists the new token when the cached one is past the skew window", async () => {
    const justExpiredRow = {
      ...sampleRow,
      access_token_expires_at: new Date(Date.now() + 30 * 1000), // 30s ahead < 60s skew
    };
    vi.mocked(prisma.gmailConnection.findUnique).mockResolvedValue(justExpiredRow);
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "freshly-refreshed-token",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    vi.mocked(prisma.gmailConnection.update).mockResolvedValue(justExpiredRow);

    const token = await getValidAccessToken(1);

    expect(token).toBe("freshly-refreshed-token");
    expect(refreshAccessTokenMock).toHaveBeenCalledWith("stored-refresh-token");
    const updateCall = vi.mocked(prisma.gmailConnection.update).mock.calls[0]?.[0];
    expect(updateCall?.where).toEqual({ id: 1 });
    expect(updateCall?.data.access_token).toBe("freshly-refreshed-token");
  });

  it("throws when the connection id does not exist", async () => {
    vi.mocked(prisma.gmailConnection.findUnique).mockResolvedValue(null);
    await expect(getValidAccessToken(99)).rejects.toThrow(/not found/);
  });
});
