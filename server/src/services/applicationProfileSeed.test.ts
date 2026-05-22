import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prismaClient.js", () => ({
  default: {
    applicationProfile: {
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: { ...actual, readFile: mockReadFile },
    readFile: mockReadFile,
  };
});

import prisma from "../prismaClient.js";
import { seedDefaultProfileIfEmpty } from "./applicationProfileSeed.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("seedDefaultProfileIfEmpty", () => {
  it("does nothing when the table already has rows", async () => {
    vi.mocked(prisma.applicationProfile.count).mockResolvedValue(3);

    await seedDefaultProfileIfEmpty();

    expect(prisma.applicationProfile.create).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("creates a Default profile from user_info.json when the table is empty", async () => {
    vi.mocked(prisma.applicationProfile.count).mockResolvedValue(0);
    mockReadFile.mockResolvedValue(JSON.stringify({
      firstName: "Khalah",
      middleName: "Ciskei",
      lastName: "Jones-Golden",
      email: "khasan222@gmail.com",
      phone: "13479770736",
      github: "https://github.com/panda01",
      linkedin: "https://www.linkedin.com/in/khalahjonesgolden/",
      website: "https://khalah.medium.com",
      resumeUrl: "https://drive.google.com/file/d/x/view",
    }));
    vi.mocked(prisma.applicationProfile.create).mockResolvedValue({} as never);

    await seedDefaultProfileIfEmpty();

    expect(prisma.applicationProfile.create).toHaveBeenCalledOnce();
    const arg = vi.mocked(prisma.applicationProfile.create).mock.calls[0]?.[0];
    expect(arg?.data.name).toBe("Default");
    expect(arg?.data.firstName).toBe("Khalah");
    expect(arg?.data.middleName).toBe("Ciskei");
  });

  it("uses nulls for optional fields when the JSON omits them", async () => {
    vi.mocked(prisma.applicationProfile.count).mockResolvedValue(0);
    mockReadFile.mockResolvedValue(JSON.stringify({
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
      phone: "5551234567",
    }));
    vi.mocked(prisma.applicationProfile.create).mockResolvedValue({} as never);

    await seedDefaultProfileIfEmpty();

    const arg = vi.mocked(prisma.applicationProfile.create).mock.calls[0]?.[0];
    expect(arg?.data.middleName).toBeNull();
    expect(arg?.data.github).toBeNull();
    expect(arg?.data.linkedin).toBeNull();
    expect(arg?.data.website).toBeNull();
    expect(arg?.data.resumeUrl).toBeNull();
  });

  it("logs and bails when user_info.json cannot be read", async () => {
    vi.mocked(prisma.applicationProfile.count).mockResolvedValue(0);
    mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await seedDefaultProfileIfEmpty();

    expect(prisma.applicationProfile.create).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No user_info.json found"));
    logSpy.mockRestore();
  });

  it("stringifies a non-Error rejection from readFile", async () => {
    vi.mocked(prisma.applicationProfile.count).mockResolvedValue(0);
    mockReadFile.mockRejectedValue("string failure");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await seedDefaultProfileIfEmpty();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("string failure"));
    logSpy.mockRestore();
  });

  it("logs and bails when user_info.json is not valid JSON", async () => {
    vi.mocked(prisma.applicationProfile.count).mockResolvedValue(0);
    mockReadFile.mockResolvedValue("not-json{");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await seedDefaultProfileIfEmpty();

    expect(prisma.applicationProfile.create).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to parse user_info.json"));
    errorSpy.mockRestore();
  });

  it("stringifies a non-Error caught during JSON.parse", async () => {
    vi.mocked(prisma.applicationProfile.count).mockResolvedValue(0);
    // JSON.parse always throws SyntaxError instances so we cannot reach the
    // non-Error branch via valid input. Force the branch by mocking readFile
    // to resolve with a value that confuses the JSON.parse() and triggers
    // the catch path with a string thrown — covered by symbol replacement
    // would be brittle, so instead we simulate by stubbing JSON.parse below.
    const originalParse = JSON.parse;
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementation(() => { throw "non-error parse failure"; });
    mockReadFile.mockResolvedValue("anything");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await seedDefaultProfileIfEmpty();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("non-error parse failure"));
    parseSpy.mockRestore();
    errorSpy.mockRestore();
    JSON.parse = originalParse;
  });
});
