import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted spies/stubs so we can both inject them into the vi.mock factory below
// AND access them inside test bodies — vitest evaluates mock factories before
// any top-level test code, so plain const references would be undefined at
// factory time.
const {
  generateAuthUrlMock,
  getTokenMock,
  verifyIdTokenMock,
  refreshAccessTokenMock,
  revokeTokenMock,
  setCredentialsMock,
} = vi.hoisted(() => ({
  generateAuthUrlMock: vi.fn(),
  getTokenMock: vi.fn(),
  verifyIdTokenMock: vi.fn(),
  refreshAccessTokenMock: vi.fn(),
  revokeTokenMock: vi.fn(),
  setCredentialsMock: vi.fn(),
}));

vi.mock("google-auth-library", () => {
  class OAuth2Client {
    generateAuthUrl = generateAuthUrlMock;
    getToken = getTokenMock;
    verifyIdToken = verifyIdTokenMock;
    refreshAccessToken = refreshAccessTokenMock;
    revokeToken = revokeTokenMock;
    setCredentials = setCredentialsMock;
  }
  return { OAuth2Client };
});

import {
  buildAuthorizationUrl,
  consumeState,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeRefreshToken,
  __clearStatesForTests,
  __seedStateForTests,
} from "./gmailOAuthService.js";

beforeEach(() => {
  vi.clearAllMocks();
  __clearStatesForTests();
  process.env["GMAIL_OAUTH_CLIENT_ID"] = "test-client-id";
  process.env["GMAIL_OAUTH_CLIENT_SECRET"] = "test-client-secret";
  process.env["GMAIL_OAUTH_REDIRECT_URI"] = "http://localhost:4173/api/oauth/gmail";
});

afterEach(() => {
  delete process.env["GMAIL_OAUTH_CLIENT_ID"];
  delete process.env["GMAIL_OAUTH_CLIENT_SECRET"];
  delete process.env["GMAIL_OAUTH_REDIRECT_URI"];
});

describe("buildAuthorizationUrl", () => {
  it("returns the URL produced by OAuth2Client.generateAuthUrl and a fresh state token", () => {
    generateAuthUrlMock.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?fake");

    const result = buildAuthorizationUrl();

    expect(result.url).toBe("https://accounts.google.com/o/oauth2/v2/auth?fake");
    expect(result.state).toMatch(/^[a-f0-9]{64}$/);
    expect(generateAuthUrlMock).toHaveBeenCalledTimes(1);
    const callArgs = generateAuthUrlMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArgs?.["access_type"]).toBe("offline");
    expect(callArgs?.["prompt"]).toBe("consent");
    expect(callArgs?.["scope"]).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "openid",
      "email",
    ]);
    expect(callArgs?.["state"]).toBe(result.state);
  });

  it("produces distinct state tokens on consecutive calls", () => {
    generateAuthUrlMock.mockReturnValue("https://example.com");
    const first = buildAuthorizationUrl();
    const second = buildAuthorizationUrl();
    expect(first.state).not.toBe(second.state);
  });
});

