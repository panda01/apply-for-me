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
        update: vi.fn(),
      },
    },
  };
});

vi.mock("../services/jobListingScraperService.js", () => {
  return {
    fetchJobListingFromUrl: vi.fn(),
  };
});

const { mockParseDate } = vi.hoisted(() => ({
  mockParseDate: vi.fn(),
}));
vi.mock("chrono-node", () => ({
  parseDate: mockParseDate,
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
import { fetchJobListingFromUrl } from "../services/jobListingScraperService.js";

const mockJobListing = {
  id: 1,
  title: "",
  url: "https://linkedin.com/jobs/1",
  description: "",
  salary: null,
  location: null,
  live_url: null,
  post_date: new Date("2026-03-07T00:00:00.000Z"),
  created_date: new Date("2026-03-07T00:00:00.000Z"),
  status: "init" as const,
};

const mockCompletedJobListing = {
  id: 1,
  title: "Acme Corp - Software Engineer",
  url: "https://linkedin.com/jobs/1",
  description: "Build cool stuff",
  salary: "$120k - $150k",
  location: null,
  live_url: null,
  post_date: new Date("2026-03-01T00:00:00.000Z"),
  created_date: new Date("2026-03-07T00:00:00.000Z"),
  status: "init" as const,
};

const mockCredentialsJson = JSON.stringify({
  email: "user@example.com",
  password: "pass123",
});

beforeEach(() => {
  vi.clearAllMocks();
  mockParseDate.mockImplementation((dateString: string) => {
    const parsed = new Date(dateString);
    const isValidDate = !isNaN(parsed.getTime());
    return isValidDate ? parsed : null;
  });
});

describe("POST /api/job-listings", () => {
  it("should return 202 with a pending record when url is provided", async () => {
    vi.mocked(prisma.jobListing.create).mockResolvedValue(mockJobListing);

    const response = await request(app)
      .post("/api/job-listings")
      .send({ url: "https://linkedin.com/jobs/1" });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe("init");
    expect(response.body.url).toBe("https://linkedin.com/jobs/1");
    expect(prisma.jobListing.create).toHaveBeenCalledOnce();
  });

  it("should not trigger scraping after creating the record", async () => {
    vi.mocked(prisma.jobListing.create).mockResolvedValue(mockJobListing);

    await request(app)
      .post("/api/job-listings")
      .send({ url: "https://linkedin.com/jobs/1" });

    expect(fetchJobListingFromUrl).not.toHaveBeenCalled();
    expect(prisma.jobListing.update).not.toHaveBeenCalled();
  });

  it("should return 400 when url is missing", async () => {
    const response = await request(app)
      .post("/api/job-listings")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Missing required field: url/);
    expect(prisma.jobListing.create).not.toHaveBeenCalled();
  });

  it("should return 400 when url is not a valid HTTP URL", async () => {
    const response = await request(app)
      .post("/api/job-listings")
      .send({ url: "not-a-url" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid url/);
    expect(prisma.jobListing.create).not.toHaveBeenCalled();
  });

  it("should return 400 when url uses a non-HTTP protocol", async () => {
    const response = await request(app)
      .post("/api/job-listings")
      .send({ url: "ftp://example.com/file" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid url/);
    expect(prisma.jobListing.create).not.toHaveBeenCalled();
  });

  it("should return 400 for javascript: protocol URLs", async () => {
    const response = await request(app)
      .post("/api/job-listings")
      .send({ url: "javascript:alert(1)" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid url/);
    expect(prisma.jobListing.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/job-listings/:id/fetch", () => {
  it("should return 202 and trigger background scraping for a LinkedIn URL", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    mockReadFile.mockResolvedValue(mockCredentialsJson);
    vi.mocked(fetchJobListingFromUrl).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme Corp",
      description: "Build cool stuff",
      salary: "$120k - $150k",
      postDate: "2026-03-01",
      url: "https://linkedin.com/jobs/1",
    });
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    const response = await request(app)
      .post("/api/job-listings/1/fetch");

    expect(response.status).toBe(202);
    expect(response.body.url).toBe("https://linkedin.com/jobs/1");
  });

  it("should return 404 when job listing is not found", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(null);

    const response = await request(app)
      .post("/api/job-listings/999/fetch");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/);
  });

  it("should return 400 for an invalid id", async () => {
    const response = await request(app)
      .post("/api/job-listings/abc/fetch");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid id/);
  });

  it("should enrich the record with scraped data including salary after successful scraping", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    mockReadFile.mockResolvedValue(mockCredentialsJson);
    vi.mocked(fetchJobListingFromUrl).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme Corp",
      description: "Build cool stuff",
      salary: "$120k - $150k",
      postDate: "2026-03-01",
      url: "https://linkedin.com/jobs/1",
    });
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    await request(app)
      .post("/api/job-listings/1/fetch");

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          title: "Acme Corp - Software Engineer",
          description: "Build cool stuff",
          salary: "$120k - $150k",
          post_date: expect.any(Date),
        },
      });
    });
  });

  it("should store null salary when scraper returns empty string", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    mockReadFile.mockResolvedValue(mockCredentialsJson);
    vi.mocked(fetchJobListingFromUrl).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme Corp",
      description: "Build cool stuff",
      salary: "",
      postDate: "2026-03-01",
      url: "https://linkedin.com/jobs/1",
    });
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    await request(app)
      .post("/api/job-listings/1/fetch");

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          salary: null,
        }),
      });
    });
  });

  it("should not update the record when scraping fails", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    mockReadFile.mockResolvedValue(mockCredentialsJson);
    vi.mocked(fetchJobListingFromUrl).mockRejectedValue(new Error("Scraping failed"));

    await request(app)
      .post("/api/job-listings/1/fetch");

    await vi.waitFor(() => {
      expect(fetchJobListingFromUrl).toHaveBeenCalled();
    });

    expect(prisma.jobListing.update).not.toHaveBeenCalled();
  });

  it("should not update the record when credentials file read fails", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

    await request(app)
      .post("/api/job-listings/1/fetch");

    await vi.waitFor(() => {
      expect(mockReadFile).toHaveBeenCalled();
    });

    expect(prisma.jobListing.update).not.toHaveBeenCalled();
  });

  it("should read credentials file for linkedin.com URLs and pass credentials to scraper", async () => {
    const linkedInListing = { ...mockJobListing, url: "https://www.linkedin.com/jobs/view/123" };
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(linkedInListing);
    mockReadFile.mockResolvedValue(mockCredentialsJson);
    vi.mocked(fetchJobListingFromUrl).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme Corp",
      description: "Build cool stuff",
      salary: "",
      postDate: "2026-03-01",
      url: "https://www.linkedin.com/jobs/view/123",
    });
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    await request(app)
      .post("/api/job-listings/1/fetch");

    await vi.waitFor(() => {
      expect(mockReadFile).toHaveBeenCalledOnce();
      expect(fetchJobListingFromUrl).toHaveBeenCalledWith(
        "https://www.linkedin.com/jobs/view/123",
        { email: "user@example.com", password: "pass123" },
      );
    });
  });

  it("should not read credentials file for non-LinkedIn URLs", async () => {
    const nonLinkedInListing = { ...mockJobListing, url: "https://example.com/jobs/1" };
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(nonLinkedInListing);
    vi.mocked(fetchJobListingFromUrl).mockResolvedValue({
      title: "Software Engineer",
      company: "Example Inc",
      description: "Build things",
      salary: "",
      postDate: "2026-03-01",
      url: "https://example.com/jobs/1",
    });
    vi.mocked(prisma.jobListing.update).mockResolvedValue({ ...nonLinkedInListing, status: "init" as const });

    await request(app)
      .post("/api/job-listings/1/fetch");

    await vi.waitFor(() => {
      expect(fetchJobListingFromUrl).toHaveBeenCalledWith("https://example.com/jobs/1", null);
    });

    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("should successfully parse a relative post date like '2 hours ago'", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mockParseDate.mockReturnValue(twoHoursAgo);

    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    mockReadFile.mockResolvedValue(mockCredentialsJson);
    vi.mocked(fetchJobListingFromUrl).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme Corp",
      description: "Build cool stuff",
      salary: "$120k",
      postDate: "2 hours ago",
      url: "https://linkedin.com/jobs/1",
    });
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    await request(app)
      .post("/api/job-listings/1/fetch");

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          title: "Acme Corp - Software Engineer",
          description: "Build cool stuff",
          salary: "$120k",
          post_date: twoHoursAgo,
        },
      });
    });
  });

  it("should fall back to current date when postDate is unparseable", async () => {
    mockParseDate.mockReturnValue(null);

    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    mockReadFile.mockResolvedValue(mockCredentialsJson);
    vi.mocked(fetchJobListingFromUrl).mockResolvedValue({
      title: "Software Engineer",
      company: "Acme Corp",
      description: "Build cool stuff",
      salary: "",
      postDate: "not a real date",
      url: "https://linkedin.com/jobs/1",
    });
    vi.mocked(prisma.jobListing.update).mockResolvedValue(mockCompletedJobListing);

    await request(app)
      .post("/api/job-listings/1/fetch");

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          title: "Acme Corp - Software Engineer",
          description: "Build cool stuff",
          salary: null,
          post_date: expect.any(Date),
        },
      });
    });
  });

  it("should format title without company when company is empty", async () => {
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockJobListing);
    mockReadFile.mockResolvedValue(mockCredentialsJson);
    vi.mocked(fetchJobListingFromUrl).mockResolvedValue({
      title: "Software Engineer",
      company: "",
      description: "Build cool stuff",
      salary: "",
      postDate: "2026-03-01",
      url: "https://linkedin.com/jobs/1",
    });
    vi.mocked(prisma.jobListing.update).mockResolvedValue({ ...mockCompletedJobListing, title: "Software Engineer" });

    await request(app)
      .post("/api/job-listings/1/fetch");

    await vi.waitFor(() => {
      expect(prisma.jobListing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Software Engineer",
          }),
        }),
      );
    });
  });
});

