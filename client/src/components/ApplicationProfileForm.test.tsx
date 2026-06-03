import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApplicationProfileForm from "./ApplicationProfileForm";
import {
  extractFromResume,
  uploadProfileFile,
  deleteProfileFile,
  getProfileFileUrl,
} from "../services/applicationProfilesApi";

/**
 * Mock the API module's file/resume functions while keeping the real
 * WORK_AUTHORIZATION_LABELS export (the work-authorization Select renders from
 * it, so it must stay intact).
 */
vi.mock("../services/applicationProfilesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/applicationProfilesApi")>();
  return {
    ...actual,
    extractFromResume: vi.fn(),
    uploadProfileFile: vi.fn(),
    deleteProfileFile: vi.fn(),
    getProfileFileUrl: vi.fn(),
  };
});

const mockExtractFromResume = vi.mocked(extractFromResume);
const mockUploadProfileFile = vi.mocked(uploadProfileFile);
const mockDeleteProfileFile = vi.mocked(deleteProfileFile);
const mockGetProfileFileUrl = vi.mocked(getProfileFileUrl);

/**
 * Per-test userEvent helper with the per-keystroke delay disabled. The
 * default 100ms-per-character delay blows past the 5s test timeout once
 * v8 coverage instrumentation layers on. Re-bound in beforeEach so it
 * always targets the freshly-rendered DOM.
 */
let user: ReturnType<typeof userEvent.setup>;

const baseProps = {
  isSaving: false,
  submitError: "",
};

/**
 * Builds a full ApplicationProfileResponse for fixtures/onSubmit resolutions
 * using the new (post-URL) file-key shape, with overrides merged on top.
 * @param {Partial<import("../services/applicationProfilesApi").ApplicationProfileResponse>} overrides
 * @returns {import("../services/applicationProfilesApi").ApplicationProfileResponse}
 */
function makeProfile(
  overrides: Partial<import("../services/applicationProfilesApi").ApplicationProfileResponse> = {}
): import("../services/applicationProfilesApi").ApplicationProfileResponse {
  return {
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
    resumeStorageKey: null,
    resumeFileName: null,
    coverLetterStorageKey: null,
    coverLetterFileName: null,
    workAuthorization: null,
    desiredSalaryMin: null,
    created_date: "2026-05-21T00:00:00.000Z",
    updated_date: "2026-05-21T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Returns the hidden resume <input type=file>. The Upload control renders it
 * with id `profile-file-input-resume`.
 * @returns {HTMLInputElement} The hidden resume file input
 */
function getResumeFileInput(): HTMLInputElement {
  const input = document.getElementById("profile-file-input-resume");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("resume file input not found");
  }
  return input;
}

/**
 * Returns the hidden cover-letter <input type=file>. The Upload control renders
 * it with id `profile-file-input-coverLetter`.
 * @returns {HTMLInputElement} The hidden cover-letter file input
 */
function getCoverLetterFileInput(): HTMLInputElement {
  const input = document.getElementById("profile-file-input-coverLetter");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("cover letter file input not found");
  }
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  user = userEvent.setup({ delay: null });
});

