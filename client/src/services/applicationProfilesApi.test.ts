import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listApplicationProfiles,
  getApplicationProfile,
  createApplicationProfile,
  updateApplicationProfile,
  deleteApplicationProfile,
  extractFromResume,
  uploadProfileFile,
  deleteProfileFile,
  getProfileFileUrl,
  WORK_AUTHORIZATION_LABELS,
} from "./applicationProfilesApi";

const mockProfile = {
  id: 1,
  name: "Default",
  firstName: "Khalah",
  middleName: "Ciskei",
  lastName: "Jones-Golden",
  email: "khasan222@gmail.com",
  phone: "13479770736",
  github: "https://github.com/panda01",
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
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("listApplicationProfiles", () => {
  it("returns the array on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([mockProfile]),
    }));

    const result = await listApplicationProfiles();
    expect(result).toEqual([mockProfile]);
    expect(fetch).toHaveBeenCalledWith("/api/application-profiles");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(listApplicationProfiles()).rejects.toThrow("Failed to fetch application profiles");
  });
});

describe("getApplicationProfile", () => {
  it("returns the profile on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockProfile),
    }));

    const result = await getApplicationProfile(1);
    expect(result.name).toBe("Default");
    expect(fetch).toHaveBeenCalledWith("/api/application-profiles/1");
  });

  it("throws with the server message on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Application profile not found" }),
    }));

    await expect(getApplicationProfile(99)).rejects.toThrow("Application profile not found");
  });
});

describe("createApplicationProfile", () => {
  it("POSTs the input and returns the created record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockProfile),
    }));

    const input = {
      name: "Default",
      firstName: "Khalah",
      lastName: "Jones-Golden",
      email: "khasan222@gmail.com",
      phone: "13479770736",
    };

    const result = await createApplicationProfile(input);
    expect(result.id).toBe(1);
    expect(fetch).toHaveBeenCalledWith("/api/application-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("surfaces the server error message on 400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Validation failed" }),
    }));

    await expect(
      createApplicationProfile({
        name: "Default",
        firstName: "",
        lastName: "",
        email: "x",
        phone: "x",
      })
    ).rejects.toThrow("Validation failed");
  });
});

describe("updateApplicationProfile", () => {
  it("PUTs the input and returns the updated record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...mockProfile, firstName: "Updated" }),
    }));

    const input = {
      name: "Default",
      firstName: "Updated",
      lastName: "Jones-Golden",
      email: "khasan222@gmail.com",
      phone: "13479770736",
    };

    const result = await updateApplicationProfile(1, input);
    expect(result.firstName).toBe("Updated");
    expect(fetch).toHaveBeenCalledWith("/api/application-profiles/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });
});

describe("deleteApplicationProfile", () => {
  it("DELETEs and returns the deleted record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockProfile),
    }));

    const result = await deleteApplicationProfile(1);
    expect(result.id).toBe(1);
    expect(fetch).toHaveBeenCalledWith("/api/application-profiles/1", { method: "DELETE" });
  });
});

describe("extractFromResume", () => {
  it("POSTs the file as FormData (no Content-Type header) and returns response.fields", async () => {
    const extractedFields = {
      firstName: "Khalah",
      middleName: null,
      lastName: "Jones-Golden",
      email: "khasan222@gmail.com",
      phone: "13479770736",
      github: "https://github.com/panda01",
      linkedin: null,
      website: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ fields: extractedFields }),
    }));

    const file = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    const result = await extractFromResume(file);

    expect(result).toEqual(extractedFields);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/application-profiles/extract-resume");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
    // The browser must set the multipart boundary itself, so no Content-Type.
    expect(init.headers).toBeUndefined();
  });

  it("throws the server error message on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Could not parse resume" }),
    }));

    const file = new File(["x"], "resume.pdf", { type: "application/pdf" });
    await expect(extractFromResume(file)).rejects.toThrow("Could not parse resume");
  });

  it("falls back to the default message when the error body has none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    const file = new File(["x"], "resume.pdf", { type: "application/pdf" });
    await expect(extractFromResume(file)).rejects.toThrow("Failed to import data from resume");
  });
});

describe("uploadProfileFile", () => {
  it("POSTs FormData with the file and kind, and returns the updated profile", async () => {
    const updated = { ...mockProfile, resumeStorageKey: "key-1", resumeFileName: "resume.pdf" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(updated),
    }));

    const file = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    const result = await uploadProfileFile(1, "resume", file);

    expect(result).toEqual(updated);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/application-profiles/1/files");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const body = init.body as FormData;
    expect(body.get("file")).toBe(file);
    expect(body.get("kind")).toBe("resume");
    expect(init.headers).toBeUndefined();
  });

  it("throws the server error message on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "File too large" }),
    }));

    const file = new File(["x"], "resume.pdf", { type: "application/pdf" });
    await expect(uploadProfileFile(1, "resume", file)).rejects.toThrow("File too large");
  });
});

describe("deleteProfileFile", () => {
  it("DELETEs the kind-specific files URL and returns the updated profile", async () => {
    const updated = { ...mockProfile, coverLetterStorageKey: null, coverLetterFileName: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(updated),
    }));

    const result = await deleteProfileFile(1, "coverLetter");

    expect(result).toEqual(updated);
    expect(fetch).toHaveBeenCalledWith(
      "/api/application-profiles/1/files/coverLetter",
      { method: "DELETE" }
    );
  });

  it("throws the server error message on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Nothing to remove" }),
    }));

    await expect(deleteProfileFile(1, "coverLetter")).rejects.toThrow("Nothing to remove");
  });
});

describe("getProfileFileUrl", () => {
  it("GETs the kind-specific files URL and returns response.url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: "https://storage.example.com/signed/resume.pdf" }),
    }));

    const result = await getProfileFileUrl(1, "resume");

    expect(result).toBe("https://storage.example.com/signed/resume.pdf");
    expect(fetch).toHaveBeenCalledWith("/api/application-profiles/1/files/resume");
  });

  it("throws the server error message on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "File not found" }),
    }));

    await expect(getProfileFileUrl(1, "resume")).rejects.toThrow("File not found");
  });
});

describe("WORK_AUTHORIZATION_LABELS", () => {
  it("has a human-readable label for every enum value", () => {
    expect(WORK_AUTHORIZATION_LABELS.us_citizen).toBe("US Citizen");
    expect(WORK_AUTHORIZATION_LABELS.permanent_resident).toContain("Permanent Resident");
    expect(WORK_AUTHORIZATION_LABELS.sponsorship_required).toBe("Sponsorship required");
  });
});
