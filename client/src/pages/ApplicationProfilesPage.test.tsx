import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Disable userEvent's per-keystroke delay so click flurries don't bust the
// default 5s test timeout once v8 coverage instrumentation is layered on top.
let user: ReturnType<typeof userEvent.setup>;

const mockList = vi.fn();
const mockDelete = vi.fn();

vi.mock("../services/applicationProfilesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/applicationProfilesApi")>();
  return {
    ...actual,
    listApplicationProfiles: (...args: unknown[]) => mockList(...args),
    deleteApplicationProfile: (...args: unknown[]) => mockDelete(...args),
  };
});

/**
 * The page now navigates to standalone create/edit pages via useNavigate
 * instead of opening an MUI Dialog. Mock useNavigate so we can assert the
 * exact route the page pushes onto history.
 */
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import ApplicationProfilesPage from "./ApplicationProfilesPage";

const mockProfile = {
  id: 1,
  name: "Default",
  firstName: "Khalah",
  middleName: null,
  lastName: "JG",
  email: "k@example.com",
  phone: "5551234567",
  github: null,
  linkedin: null,
  website: null,
  resumeUrl: null,
  coverLetterUrl: null,
  workAuthorization: null,
  desiredSalaryMin: null,
  created_date: "2026-05-21T00:00:00.000Z",
  updated_date: "2026-05-21T00:00:00.000Z",
};

/**
 * Helper to render the ApplicationProfilesPage inside a MemoryRouter so
 * `useNavigate` and `<Link>`/`<RouterLink>` children resolve correctly.
 */
function renderPage() {
  return render(
    <MemoryRouter>
      <ApplicationProfilesPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  user = userEvent.setup({ delay: null });
});

describe("ApplicationProfilesPage", () => {
  it("shows a loading spinner initially", () => {
    mockList.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("progressbar")).toBeDefined();
  });

  it("lists existing profiles in a row card", async () => {
    mockList.mockResolvedValue([mockProfile]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId(`profile-row-${String(mockProfile.id)}`)).toBeDefined();
    });
    // Profile label is rendered as the row's `.profile-row-label` span.
    expect(screen.getByText("Default")).toBeDefined();
    // The meta row concatenates name + email + phone with the design's "·" separator.
    expect(screen.getByText(/Khalah JG/)).toBeDefined();
    expect(screen.getByText(/k@example\.com/)).toBeDefined();
  });

  it("shows the empty-state CTA when no profiles exist", async () => {
    mockList.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("No profiles yet")).toBeDefined();
    });
    // The empty state explains what creating a profile gives you.
    expect(
      screen.getByText(/Create your first application profile to start auto-applying\./)
    ).toBeDefined();
  });

  it("surfaces a fetch error", async () => {
    mockList.mockRejectedValue(new Error("Network down"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Network down")).toBeDefined();
    });
  });

  it("surfaces a generic message when fetch rejects with a non-Error", async () => {
    mockList.mockRejectedValue("string rejection");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Failed to load application profiles")).toBeDefined();
    });
  });

  it("navigates to /profiles/new when the New profile button is clicked", async () => {
    mockList.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New profile" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "New profile" }));

    expect(mockNavigate).toHaveBeenCalledWith("/profiles/new");
  });

  it("navigates to /profiles/:id/edit when a row's Edit button is clicked", async () => {
    mockList.mockResolvedValue([mockProfile]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "edit Default" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "edit Default" }));

    expect(mockNavigate).toHaveBeenCalledWith("/profiles/1/edit");
  });

  it("deletes a profile after the user confirms", async () => {
    mockList.mockResolvedValue([mockProfile]);
    mockDelete.mockResolvedValue(mockProfile);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "delete Default" })).toBeDefined();
    });
    mockList.mockResolvedValue([]);
    await user.click(screen.getByRole("button", { name: "delete Default" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(1);
    });
  });

  it("does NOT delete when the user cancels the confirm prompt", async () => {
    mockList.mockResolvedValue([mockProfile]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "delete Default" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "delete Default" }));

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("surfaces a delete error", async () => {
    mockList.mockResolvedValue([mockProfile]);
    mockDelete.mockRejectedValue(new Error("Could not delete"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "delete Default" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "delete Default" }));

    await waitFor(() => {
      expect(screen.getByText("Could not delete")).toBeDefined();
    });
  });

  it("surfaces a generic delete error when the rejection is a non-Error", async () => {
    mockList.mockResolvedValue([mockProfile]);
    mockDelete.mockRejectedValue("string failure");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "delete Default" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "delete Default" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to delete application profile")).toBeDefined();
    });
  });

  it("clears the list-level error when the Close button on its alert is clicked", async () => {
    mockList.mockRejectedValue(new Error("Network down"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Network down")).toBeDefined();
    });

    const closeButton = screen.getByRole("button", { name: /close/i });
    await user.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText("Network down")).toBeNull();
    });
  });

  it("renders populated workAuthorization, salary, resume, and cover letter labels", async () => {
    mockList.mockResolvedValue([
      {
        ...mockProfile,
        middleName: "Q",
        workAuthorization: "us_citizen",
        desiredSalaryMin: 95000,
        resumeUrl: "https://example.com/resume.pdf",
        coverLetterUrl: "https://example.com/cover.pdf",
      },
    ]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Khalah Q JG/)).toBeDefined();
    });
    expect(screen.getByText("Resume")).toBeDefined();
    expect(screen.getByText("Cover letter")).toBeDefined();
    expect(screen.getByText(/Min \$95000/)).toBeDefined();
    expect(screen.getByText(/US Citizen/i)).toBeDefined();
  });

  it("falls back to '?' initials when first and last names are both empty", async () => {
    mockList.mockResolvedValue([
      { ...mockProfile, firstName: "", lastName: "" },
    ]);
    renderPage();

    await waitFor(() => {
      const avatar = screen.getByTestId(`profile-row-${String(mockProfile.id)}`).querySelector(".profile-row-avatar");
      expect(avatar?.textContent).toBe("?");
    });
  });
});
