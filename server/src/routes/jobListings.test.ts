import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";

vi.mock("../prismaClient.js", () => {
  return {
    default: {
      jobListing: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

import prisma from "../prismaClient.js";

const mockJobListing = {
  id: 1,
  title: "Software Engineer",
  url: "https://example.com/job/1",
  description: "Build cool stuff",
  post_date: new Date("2026-03-01T00:00:00.000Z"),
  created_date: new Date("2026-03-05T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/job-listings", () => {
  it("should create a new job listing and return 201", async () => {
    vi.mocked(prisma.jobListing.create).mockResolvedValue(mockJobListing);

    const response = await request(app)
      .post("/api/job-listings")
      .send({
        title: "Software Engineer",
        url: "https://example.com/job/1",
        description: "Build cool stuff",
        post_date: "2026-03-01T00:00:00.000Z",
      });

    expect(response.status).toBe(201);
    expect(response.body.title).toBe("Software Engineer");
    expect(prisma.jobListing.create).toHaveBeenCalledOnce();
  });

  it("should return 400 when required fields are missing", async () => {
    const response = await request(app)
      .post("/api/job-listings")
      .send({ title: "Incomplete Listing" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Missing required fields/);
    expect(prisma.jobListing.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/job-listings", () => {
  it("should return all job listings", async () => {
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([mockJobListing]);

    const response = await request(app).get("/api/job-listings");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].title).toBe("Software Engineer");
  });

  it("should return an empty array when no listings exist", async () => {
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([]);

    const response = await request(app).get("/api/job-listings");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe("GET /api/job-listings/:id", () => {
  it("should return a job listing by id", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);

    const response = await request(app).get("/api/job-listings/1");

    expect(response.status).toBe(200);
    expect(response.body.title).toBe("Software Engineer");
  });

  it("should return 404 when job listing is not found", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);

    const response = await request(app).get("/api/job-listings/999");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/);
  });

  it("should return 400 for an invalid id", async () => {
    const response = await request(app).get("/api/job-listings/abc");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid id/);
  });
});

describe("DELETE /api/job-listings/:id", () => {
  it("should delete a job listing and return it", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    vi.mocked(prisma.jobListing.delete).mockResolvedValue(mockJobListing);

    const response = await request(app).delete("/api/job-listings/1");

    expect(response.status).toBe(200);
    expect(response.body.title).toBe("Software Engineer");
    expect(prisma.jobListing.delete).toHaveBeenCalledOnce();
  });

  it("should return 404 when trying to delete a non-existent listing", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);

    const response = await request(app).delete("/api/job-listings/999");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/);
    expect(prisma.jobListing.delete).not.toHaveBeenCalled();
  });

  it("should return 400 for an invalid id", async () => {
    const response = await request(app).delete("/api/job-listings/abc");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid id/);
  });
});
