import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ApplicationProfilesPage from "./ApplicationProfilesPage";

// Disable userEvent's per-keystroke delay so this file's many .type() calls
// don't bust the default 5s test timeout once v8 coverage instrumentation
// is layered on top. Re-bound in beforeEach so it targets the fresh DOM.
let user: ReturnType<typeof userEvent.setup>;

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("../services/applicationProfilesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/applicationProfilesApi")>();
  return {
    ...actual,
    listApplicationProfiles: (...args: unknown[]) => mockList(...args),
    createApplicationProfile: (...args: unknown[]) => mockCreate(...args),
    updateApplicationProfile: (...args: unknown[]) => mockUpdate(...args),
    deleteApplicationProfile: (...args: unknown[]) => mockDelete(...args),
  };
});

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

  it("lists existing profiles in a table", async () => {
    mockList.mockResolvedValue([mockProfile]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("cell", { name: "Default" })).toBeDefined();
    });
    expect(screen.getByRole("cell", { name: "Khalah JG" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "k@example.com" })).toBeDefined();
  });

  it("shows the empty-state CTA when no profiles exist", async () => {
    mockList.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("No application profiles yet.")).toBeDefined();
    });
    expect(screen.getByRole("button", { name: /Create your first profile/ })).toBeDefined();
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

  it("opens the create dialog and creates a profile end-to-end", { timeout: 15000 }, async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue(mockProfile);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New Profile" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "New Profile" }));

    await screen.findByRole("dialog", { name: /New application profile/ });

    await user.type(screen.getByRole("textbox", { name: "Name" }), "New");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "A");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "B");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "a@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");

    // Re-mock list to return the new profile after create succeeds
    mockList.mockResolvedValue([{ ...mockProfile, id: 2, name: "New" }]);
    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledOnce();
    });
    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("opens the edit dialog with the profile's values pre-filled", async () => {
    mockList.mockResolvedValue([mockProfile]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "edit Default" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "edit Default" }));

    await screen.findByRole("dialog", { name: /Edit profile: Default/ });
    const nameInput = screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    expect(nameInput.value).toBe("Default");
  });

  it("surfaces a save error when the server returns a unique-name conflict", { timeout: 15000 }, async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockRejectedValue(new Error("A profile with name \"Default\" already exists"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New Profile" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "New Profile" }));
    await screen.findByRole("dialog", { name: /New application profile/ });

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Default");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "A");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "B");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "a@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");
    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(screen.getByText(/already exists/)).toBeDefined();
    });
  });

  it("surfaces a generic save error when create rejects with a non-Error", { timeout: 15000 }, async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockRejectedValue("non-error rejection");
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New Profile" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "New Profile" }));
    await screen.findByRole("dialog", { name: /New application profile/ });

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

  it("updates the profile when the edit form is submitted", async () => {
    mockList.mockResolvedValue([mockProfile]);
    mockUpdate.mockResolvedValue({ ...mockProfile, name: "Renamed" });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "edit Default" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "edit Default" }));
    await screen.findByRole("dialog", { name: /Edit profile: Default/ });

    const nameInput = screen.getByRole("textbox", { name: "Name" });
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed");

    mockList.mockResolvedValue([{ ...mockProfile, name: "Renamed" }]);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ name: "Renamed" }));
    });
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

  it("surfaces a generic update error when update rejects with a non-Error", async () => {
    mockList.mockResolvedValue([mockProfile]);
    mockUpdate.mockRejectedValue("string failure");
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "edit Default" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "edit Default" }));
    await screen.findByRole("dialog", { name: /Edit profile: Default/ });

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save application profile")).toBeDefined();
    });
  });

  it("closes the dialog when Cancel is clicked", async () => {
    mockList.mockResolvedValue([mockProfile]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New Profile" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "New Profile" }));
    await screen.findByRole("dialog", { name: /New application profile/ });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
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
});
