import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";

vi.mock("../prismaClient.js", () => {
  return {
    default: {
      applicationProfile: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

// Mock Prisma's namespace so the route's `err instanceof Prisma.PrismaClientKnownRequestError`
// guard resolves to a real class shared with the mocked error instances thrown below.
vi.mock("../../prisma/generated/client/client.js", () => {
  // Mirrors the real Prisma client's KnownRequestError shape: the constructor
  // now takes a params object ({ code, clientVersion }) rather than a bare code
  // string, so `this.code` is read off the object to keep the route's
  // `err.code === "P2002"` guard working at runtime.
  class PrismaClientKnownRequestError extends Error {
    public readonly code: string;
    public readonly clientVersion: string;
    constructor(message: string, params: { code: string; clientVersion: string }) {
      super(message);
      this.code = params.code;
      this.clientVersion = params.clientVersion;
      this.name = "PrismaClientKnownRequestError";
    }
  }
  return {
    Prisma: { PrismaClientKnownRequestError },
  };
});

import prisma from "../prismaClient.js";
import { Prisma } from "../../prisma/generated/client/client.js";

/**
 * Minimal application profile fixture used as the "stored" record across the
 * happy-path tests in this file. The actual route layer just round-trips
 * Prisma output, so the shape only needs to match what JSON serialization
 * would emit (Dates become ISO strings).
 */
const sampleProfile = {
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
  resumeUrl: "https://drive.google.com/file/d/1/view",
  coverLetterUrl: null,
  workAuthorization: null,
  desiredSalaryMin: null,
  created_date: new Date("2026-05-21T00:00:00.000Z"),
  updated_date: new Date("2026-05-21T00:00:00.000Z"),
};

/**
 * Builds a minimal valid request body for create/update happy-path tests.
 * @param {Record<string, unknown>} overrides - Field-level overrides
 * @returns {Record<string, unknown>} A request body that should pass validation
 */
function buildValidBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Default",
    firstName: "Khalah",
    lastName: "Jones-Golden",
    email: "khasan222@gmail.com",
    phone: "13479770736",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/application-profiles", () => {
  it("returns the list of profiles ordered by created_date desc", async () => {
    vi.mocked(prisma.applicationProfile.findMany).mockResolvedValue([sampleProfile]);

    const response = await request(app).get("/api/application-profiles");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe("Default");
    expect(prisma.applicationProfile.findMany).toHaveBeenCalledWith({
      orderBy: { created_date: "desc" },
    });
  });
});

describe("GET /api/application-profiles/:id", () => {
  it("returns the profile when found", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(sampleProfile);

    const response = await request(app).get("/api/application-profiles/1");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(1);
  });

  it("returns 400 when the id is not a number", async () => {
    const response = await request(app).get("/api/application-profiles/not-a-number");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid id/);
  });

  it("returns 404 when the profile does not exist", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(null);

    const response = await request(app).get("/api/application-profiles/9999");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/);
  });
});

describe("POST /api/application-profiles", () => {
  it("creates a profile with only required fields and returns 201", async () => {
    vi.mocked(prisma.applicationProfile.create).mockResolvedValue(sampleProfile);

    const response = await request(app)
      .post("/api/application-profiles")
      .send(buildValidBody());

    expect(response.status).toBe(201);
    expect(prisma.applicationProfile.create).toHaveBeenCalledOnce();
    const callArg = vi.mocked(prisma.applicationProfile.create).mock.calls[0]?.[0];
    expect(callArg?.data.name).toBe("Default");
    expect(callArg?.data.middleName).toBeNull();
    expect(callArg?.data.coverLetterUrl).toBeNull();
    expect(callArg?.data.workAuthorization).toBeNull();
    expect(callArg?.data.desiredSalaryMin).toBeNull();
  });

  it("accepts all optional fields when provided", async () => {
    vi.mocked(prisma.applicationProfile.create).mockResolvedValue(sampleProfile);

    const response = await request(app)
      .post("/api/application-profiles")
      .send(buildValidBody({
        middleName: "Ciskei",
        github: "https://github.com/panda01",
        linkedin: "https://www.linkedin.com/in/khalahjonesgolden/",
        website: "https://khalah.medium.com",
        resumeUrl: "https://drive.google.com/file/d/1/view",
        coverLetterUrl: "https://docs.google.com/document/d/abc/view",
        workAuthorization: "us_citizen",
        desiredSalaryMin: 120000,
      }));

    expect(response.status).toBe(201);
    const callArg = vi.mocked(prisma.applicationProfile.create).mock.calls[0]?.[0];
    expect(callArg?.data.middleName).toBe("Ciskei");
    expect(callArg?.data.workAuthorization).toBe("us_citizen");
    expect(callArg?.data.desiredSalaryMin).toBe(120000);
  });

  it("returns 400 when required fields are missing", async () => {
    const response = await request(app)
      .post("/api/application-profiles")
      .send({ name: "Default" });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("firstName"),
        expect.stringContaining("lastName"),
        expect.stringContaining("email"),
        expect.stringContaining("phone"),
      ])
    );
  });

  it("returns 400 when email is malformed", async () => {
    const response = await request(app)
      .post("/api/application-profiles")
      .send(buildValidBody({ email: "not-an-email" }));

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("email must be a valid email")])
    );
  });

  it("returns 400 when an optional URL is malformed", async () => {
    const response = await request(app)
      .post("/api/application-profiles")
      .send(buildValidBody({ coverLetterUrl: "ftp://example.com/doc" }));

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("coverLetterUrl")])
    );
  });

  it("returns 400 when workAuthorization is not a valid enum value", async () => {
    const response = await request(app)
      .post("/api/application-profiles")
      .send(buildValidBody({ workAuthorization: "alien" }));

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("workAuthorization")])
    );
  });

  it("returns 400 when desiredSalaryMin is not a positive integer", async () => {
    const response = await request(app)
      .post("/api/application-profiles")
      .send(buildValidBody({ desiredSalaryMin: -5 }));

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("desiredSalaryMin")])
    );
  });

  it("returns 409 when the name is already taken", async () => {
    vi.mocked(prisma.applicationProfile.create).mockRejectedValue(
      // The Prisma client's KnownRequestError constructor now takes a params
      // object ({ code, clientVersion }) rather than a bare code string.
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" })
    );

    const response = await request(app)
      .post("/api/application-profiles")
      .send(buildValidBody());

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/already exists/);
  });
});

