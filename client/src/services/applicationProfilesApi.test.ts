import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listApplicationProfiles,
  getApplicationProfile,
  createApplicationProfile,
  updateApplicationProfile,
  deleteApplicationProfile,
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
  resumeUrl: null,
  coverLetterUrl: null,
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

describe("WORK_AUTHORIZATION_LABELS", () => {
  it("has a human-readable label for every enum value", () => {
    expect(WORK_AUTHORIZATION_LABELS.us_citizen).toBe("US Citizen");
    expect(WORK_AUTHORIZATION_LABELS.permanent_resident).toContain("Permanent Resident");
    expect(WORK_AUTHORIZATION_LABELS.sponsorship_required).toBe("Sponsorship required");
  });
});
