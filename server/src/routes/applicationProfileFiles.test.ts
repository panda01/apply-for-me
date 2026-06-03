import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../prismaClient.js", () => {
  return {
    default: {
      applicationProfile: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

// Mock the GCS storage service so the route module never touches real Google
// Cloud Storage. buildResumeKey / buildCoverLetterKey return deterministic keys
// so assertions on the persisted storage key are stable.
vi.mock("../services/gcsStorageService.js", () => {
  return {
    buildResumeKey: vi.fn((profileId: number) => `resume/${String(profileId)}-fixed-uuid.pdf`),
    buildCoverLetterKey: vi.fn((profileId: number) => `cover-letters/${String(profileId)}-fixed-uuid.pdf`),
    uploadPdf: vi.fn(),
    getSignedReadUrl: vi.fn(),
    deleteObject: vi.fn(),
  };
});

import prisma from "../prismaClient.js";
import {
  buildResumeKey,
  buildCoverLetterKey,
  uploadPdf,
  getSignedReadUrl,
  deleteObject,
} from "../services/gcsStorageService.js";
import { applicationProfileFilesRouter } from "./applicationProfileFiles.js";

/**
 * Builds a dedicated express app mounting only the file router under the same
 * base path it lives under in production. Keeps these tests isolated from the
 * CRUD router so multipart handling is exercised in a minimal surface.
 * @returns {import("express").Express} The configured express app
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/application-profiles", applicationProfileFilesRouter);
  return app;
}

const app = buildApp();

/** Minimal valid PDF byte sequence (starts with the "%PDF-" magic signature). */
const VALID_PDF_BYTES = "%PDF-1.4 x";

/**
 * Builds an ApplicationProfile fixture in the post-migration column shape
 * (resumeStorageKey / resumeFileName / coverLetterStorageKey / coverLetterFileName).
 * @param {Record<string, unknown>} overrides - Field-level overrides
 * @returns {Record<string, unknown>} The profile row fixture
 */
function buildProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: "Default",
    firstName: "Khalah",
    middleName: "Ciskei",
    lastName: "Jones-Golden",
    email: "khasan222@gmail.com",
    phone: "13479770736",
    github: "https://github.com/panda01",
    linkedin: "https://www.linkedin.com/in/khalahjonesgolden/",
    website: "https://khalah.medium.com",
    resumeStorageKey: null,
    resumeFileName: null,
    coverLetterStorageKey: null,
    coverLetterFileName: null,
    workAuthorization: null,
    desiredSalaryMin: null,
    created_date: new Date("2026-05-21T00:00:00.000Z"),
    updated_date: new Date("2026-05-21T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/application-profiles/:id/files", () => {
  it("uploads a resume, stores its key and original filename, and returns the updated row", async () => {
    const profile = buildProfile();
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(profile as never);
    vi.mocked(prisma.applicationProfile.update).mockResolvedValue({
      ...profile,
      resumeStorageKey: "resume/1-fixed-uuid.pdf",
      resumeFileName: "my-resume.pdf",
    } as never);

    const response = await request(app)
      .post("/api/application-profiles/1/files")
      .field("kind", "resume")
      .attach("file", Buffer.from(VALID_PDF_BYTES), { filename: "my-resume.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(200);
    expect(buildResumeKey).toHaveBeenCalledWith(1);
    expect(uploadPdf).toHaveBeenCalledWith("resume/1-fixed-uuid.pdf", expect.any(Buffer));
    expect(prisma.applicationProfile.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        resumeStorageKey: "resume/1-fixed-uuid.pdf",
        resumeFileName: "my-resume.pdf",
      },
    });
    expect(response.body.resumeStorageKey).toBe("resume/1-fixed-uuid.pdf");
    expect(response.body.resumeFileName).toBe("my-resume.pdf");
  });

  it("uploads a cover letter, setting the cover-letter columns", async () => {
    const profile = buildProfile();
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(profile as never);
    vi.mocked(prisma.applicationProfile.update).mockResolvedValue({
      ...profile,
      coverLetterStorageKey: "cover-letters/1-fixed-uuid.pdf",
      coverLetterFileName: "letter.pdf",
    } as never);

    const response = await request(app)
      .post("/api/application-profiles/1/files")
      .field("kind", "coverLetter")
      .attach("file", Buffer.from(VALID_PDF_BYTES), { filename: "letter.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(200);
    expect(buildCoverLetterKey).toHaveBeenCalledWith(1);
    expect(prisma.applicationProfile.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        coverLetterStorageKey: "cover-letters/1-fixed-uuid.pdf",
        coverLetterFileName: "letter.pdf",
      },
    });
  });

  it("deletes the previously stored file when replacing an existing resume", async () => {
    const profile = buildProfile({ resumeStorageKey: "resume/1-old-uuid.pdf", resumeFileName: "old.pdf" });
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(profile as never);
    vi.mocked(prisma.applicationProfile.update).mockResolvedValue(profile as never);

    const response = await request(app)
      .post("/api/application-profiles/1/files")
      .field("kind", "resume")
      .attach("file", Buffer.from(VALID_PDF_BYTES), { filename: "new.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledWith("resume/1-old-uuid.pdf");
  });

  it("returns 400 for an invalid kind", async () => {
    const response = await request(app)
      .post("/api/application-profiles/1/files")
      .field("kind", "bogus")
      .attach("file", Buffer.from(VALID_PDF_BYTES), { filename: "x.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/kind must be one of/);
    expect(uploadPdf).not.toHaveBeenCalled();
  });

  it("returns 400 when the uploaded file's mimetype is not application/pdf", async () => {
    const response = await request(app)
      .post("/api/application-profiles/1/files")
      .field("kind", "resume")
      .attach("file", Buffer.from("plain text"), { filename: "notes.txt", contentType: "text/plain" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Only PDF files are allowed/);
  });

  it("returns 400 when the bytes are not a real PDF even though the mimetype claims PDF", async () => {
    const profile = buildProfile();
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(profile as never);

    const response = await request(app)
      .post("/api/application-profiles/1/files")
      .field("kind", "resume")
      .attach("file", Buffer.from("notpdf"), { filename: "fake.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not a valid PDF/);
    expect(uploadPdf).not.toHaveBeenCalled();
  });

  it("returns 404 when the profile does not exist", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(null as never);

    const response = await request(app)
      .post("/api/application-profiles/9999/files")
      .field("kind", "resume")
      .attach("file", Buffer.from(VALID_PDF_BYTES), { filename: "r.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/);
  });
});

describe("DELETE /api/application-profiles/:id/files/:kind", () => {
  it("deletes the stored object and clears both resume columns", async () => {
    const profile = buildProfile({ resumeStorageKey: "resume/1-uuid.pdf", resumeFileName: "r.pdf" });
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(profile as never);
    vi.mocked(prisma.applicationProfile.update).mockResolvedValue({
      ...profile,
      resumeStorageKey: null,
      resumeFileName: null,
    } as never);

    const response = await request(app).delete("/api/application-profiles/1/files/resume");

    expect(response.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledWith("resume/1-uuid.pdf");
    expect(prisma.applicationProfile.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { resumeStorageKey: null, resumeFileName: null },
    });
  });

  it("returns 400 for an invalid kind", async () => {
    const response = await request(app).delete("/api/application-profiles/1/files/bogus");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/kind must be one of/);
  });

  it("returns 404 when the profile does not exist", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(null as never);

    const response = await request(app).delete("/api/application-profiles/9999/files/resume");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/application-profiles/:id/files/:kind", () => {
  it("returns a signed read URL when the file is present", async () => {
    const profile = buildProfile({ resumeStorageKey: "resume/1-uuid.pdf", resumeFileName: "r.pdf" });
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(profile as never);
    vi.mocked(getSignedReadUrl).mockResolvedValue("https://signed.example.com/resume?sig=abc");

    const response = await request(app).get("/api/application-profiles/1/files/resume");

    expect(response.status).toBe(200);
    expect(getSignedReadUrl).toHaveBeenCalledWith("resume/1-uuid.pdf");
    expect(response.body).toEqual({ url: "https://signed.example.com/resume?sig=abc" });
  });

  it("returns 404 when no file of that kind has been uploaded", async () => {
    const profile = buildProfile();
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(profile as never);

    const response = await request(app).get("/api/application-profiles/1/files/resume");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/No resume file uploaded/);
  });

  it("returns 400 for an invalid kind", async () => {
    const response = await request(app).get("/api/application-profiles/1/files/bogus");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/kind must be one of/);
  });

  it("returns 404 when the profile does not exist", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(null as never);

    const response = await request(app).get("/api/application-profiles/9999/files/resume");

    expect(response.status).toBe(404);
  });

  it("returns 400 for a non-numeric profile id", async () => {
    const response = await request(app).get("/api/application-profiles/not-a-number/files/resume");

    expect(response.status).toBe(400);
  });
});

describe("upload edge cases", () => {
  it("returns 400 when no file is attached to an otherwise valid upload", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(buildProfile() as never);

    const response = await request(app)
      .post("/api/application-profiles/1/files")
      .field("kind", "resume");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/PDF file is required/);
  });
});
