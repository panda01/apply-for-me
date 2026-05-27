import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getGmailAuthorizationUrl,
  listGmailConnections,
  deleteGmailConnection,
} from "./gmailApi";

const sampleConnection = {
  id: 1,
  google_email: "user@example.com",
  scopes: "https://www.googleapis.com/auth/gmail.readonly openid email",
  access_token_expires_at: "2099-01-01T00:00:00.000Z",
  created_date: "2026-05-23T17:00:00.000Z",
  updated_date: "2026-05-23T17:00:00.000Z",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("getGmailAuthorizationUrl", () => {
  it("returns the URL and state from /api/gmail/auth/url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: "https://accounts.google.com/x", state: "abc" }),
    }));

    const result = await getGmailAuthorizationUrl();

    expect(result).toEqual({ url: "https://accounts.google.com/x", state: "abc" });
    expect(fetch).toHaveBeenCalledWith("/api/gmail/auth/url");
  });

  it("throws the server-provided error message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "config_missing" }),
    }));

    await expect(getGmailAuthorizationUrl()).rejects.toThrow("config_missing");
  });
});

describe("listGmailConnections", () => {
  it("returns the array from /api/gmail/connections", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([sampleConnection]),
    }));

    const result = await listGmailConnections();

    expect(result).toEqual([sampleConnection]);
    expect(fetch).toHaveBeenCalledWith("/api/gmail/connections");
  });
});

describe("deleteGmailConnection", () => {
  it("DELETEs /api/gmail/connections/:id and returns the result envelope", async () => {
    const responseBody = { deleted: sampleConnection, revokeWarning: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(responseBody),
    }));

    const result = await deleteGmailConnection(1);

    expect(result).toEqual(responseBody);
    expect(fetch).toHaveBeenCalledWith("/api/gmail/connections/1", { method: "DELETE" });
  });

  it("throws with the server's error message on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Gmail connection not found" }),
    }));

    await expect(deleteGmailConnection(99)).rejects.toThrow(/not found/i);
  });
});