describe("POST validation edge cases", () => {
  it("rejects an optional string field when it's not a string", async () => {
    const response = await request(app)
      .post("/api/application-profiles")
      .send(buildValidBody({ middleName: 42 }));

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("middleName must be a string when provided")])
    );
  });

  it("treats an optional string field of whitespace as null/omitted", async () => {
    vi.mocked(prisma.applicationProfile.create).mockResolvedValue(sampleProfile);

    const response = await request(app)
      .post("/api/application-profiles")
      .send(buildValidBody({ middleName: "   " }));

    expect(response.status).toBe(201);
    const callArg = vi.mocked(prisma.applicationProfile.create).mock.calls[0]?.[0];
    expect(callArg?.data.middleName).toBeNull();
  });

  it("re-throws unknown Prisma errors so the express error handler can run", async () => {
    vi.mocked(prisma.applicationProfile.create).mockRejectedValue(new Error("connection lost"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(app)
      .post("/api/application-profiles")
      .send(buildValidBody());

    // Default express error handler turns unhandled rejections into 500
    expect(response.status).toBe(500);
    errorSpy.mockRestore();
  });
});

describe("PUT /api/application-profiles/:id", () => {
  it("updates a profile and returns the new record", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(sampleProfile);
    vi.mocked(prisma.applicationProfile.update).mockResolvedValue({
      ...sampleProfile,
      firstName: "Updated",
    });

    const response = await request(app)
      .put("/api/application-profiles/1")
      .send(buildValidBody({ firstName: "Updated" }));

    expect(response.status).toBe(200);
    expect(response.body.firstName).toBe("Updated");
  });

  it("returns 404 when the profile does not exist", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(null);

    const response = await request(app)
      .put("/api/application-profiles/9999")
      .send(buildValidBody());

    expect(response.status).toBe(404);
  });

  it("returns 400 on validation failure", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(sampleProfile);

    const response = await request(app)
      .put("/api/application-profiles/1")
      .send({ name: "Default" });

    expect(response.status).toBe(400);
  });

  it("returns 409 when changing to a name that's already taken", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(sampleProfile);
    vi.mocked(prisma.applicationProfile.update).mockRejectedValue(
      // The Prisma client's KnownRequestError constructor now takes a params
      // object ({ code, clientVersion }) rather than a bare code string.
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" })
    );

    const response = await request(app)
      .put("/api/application-profiles/1")
      .send(buildValidBody({ name: "Other" }));

    expect(response.status).toBe(409);
  });
});

describe("PUT error pass-through", () => {
  it("re-throws unknown Prisma errors so the express handler can run", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(sampleProfile);
    vi.mocked(prisma.applicationProfile.update).mockRejectedValue(new Error("connection lost"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(app)
      .put("/api/application-profiles/1")
      .send(buildValidBody());

    expect(response.status).toBe(500);
    errorSpy.mockRestore();
  });
});

describe("DELETE /api/application-profiles/:id", () => {
  it("deletes a profile and returns the deleted record", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(sampleProfile);
    vi.mocked(prisma.applicationProfile.delete).mockResolvedValue(sampleProfile);

    const response = await request(app).delete("/api/application-profiles/1");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(1);
    expect(prisma.applicationProfile.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("returns 404 when the profile does not exist", async () => {
    vi.mocked(prisma.applicationProfile.findUnique).mockResolvedValue(null);

    const response = await request(app).delete("/api/application-profiles/9999");

    expect(response.status).toBe(404);
  });
});
