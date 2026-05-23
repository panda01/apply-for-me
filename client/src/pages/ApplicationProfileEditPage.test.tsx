import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

let user: ReturnType<typeof userEvent.setup>;

const mockGet = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("../services/applicationProfilesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/applicationProfilesApi")>();
  return {
    ...actual,
    getApplicationProfile: (...args: unknown[]) => mockGet(...args),
    createApplicationProfile: (...args: unknown[]) => mockCreate(...args),
    updateApplicationProfile: (...args: unknown[]) => mockUpdate(...args),
    deleteApplicationProfile: (...args: unknown[]) => mockDelete(...args),
  };
});

/**
 * Mock useNavigate so we can assert the page pushes the user back to the
 * list after a successful create / delete.
 */
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import ApplicationProfileEditPage from "./ApplicationProfileEditPage";

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
 * Helper that renders the edit page at a specific route so useParams picks up
 * the id (or its absence, for create mode).
 *
 * @param {string} path - The route path to render
 *   ("/profiles/new" for create, "/profiles/:id/edit" for edit)
 */
function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/profiles/new" element={<ApplicationProfileEditPage />} />
        <Route path="/profiles/:id/edit" element={<ApplicationProfileEditPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  user = userEvent.setup({ delay: null });
});

describe("ApplicationProfileEditPage — create mode", () => {
  it("renders the create heading and a blank form", async () => {
    renderPage("/profiles/new");

    expect(screen.getByRole("heading", { name: /New application profile/ })).toBeDefined();
    // The form submit button reads "Create profile" in create mode.
    expect(screen.getByRole("button", { name: "Create profile" })).toBeDefined();
    // No profile load happens in create mode.
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("creates a profile and navigates back to /profiles on success", async () => {
    mockCreate.mockResolvedValue(mockProfile);
    renderPage("/profiles/new");

    await user.type(screen.getByRole("textbox", { name: "Name" }), "New");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "A");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "B");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "a@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledOnce();
    });
    expect(mockNavigate).toHaveBeenCalledWith("/profiles");
  });

  it("surfaces a server error when the create request fails", async () => {
    mockCreate.mockRejectedValue(new Error("A profile with name \"Default\" already exists"));
    renderPage("/profiles/new");

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Default");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "A");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "B");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "a@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");
    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(screen.getByText(/already exists/)).toBeDefined();
    });
    expect(mockNavigate).not.toHaveBeenCalledWith("/profiles");
  });

  it("surfaces a generic error when create rejects with a non-Error", async () => {
    mockCreate.mockRejectedValue("non-error rejection");
    renderPage("/profiles/new");

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Default");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "A");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "B");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "a@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");
    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save application profile")).toBeDefined();
    });
  });

  it("navigates back to /profiles when Cancel is clicked", async () => {
    renderPage("/profiles/new");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockNavigate).toHaveBeenCalledWith("/profiles");
  });
});

describe("ApplicationProfileEditPage — edit mode", () => {
  it("loads the profile by id and pre-fills the form fields", async () => {
    mockGet.mockResolvedValue(mockProfile);
    renderPage("/profiles/1/edit");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Edit · Default/ })).toBeDefined();
    });
    expect(mockGet).toHaveBeenCalledWith(1);

    const nameInput = screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    expect(nameInput.value).toBe("Default");
    // The submit button label flips to "Save changes" in edit mode.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
  });

  it("surfaces a load error when the API rejects", async () => {
    mockGet.mockRejectedValue(new Error("Profile not found"));
    renderPage("/profiles/1/edit");

    await waitFor(() => {
      expect(screen.getByText("Profile not found")).toBeDefined();
    });
  });

  it("surfaces a generic load error when the rejection is a non-Error", async () => {
    mockGet.mockRejectedValue("string rejection");
    renderPage("/profiles/1/edit");

    await waitFor(() => {
      expect(screen.getByText("Failed to load application profile")).toBeDefined();
    });
  });

  it("calls updateApplicationProfile and shows a Saved indicator on success", async () => {
    mockGet.mockResolvedValue(mockProfile);
    mockUpdate.mockResolvedValue({ ...mockProfile, name: "Renamed" });
    renderPage("/profiles/1/edit");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
    });

    const nameInput = screen.getByRole("textbox", { name: "Name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ name: "Renamed" }));
    });
    await waitFor(() => {
      expect(screen.getByText("Saved just now")).toBeDefined();
    });
    // Edit mode stays on the page — no navigate back to the list.
    expect(mockNavigate).not.toHaveBeenCalledWith("/profiles");
  });

  it("surfaces a generic update error when the rejection is a non-Error", async () => {
    mockGet.mockResolvedValue(mockProfile);
    mockUpdate.mockRejectedValue("string failure");
    renderPage("/profiles/1/edit");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save application profile")).toBeDefined();
    });
  });

  it("deletes the profile and navigates back when the user confirms", async () => {
    mockGet.mockResolvedValue(mockProfile);
    mockDelete.mockResolvedValue(mockProfile);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage("/profiles/1/edit");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete profile/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Delete profile/ }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/profiles");
    });
  });

  it("does NOT delete when the user cancels the confirm prompt", async () => {
    mockGet.mockResolvedValue(mockProfile);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage("/profiles/1/edit");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete profile/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Delete profile/ }));

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("surfaces a delete error when the API rejects", async () => {
    mockGet.mockResolvedValue(mockProfile);
    mockDelete.mockRejectedValue(new Error("Cannot delete locked profile"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage("/profiles/1/edit");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete profile/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Delete profile/ }));

    await waitFor(() => {
      expect(screen.getByText("Cannot delete locked profile")).toBeDefined();
    });
  });

  it("surfaces a generic delete error when the rejection is a non-Error", async () => {
    mockGet.mockResolvedValue(mockProfile);
    mockDelete.mockRejectedValue("string-rejection");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage("/profiles/1/edit");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete profile/ })).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: /Delete profile/ }));

    await waitFor(() => {
      expect(screen.getByText("Failed to delete application profile")).toBeDefined();
    });
  });

  it("dismisses the load error when its alert close button is clicked", async () => {
    mockGet.mockRejectedValue(new Error("Profile not found"));
    renderPage("/profiles/1/edit");

    await waitFor(() => {
      expect(screen.getByText("Profile not found")).toBeDefined();
    });

    const closeButton = screen.getByRole("button", { name: /close/i });
    await user.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText("Profile not found")).toBeNull();
    });
  });
});

describe("ApplicationProfileEditPage — invalid id handling", () => {
  it("falls back to create mode when the id is non-numeric", async () => {
    renderPage("/profiles/abc/edit");

    // No load is attempted with a garbage id; the page renders the create UI.
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /New application profile/ })).toBeDefined();
    expect(screen.getByRole("button", { name: "Create profile" })).toBeDefined();
  });
});