describe("POST /api/job-listings/bulk", () => {
  it("should return 201 with created records when urls are valid", async () => {
    const mockCreated1 = { ...mockJobListing, id: 10, url: "https://example.com/job/1" };
    const mockCreated2 = { ...mockJobListing, id: 11, url: "https://example.com/job/2" };
    vi.mocked(prisma.jobListing.create)
      .mockResolvedValueOnce(mockCreated1)
      .mockResolvedValueOnce(mockCreated2);

    const response = await request(app)
      .post("/api/job-listings/bulk")
      .send({ urls: ["https://example.com/job/1", "https://example.com/job/2"] });

    expect(response.status).toBe(201);
    expect(response.body.count).toBe(2);
    expect(response.body.listings).toHaveLength(2);
    expect(prisma.jobListing.create).toHaveBeenCalledTimes(2);
  });

  it("should return 400 when urls field is missing", async () => {
    const response = await request(app)
      .post("/api/job-listings/bulk")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Missing required field: urls/);
  });

  it("should return 400 when urls is not an array", async () => {
    const response = await request(app)
      .post("/api/job-listings/bulk")
      .send({ urls: "https://example.com/job/1" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Missing required field: urls/);
  });

  it("should return 400 when urls array is empty", async () => {
    const response = await request(app)
      .post("/api/job-listings/bulk")
      .send({ urls: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/must not be empty/);
  });

  it("should return 400 when any URL is invalid", async () => {
    const response = await request(app)
      .post("/api/job-listings/bulk")
      .send({ urls: ["https://example.com/job/1", "not-a-url"] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid URLs/);
    expect(response.body.invalidUrls).toContain("not-a-url");
    expect(prisma.jobListing.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/job-listings", () => {
  it("should return all job listings", async () => {
    vi.mocked(prisma.jobListing.findMany).mockResolvedValue([mockCompletedJobListing]);

    const response = await request(app).get("/api/job-listings");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].title).toBe("Acme Corp - Software Engineer");
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
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);

    const response = await request(app).get("/api/job-listings/1");

    expect(response.status).toBe(200);
    expect(response.body.title).toBe("Acme Corp - Software Engineer");
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
    vi.mocked(prisma.jobListing.findUnique).mockResolvedValue(mockCompletedJobListing);
    vi.mocked(prisma.jobListing.delete).mockResolvedValue(mockCompletedJobListing);

    const response = await request(app).delete("/api/job-listings/1");

    expect(response.status).toBe(200);
    expect(response.body.title).toBe("Acme Corp - Software Engineer");
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