describe("consumeState", () => {
  it("returns true once for a known state and false on replay", () => {
    __seedStateForTests("known-state");
    expect(consumeState("known-state")).toBe(true);
    expect(consumeState("known-state")).toBe(false);
  });

  it("returns false for an unknown state", () => {
    expect(consumeState("never-seen-this")).toBe(false);
  });

  it("prunes state tokens older than the TTL so they cannot be consumed", () => {
    vi.useFakeTimers();
    try {
      const startEpoch = Date.parse("2026-05-23T17:00:00.000Z");
      vi.setSystemTime(new Date(startEpoch));
      generateAuthUrlMock.mockReturnValue("https://example.com");
      const { state } = buildAuthorizationUrl();

      // Jump forward past the 10-minute TTL.
      vi.setSystemTime(new Date(startEpoch + 11 * 60 * 1000));

      expect(consumeState(state)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("exchangeCodeForTokens", () => {
  /**
   * Builds the success-path mock for OAuth2Client.getToken — every required
   * Credentials field present so the service does not throw.
   */
  function mockSuccessfulCodeExchange(): void {
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "fake-access",
        refresh_token: "fake-refresh",
        id_token: "fake-id-token",
        expiry_date: 1_900_000_000_000,
        scope: "https://www.googleapis.com/auth/gmail.readonly openid email",
      },
    });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: "user@example.com" }),
    });
  }

  it("returns the normalized token shape with the email decoded from id_token", async () => {
    mockSuccessfulCodeExchange();

    const result = await exchangeCodeForTokens("auth-code-from-google");

    expect(getTokenMock).toHaveBeenCalledWith("auth-code-from-google");
    expect(result).toEqual({
      accessToken: "fake-access",
      refreshToken: "fake-refresh",
      accessTokenExpiresAt: new Date(1_900_000_000_000),
      scopes: "https://www.googleapis.com/auth/gmail.readonly openid email",
      googleEmail: "user@example.com",
    });
  });

  it("throws a clear error when Google omits refresh_token (most often a re-consent issue)", async () => {
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "fake-access",
        id_token: "fake-id-token",
        expiry_date: 1_900_000_000_000,
      },
    });

    await expect(exchangeCodeForTokens("code")).rejects.toThrow(/refresh_token/);
  });

  it("throws when access_token is missing from the token response", async () => {
    getTokenMock.mockResolvedValue({
      tokens: { refresh_token: "r", id_token: "i", expiry_date: 1 },
    });
    await expect(exchangeCodeForTokens("code")).rejects.toThrow(/access_token/);
  });

  it("throws when id_token is missing from the token response", async () => {
    getTokenMock.mockResolvedValue({
      tokens: { access_token: "a", refresh_token: "r", expiry_date: 1 },
    });
    await expect(exchangeCodeForTokens("code")).rejects.toThrow(/id_token/);
  });

  it("throws when expiry_date is missing from the token response", async () => {
    getTokenMock.mockResolvedValue({
      tokens: { access_token: "a", refresh_token: "r", id_token: "i" },
    });
    await expect(exchangeCodeForTokens("code")).rejects.toThrow(/expiry_date/);
  });

  it("falls back to the default scope list when Google omits the scope field", async () => {
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "a",
        refresh_token: "r",
        id_token: "i",
        expiry_date: 1_900_000_000_000,
        // scope intentionally omitted
      },
    });
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => ({ email: "user@example.com" }) });

    const result = await exchangeCodeForTokens("code");
    expect(result.scopes).toContain("gmail.readonly");
    expect(result.scopes).toContain("openid");
    expect(result.scopes).toContain("email");
  });

  it("throws when verifyIdToken returns no payload object", async () => {
    getTokenMock.mockResolvedValue({
      tokens: { access_token: "a", refresh_token: "r", id_token: "i", expiry_date: 1 },
    });
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => undefined });
    await expect(exchangeCodeForTokens("code")).rejects.toThrow(/email claim/);
  });

  it("throws when id_token is present but missing the email claim", async () => {
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "fake-access",
        refresh_token: "fake-refresh",
        id_token: "fake-id-token",
        expiry_date: 1_900_000_000_000,
      },
    });
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => ({}) });

    await expect(exchangeCodeForTokens("code")).rejects.toThrow(/email claim/);
  });
});

describe("refreshAccessToken", () => {
  it("returns the new access token and absolute expiry", async () => {
    refreshAccessTokenMock.mockResolvedValue({
      credentials: { access_token: "fresh-access", expiry_date: 2_000_000_000_000 },
    });

    const result = await refreshAccessToken("the-refresh-token");

    expect(setCredentialsMock).toHaveBeenCalledWith({ refresh_token: "the-refresh-token" });
    expect(result).toEqual({
      accessToken: "fresh-access",
      accessTokenExpiresAt: new Date(2_000_000_000_000),
    });
  });

  it("throws when Google omits the access_token in the refresh response", async () => {
    refreshAccessTokenMock.mockResolvedValue({
      credentials: { expiry_date: 2_000_000_000_000 },
    });

    await expect(refreshAccessToken("rt")).rejects.toThrow(/access_token/);
  });

  it("throws when Google omits the expiry_date in the refresh response", async () => {
    refreshAccessTokenMock.mockResolvedValue({
      credentials: { access_token: "fresh-access" },
    });
    await expect(refreshAccessToken("rt")).rejects.toThrow(/expiry_date/);
  });
});

describe("revokeRefreshToken", () => {
  it("delegates to OAuth2Client.revokeToken with the given refresh token", async () => {
    revokeTokenMock.mockResolvedValue(undefined);
    await revokeRefreshToken("the-refresh-token");
    expect(revokeTokenMock).toHaveBeenCalledWith("the-refresh-token");
  });
});

describe("env-var validation", () => {
  it("throws a helpful error when GMAIL_OAUTH_CLIENT_ID is unset", () => {
    delete process.env["GMAIL_OAUTH_CLIENT_ID"];
    generateAuthUrlMock.mockReturnValue("https://example.com");
    expect(() => buildAuthorizationUrl()).toThrow(/GMAIL_OAUTH_CLIENT_ID/);
  });
});
