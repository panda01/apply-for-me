import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApplicationProfileForm from "./ApplicationProfileForm";

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

beforeEach(() => {
  vi.clearAllMocks();
  user = userEvent.setup({ delay: null });
});

describe("ApplicationProfileForm", () => {
  it("submits with only required fields and normalizes empty optional inputs to null", { timeout: 15000 }, async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
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
      resumeUrl: null,
      coverLetterUrl: null,
      workAuthorization: null,
      desiredSalaryMin: null,
    }));
  });

  it("hydrates the form from initialValues when editing", () => {
    const profile = {
      id: 1,
      name: "Default",
      firstName: "Khalah",
      middleName: "Ciskei",
      lastName: "JG",
      email: "k@example.com",
      phone: "5551234567",
      github: "https://github.com/x",
      linkedin: null,
      website: null,
      resumeUrl: null,
      coverLetterUrl: null,
      workAuthorization: "us_citizen" as const,
      desiredSalaryMin: 120000,
      created_date: "2026-05-21T00:00:00.000Z",
      updated_date: "2026-05-21T00:00:00.000Z",
    };
    render(<ApplicationProfileForm {...baseProps} initialValues={profile} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Default");
    expect(screen.getByRole("textbox", { name: "Middle name" })).toHaveProperty("value", "Ciskei");
    expect(screen.getByRole("spinbutton", { name: "Minimum desired salary" })).toHaveProperty("value", "120000");
  });

  // Wider timeout — this case types into ~12 fields and v8 coverage
  // instrumentation roughly triples per-event cost in this file.
  it("submits all optional fields when provided", { timeout: 15000 }, async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

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
    await user.type(screen.getByRole("textbox", { name: "Resume URL" }), "https://example.com/r");
    await user.type(screen.getByRole("textbox", { name: "Cover letter URL" }), "https://example.com/cl");
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
      resumeUrl: "https://example.com/r",
      coverLetterUrl: "https://example.com/cl",
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
    const profile = {
      id: 1, name: "X", firstName: "A", middleName: null, lastName: "B",
      email: "x@example.com", phone: "5551234567",
      github: null, linkedin: null, website: null, resumeUrl: null,
      coverLetterUrl: null, workAuthorization: null, desiredSalaryMin: null,
      created_date: "2026-05-21T00:00:00.000Z",
      updated_date: "2026-05-21T00:00:00.000Z",
    };
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
});
