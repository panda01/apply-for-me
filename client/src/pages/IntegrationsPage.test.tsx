import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

let user: ReturnType<typeof userEvent.setup>;

const mockGetAuthUrl = vi.fn();
const mockListConnections = vi.fn();
const mockDeleteConnection = vi.fn();

vi.mock("../services/gmailApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/gmailApi")>();
  return {
    ...actual,
    getGmailAuthorizationUrl: (...args: unknown[]) => mockGetAuthUrl(...args),
    listGmailConnections: (...args: unknown[]) => mockListConnections(...args),
    deleteGmailConnection: (...args: unknown[]) => mockDeleteConnection(...args),
  };
});

import IntegrationsPage from "./IntegrationsPage";

const sampleConnection = {
  id: 1,
  google_email: "user@example.com",
  scopes: "https://www.googleapis.com/auth/gmail.readonly openid email",
  access_token_expires_at: "2099-01-01T00:00:00.000Z",
  created_date: "2026-05-23T17:00:00.000Z",
  updated_date: "2026-05-23T17:00:00.000Z",
};

/**
 * Wraps IntegrationsPage in a MemoryRouter so useSearchParams + useNavigate
 * are satisfied. `initialEntries` lets each test simulate a different URL.
 *
 * @param {string[]} initialEntries - The router history to seed
 */
function renderPage(initialEntries: string[] = ["/integrations"]): void {
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <IntegrationsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  user = userEvent.setup({ delay: null });
  // window.confirm defaults to false in jsdom — stub to true so the
  // disconnect flow proceeds without prompting.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("IntegrationsPage", () => {
  it("renders the empty state when no connections are returned", async () => {
    mockListConnections.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no gmail accounts connected/i)).toBeDefined();
    });
  });

  it("renders each persisted connection as a row", async () => {
    mockListConnections.mockResolvedValue([sampleConnection]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("user@example.com")).toBeDefined();
    });
    expect(screen.getByText(/scopes:/i)).toBeDefined();
  });

  it("redirects window.location to the auth URL when Connect Gmail is clicked", async () => {
    mockListConnections.mockResolvedValue([]);
    mockGetAuthUrl.mockResolvedValue({ url: "https://accounts.google.com/fake", state: "abc" });

    // window.location.href is read-only on the prototype — replace the whole
    // object so we can capture the assignment without crashing jsdom.
    const originalLocation = window.location;
    const locationStub = { href: "" } as Pick<Location, "href">;
    Object.defineProperty(window, "location", { value: locationStub, writable: true });

    try {
      renderPage();
      await waitFor(() => { expect(screen.getByText(/no gmail accounts connected/i)).toBeDefined(); });

      await user.click(screen.getByRole("button", { name: /connect gmail/i }));

      await waitFor(() => {
        expect(locationStub.href).toBe("https://accounts.google.com/fake");
      });
    } finally {
      Object.defineProperty(window, "location", { value: originalLocation, writable: true });
    }
  });

  it("shows a success snackbar when the URL carries ?connected=…", async () => {
    mockListConnections.mockResolvedValue([sampleConnection]);

    renderPage(["/integrations?connected=user%40example.com"]);

    await waitFor(() => {
      expect(screen.getByText(/connected user@example.com/i)).toBeDefined();
    });
  });

  it("shows an error snackbar when the URL carries ?error=…", async () => {
    mockListConnections.mockResolvedValue([]);

    renderPage(["/integrations?error=invalid_or_expired_state"]);

    await waitFor(() => {
      expect(screen.getByText(/gmail connect failed: invalid_or_expired_state/i)).toBeDefined();
    });
  });

  it("calls deleteGmailConnection and refreshes the list when a disconnect is confirmed", async () => {
    mockListConnections.mockResolvedValueOnce([sampleConnection]).mockResolvedValueOnce([]);
    mockDeleteConnection.mockResolvedValue({ deleted: sampleConnection, revokeWarning: null });

    renderPage();
    await waitFor(() => { expect(screen.getByText("user@example.com")).toBeDefined(); });

    await user.click(screen.getByLabelText(/disconnect user@example\.com/i));

    await waitFor(() => {
      expect(mockDeleteConnection).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(screen.getByText(/no gmail accounts connected/i)).toBeDefined();
    });
  });

  it("shows an error alert when listGmailConnections rejects", async () => {
    mockListConnections.mockRejectedValue(new Error("connection refused"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/connection refused/i)).toBeDefined();
    });
  });

  it("shows an error alert when getGmailAuthorizationUrl rejects", async () => {
    mockListConnections.mockResolvedValue([]);
    mockGetAuthUrl.mockRejectedValue(new Error("auth url failed"));

    renderPage();
    await waitFor(() => { expect(screen.getByText(/no gmail accounts connected/i)).toBeDefined(); });

    await user.click(screen.getByRole("button", { name: /connect gmail/i }));

    await waitFor(() => {
      expect(screen.getByText(/auth url failed/i)).toBeDefined();
    });
  });

  it("does not delete when the user cancels the confirm prompt", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mockListConnections.mockResolvedValue([sampleConnection]);

    renderPage();
    await waitFor(() => { expect(screen.getByText("user@example.com")).toBeDefined(); });

    await user.click(screen.getByLabelText(/disconnect user@example\.com/i));

    expect(mockDeleteConnection).not.toHaveBeenCalled();
  });

  it("shows an error alert when deleteGmailConnection rejects", async () => {
    mockListConnections.mockResolvedValue([sampleConnection]);
    mockDeleteConnection.mockRejectedValue(new Error("server exploded"));

    renderPage();
    await waitFor(() => { expect(screen.getByText("user@example.com")).toBeDefined(); });

    await user.click(screen.getByLabelText(/disconnect user@example\.com/i));

    await waitFor(() => {
      expect(screen.getByText(/server exploded/i)).toBeDefined();
    });
  });

  it("surfaces the revokeWarning as a warning snackbar when one is returned", async () => {
    mockListConnections.mockResolvedValueOnce([sampleConnection]).mockResolvedValueOnce([]);
    mockDeleteConnection.mockResolvedValue({ deleted: sampleConnection, revokeWarning: "token already revoked" });

    renderPage();
    await waitFor(() => { expect(screen.getByText("user@example.com")).toBeDefined(); });

    await user.click(screen.getByLabelText(/disconnect user@example\.com/i));

    await waitFor(() => {
      expect(screen.getByText(/token already revoked/i)).toBeDefined();
    });
  });
});