describe("ApplicationProfileForm", () => {
  it("submits with only required fields and normalizes empty optional inputs to null", { timeout: 15000 }, async () => {
    const onSubmit = vi.fn().mockResolvedValue(makeProfile());
    const onCancel = vi.fn();

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={onCancel} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Default");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "Khalah");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "JG");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "k@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload).toEqual(expect.objectContaining({
      name: "Default",
      firstName: "Khalah",
      lastName: "JG",
      email: "k@example.com",
      phone: "5551234567",
      middleName: null,
      github: null,
      linkedin: null,
      website: null,
      workAuthorization: null,
      desiredSalaryMin: null,
    }));
  });

  it("hydrates the form from initialValues when editing", () => {
    const profile = makeProfile({
      middleName: "Ciskei",
      github: "https://github.com/x",
      workAuthorization: "us_citizen",
      desiredSalaryMin: 120000,
    });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Default");
    expect(screen.getByRole("textbox", { name: "Middle name" })).toHaveProperty("value", "Ciskei");
    expect(screen.getByRole("spinbutton", { name: "Minimum desired salary" })).toHaveProperty("value", "120000");
  });

  // Wider timeout — this case types into ~12 fields and v8 coverage
  // instrumentation roughly triples per-event cost in this file.
  it("submits all optional fields when provided", { timeout: 15000 }, async () => {
    const onSubmit = vi.fn().mockResolvedValue(makeProfile());

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Default");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "K");
    await user.type(screen.getByRole("textbox", { name: "Middle name" }), "C");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "JG");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "k@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");
    await user.type(screen.getByRole("textbox", { name: "GitHub" }), "https://github.com/x");
    await user.type(screen.getByRole("textbox", { name: "LinkedIn" }), "https://linkedin.com/in/x");
    await user.type(screen.getByRole("textbox", { name: "Website / Portfolio" }), "https://example.com");
    await user.type(screen.getByRole("spinbutton", { name: "Minimum desired salary" }), "120000");

    await user.click(screen.getByRole("combobox", { name: /Work authorization/ }));
    await user.click(screen.getByRole("option", { name: /US Citizen/ }));

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    const payload = onSubmit.mock.calls[0]?.[0];
    expect(payload).toEqual(expect.objectContaining({
      middleName: "C",
      github: "https://github.com/x",
      linkedin: "https://linkedin.com/in/x",
      website: "https://example.com",
      workAuthorization: "us_citizen",
      desiredSalaryMin: 120000,
    }));
  });

  it("blocks submission and lists validation errors when required fields are missing", async () => {
    const onSubmit = vi.fn();
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Name is required")).toBeDefined();
    expect(screen.getByText("First name is required")).toBeDefined();
    expect(screen.getByText("Last name is required")).toBeDefined();
    expect(screen.getByText("Email is required")).toBeDefined();
    expect(screen.getByText("Phone is required")).toBeDefined();
  });

  it("rejects an invalid email format", async () => {
    const onSubmit = vi.fn();
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "X");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "A");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "B");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "not-an-email");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Email must look like/)).toBeDefined();
  });

  it("rejects a malformed optional URL", async () => {
    const onSubmit = vi.fn();
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "X");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "A");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "B");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "ok@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");
    await user.type(screen.getByRole("textbox", { name: "GitHub" }), "ftp://example.com");

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/GitHub must be a valid/)).toBeDefined();
  });

  it("rejects a negative salary", async () => {
    const onSubmit = vi.fn();
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "X");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "A");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "B");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "ok@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");
    await user.type(screen.getByRole("spinbutton", { name: "Minimum desired salary" }), "-5");

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Minimum salary must be a positive whole number/)).toBeDefined();
  });

  it("renders submit errors from the parent", () => {
    render(
      <ApplicationProfileForm
        {...baseProps}
        submitError="Profile name already exists"
        initialValues={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText("Profile name already exists")).toBeDefined();
  });

  it("invokes onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows 'Save changes' label when editing", () => {
    const profile = makeProfile({ name: "X", firstName: "A", lastName: "B", email: "x@example.com" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
  });

  it("disables inputs and shows a spinner while saving", () => {
    render(
      <ApplicationProfileForm
        {...baseProps}
        isSaving={true}
        initialValues={null}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const nameField = screen.getByRole("textbox", { name: "Name" });
    expect(nameField.hasAttribute("disabled")).toBe(true);
  });

  it("renders the Resume section with an Upload resume control before the Profile label / Identity sections", () => {
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const resumeHeading = screen.getByText("Resume");
    const uploadResumeButton = screen.getByRole("button", { name: /Upload resume/ });
    expect(uploadResumeButton).toBeDefined();

    const profileLabelHeading = screen.getByText("Profile label");
    const identityHeading = screen.getByText("Identity");

    // Resume heading must come BEFORE the Profile label and Identity headings.
    expect(
      resumeHeading.compareDocumentPosition(profileLabelHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      resumeHeading.compareDocumentPosition(identityHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("no longer renders the old Resume URL / Cover letter URL text fields", () => {
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole("textbox", { name: "Resume URL" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Cover letter URL" })).toBeNull();
  });

  it("enables 'Import from resume' only after a resume PDF is staged", async () => {
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const importButton = screen.getByRole("button", { name: "Import from resume" });
    expect(importButton.hasAttribute("disabled")).toBe(true);

    const resumeFile = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Import from resume" }).hasAttribute("disabled")).toBe(false);
    });
  });

  it("imports only empty fields from the resume and shows a success alert", { timeout: 15000 }, async () => {
    mockExtractFromResume.mockResolvedValue({
      firstName: "Resume First",
      middleName: "Resume Middle",
      lastName: "Resume Last",
      email: "resume@example.com",
      phone: "9990001111",
      github: "https://github.com/resume",
      linkedin: "https://linkedin.com/in/resume",
      website: "https://resume.example.com",
    });

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    // Pre-fill First name; import must NOT overwrite it.
    await user.type(screen.getByRole("textbox", { name: "First name" }), "Typed First");

    const resumeFile = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);

    await user.click(screen.getByRole("button", { name: "Import from resume" }));

    await waitFor(() => {
      expect(mockExtractFromResume).toHaveBeenCalledWith(resumeFile);
    });

    // First name is left untouched; the other fields are filled from the resume.
    expect(screen.getByRole("textbox", { name: "First name" })).toHaveProperty("value", "Typed First");
    expect(screen.getByRole("textbox", { name: "Middle name" })).toHaveProperty("value", "Resume Middle");
    expect(screen.getByRole("textbox", { name: "Last name" })).toHaveProperty("value", "Resume Last");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveProperty("value", "resume@example.com");
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveProperty("value", "9990001111");
    expect(screen.getByRole("textbox", { name: "GitHub" })).toHaveProperty("value", "https://github.com/resume");
    expect(screen.getByRole("textbox", { name: "LinkedIn" })).toHaveProperty("value", "https://linkedin.com/in/resume");
    expect(screen.getByRole("textbox", { name: "Website / Portfolio" })).toHaveProperty("value", "https://resume.example.com");

    expect(screen.getByText(/Imported from resume/)).toBeDefined();
  });

  it("shows an error alert when importing from the resume fails", async () => {
    mockExtractFromResume.mockRejectedValue(new Error("Could not parse resume"));

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const resumeFile = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);

    await user.click(screen.getByRole("button", { name: "Import from resume" }));

    await waitFor(() => {
      expect(screen.getByText("Could not parse resume")).toBeDefined();
    });
  });

  it("uploads a staged resume via uploadProfileFile after a successful create submit", { timeout: 15000 }, async () => {
    const createdProfile = makeProfile({ id: 42 });
    const onSubmit = vi.fn().mockResolvedValue(createdProfile);
    mockUploadProfileFile.mockResolvedValue(
      makeProfile({ id: 42, resumeStorageKey: "key-42", resumeFileName: "resume.pdf" })
    );

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Default");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "Khalah");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "JG");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "k@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");

    const resumeFile = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(mockUploadProfileFile).toHaveBeenCalledWith(42, "resume", resumeFile);
    });
  });

  it("downloads an existing server resume via getProfileFileUrl in edit mode", async () => {
    mockGetProfileFileUrl.mockResolvedValue("https://storage.example.com/signed/resume.pdf");
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    const profile = makeProfile({ resumeStorageKey: "key-1", resumeFileName: "resume.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Download resume" }));

    await waitFor(() => {
      expect(mockGetProfileFileUrl).toHaveBeenCalledWith(1, "resume");
    });
    expect(openSpy).toHaveBeenCalledWith(
      "https://storage.example.com/signed/resume.pdf",
      "_blank",
      "noopener,noreferrer"
    );
    openSpy.mockRestore();
  });

  it("removes an existing server resume via deleteProfileFile in edit mode", async () => {
    mockDeleteProfileFile.mockResolvedValue(makeProfile({ resumeStorageKey: null, resumeFileName: null }));

    const profile = makeProfile({ resumeStorageKey: "key-1", resumeFileName: "resume.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Remove resume" }));

    await waitFor(() => {
      expect(mockDeleteProfileFile).toHaveBeenCalledWith(1, "resume");
    });
  });

  it("shows the server filename and a 'Replace resume' button (not 'Upload') in edit mode with an existing file", () => {
    const profile = makeProfile({ resumeStorageKey: "key-1", resumeFileName: "my-resume.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("my-resume.pdf")).toBeDefined();
    expect(screen.getByRole("button", { name: /Replace resume/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Upload resume/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Download resume" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove resume" })).toBeDefined();
  });

  it("shows an error alert when downloading a server resume fails", async () => {
    mockGetProfileFileUrl.mockRejectedValue(new Error("Could not sign URL"));

    const profile = makeProfile({ resumeStorageKey: "key-1", resumeFileName: "resume.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Download resume" }));

    await waitFor(() => {
      expect(screen.getByText("Could not sign URL")).toBeDefined();
    });
  });

  it("shows an error alert when removing a server resume fails", async () => {
    mockDeleteProfileFile.mockRejectedValue(new Error("Could not delete file"));

    const profile = makeProfile({ resumeStorageKey: "key-1", resumeFileName: "resume.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Remove resume" }));

    await waitFor(() => {
      expect(screen.getByText("Could not delete file")).toBeDefined();
    });
  });

  it("uploads immediately (not staged) when choosing a new resume in edit mode", async () => {
    mockUploadProfileFile.mockResolvedValue(
      makeProfile({ resumeStorageKey: "key-new", resumeFileName: "new-resume.pdf" })
    );

    const profile = makeProfile({ resumeStorageKey: "key-1", resumeFileName: "old-resume.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const newResume = new File(["new bytes"], "new-resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), newResume);

    await waitFor(() => {
      expect(mockUploadProfileFile).toHaveBeenCalledWith(1, "resume", newResume);
    });
    await waitFor(() => {
      expect(screen.getByText("new-resume.pdf")).toBeDefined();
    });
  });

  it("shows an error alert when an edit-mode immediate upload fails", async () => {
    mockUploadProfileFile.mockRejectedValue(new Error("Upload exploded"));

    const profile = makeProfile({ resumeStorageKey: "key-1", resumeFileName: "old-resume.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const newResume = new File(["new bytes"], "new-resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), newResume);

    await waitFor(() => {
      expect(screen.getByText("Upload exploded")).toBeDefined();
    });
  });

  it("uploads a new cover letter immediately in edit mode against the existing id", async () => {
    mockUploadProfileFile.mockResolvedValue(
      makeProfile({ coverLetterStorageKey: "cl-key", coverLetterFileName: "cover.pdf" })
    );

    const profile = makeProfile();
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const coverFile = new File(["cover bytes"], "cover.pdf", { type: "application/pdf" });
    await user.upload(getCoverLetterFileInput(), coverFile);

    await waitFor(() => {
      expect(mockUploadProfileFile).toHaveBeenCalledWith(1, "coverLetter", coverFile);
    });
  });

  it("removes an existing server cover letter via deleteProfileFile in edit mode", async () => {
    mockDeleteProfileFile.mockResolvedValue(
      makeProfile({ coverLetterStorageKey: null, coverLetterFileName: null })
    );

    const profile = makeProfile({ coverLetterStorageKey: "cl-key", coverLetterFileName: "cover.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Remove cover letter" }));

    await waitFor(() => {
      expect(mockDeleteProfileFile).toHaveBeenCalledWith(1, "coverLetter");
    });
  });

  it("downloads an existing server cover letter via getProfileFileUrl in edit mode", async () => {
    mockGetProfileFileUrl.mockResolvedValue("https://storage.example.com/signed/cover.pdf");
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    const profile = makeProfile({ coverLetterStorageKey: "cl-key", coverLetterFileName: "cover.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Download cover letter" }));

    await waitFor(() => {
      expect(mockGetProfileFileUrl).toHaveBeenCalledWith(1, "coverLetter");
    });
    expect(openSpy).toHaveBeenCalledWith(
      "https://storage.example.com/signed/cover.pdf",
      "_blank",
      "noopener,noreferrer"
    );
    openSpy.mockRestore();
  });

  it("stages a cover letter in create mode and clears it via 'Remove staged cover letter' with no API call", async () => {
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const coverFile = new File(["cover bytes"], "staged-cover.pdf", { type: "application/pdf" });
    await user.upload(getCoverLetterFileInput(), coverFile);

    await waitFor(() => {
      expect(screen.getByText("staged-cover.pdf")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Remove staged cover letter" }));

    await waitFor(() => {
      expect(screen.queryByText("staged-cover.pdf")).toBeNull();
    });
    expect(mockUploadProfileFile).not.toHaveBeenCalled();
    expect(mockDeleteProfileFile).not.toHaveBeenCalled();
  });

  it("dismisses the import success info alert when its close button is clicked", { timeout: 15000 }, async () => {
    mockExtractFromResume.mockResolvedValue({
      firstName: "Resume First",
      middleName: null,
      lastName: "Resume Last",
      email: null,
      phone: null,
      github: null,
      linkedin: null,
      website: null,
    });

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const resumeFile = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);
    await user.click(screen.getByRole("button", { name: "Import from resume" }));

    const notice = await screen.findByText(/Imported from resume/);
    expect(notice).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByText(/Imported from resume/)).toBeNull();
    });
  });

  it("uploads BOTH a staged resume and a staged cover letter after a create submit", { timeout: 15000 }, async () => {
    const createdProfile = makeProfile({ id: 7, resumeStorageKey: null, coverLetterStorageKey: null });
    const onSubmit = vi.fn().mockResolvedValue(createdProfile);
    mockUploadProfileFile
      .mockResolvedValueOnce(makeProfile({ id: 7, resumeStorageKey: "rk", resumeFileName: "resume.pdf" }))
      .mockResolvedValueOnce(makeProfile({ id: 7, coverLetterStorageKey: "ck", coverLetterFileName: "cover.pdf" }));

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Default");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "Khalah");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "JG");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "k@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");

    const resumeFile = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    const coverFile = new File(["cover bytes"], "cover.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);
    await user.upload(getCoverLetterFileInput(), coverFile);

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(mockUploadProfileFile).toHaveBeenCalledWith(7, "resume", resumeFile);
    });
    await waitFor(() => {
      expect(mockUploadProfileFile).toHaveBeenCalledWith(7, "coverLetter", coverFile);
    });
  });

  it("shows a 'uploading a document failed' alert when a staged upload fails during submit", { timeout: 15000 }, async () => {
    const createdProfile = makeProfile({ id: 9, resumeStorageKey: null });
    const onSubmit = vi.fn().mockResolvedValue(createdProfile);
    mockUploadProfileFile.mockRejectedValue(new Error("Staged upload failed badly"));

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Default");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "Khalah");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "JG");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "k@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");

    const resumeFile = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(screen.getByText("Staged upload failed badly")).toBeDefined();
    });
  });

  it("clears a staged resume in create mode via 'Remove staged resume' with no API call", async () => {
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const resumeFile = new File(["resume bytes"], "staged-resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);

    await waitFor(() => {
      expect(screen.getByText("staged-resume.pdf")).toBeDefined();
    });

    await user.click(screen.getByRole("button", { name: "Remove staged resume" }));

    await waitFor(() => {
      expect(screen.queryByText("staged-resume.pdf")).toBeNull();
    });
    expect(mockUploadProfileFile).not.toHaveBeenCalled();
    expect(mockDeleteProfileFile).not.toHaveBeenCalled();
  });

  it("falls back to a default message when an edit-mode upload rejects with a non-Error value", async () => {
    // Rejecting with a non-Error string exercises the `err instanceof Error`
    // false branch and the kind-specific default message.
    mockUploadProfileFile.mockRejectedValue("just a string");

    const profile = makeProfile({ resumeStorageKey: "key-1", resumeFileName: "old-resume.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const newResume = new File(["new bytes"], "new-resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), newResume);

    await waitFor(() => {
      expect(screen.getByText("Failed to upload resume")).toBeDefined();
    });
  });

  it("falls back to a default message when an edit-mode cover-letter delete rejects with a non-Error value", async () => {
    mockDeleteProfileFile.mockRejectedValue("oops");

    const profile = makeProfile({ coverLetterStorageKey: "cl-key", coverLetterFileName: "cover.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Remove cover letter" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to remove cover letter")).toBeDefined();
    });
  });

  it("falls back to a default message when a download rejects with a non-Error value", async () => {
    mockGetProfileFileUrl.mockRejectedValue("nope");

    const profile = makeProfile({ resumeStorageKey: "key-1", resumeFileName: "resume.pdf" });
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Download resume" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to open document")).toBeDefined();
    });
  });

  it("falls back to a default message when resume import rejects with a non-Error value", async () => {
    mockExtractFromResume.mockRejectedValue("kaboom");

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    const resumeFile = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);
    await user.click(screen.getByRole("button", { name: "Import from resume" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to read the resume")).toBeDefined();
    });
  });

  it("falls back to a default message when a staged submit upload rejects with a non-Error value", { timeout: 15000 }, async () => {
    const createdProfile = makeProfile({ id: 13, resumeStorageKey: null });
    const onSubmit = vi.fn().mockResolvedValue(createdProfile);
    mockUploadProfileFile.mockRejectedValue("string failure");

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Default");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "Khalah");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "JG");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "k@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");

    const resumeFile = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(screen.getByText("Profile saved, but uploading a document failed")).toBeDefined();
    });
  });

  it("ignores a file-picker change event that yields no file (cleared picker)", async () => {
    const onFileChosenWatcher = vi.fn();
    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    // Fire a change event with an empty FileList to hit the `?? null` branch and
    // the `file === null` early-return in handleFileChosen.
    const input = getResumeFileInput();
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // No staged file should appear and no upload should be attempted.
    expect(mockUploadProfileFile).not.toHaveBeenCalled();
    expect(onFileChosenWatcher).not.toHaveBeenCalled();
  });

  it("does NOT re-upload a staged resume when the saved profile already has a resume storage key", { timeout: 15000 }, async () => {
    // onSubmit resolves with a profile that already has a resume key, so the
    // staged file must be considered already-persisted and not re-uploaded.
    const savedProfile = makeProfile({ id: 11, resumeStorageKey: "already-there", resumeFileName: "resume.pdf" });
    const onSubmit = vi.fn().mockResolvedValue(savedProfile);

    render(<ApplicationProfileForm {...baseProps} initialValues={null} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Default");
    await user.type(screen.getByRole("textbox", { name: "First name" }), "Khalah");
    await user.type(screen.getByRole("textbox", { name: "Last name" }), "JG");
    await user.type(screen.getByRole("textbox", { name: "Email" }), "k@example.com");
    await user.type(screen.getByRole("textbox", { name: "Phone" }), "5551234567");

    const resumeFile = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    await user.upload(getResumeFileInput(), resumeFile);

    await user.click(screen.getByRole("button", { name: "Create profile" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    expect(mockUploadProfileFile).not.toHaveBeenCalled();
  });
});
