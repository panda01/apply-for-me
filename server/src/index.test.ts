import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("./prismaClient.js", () => {
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

vi.mock("./services/jobListingScraperService.js", () => {
  return {
    fetchJobListingFromUrl: vi.fn(),
  };
});

import { app } from "./app.js";

describe("Express Server", () => {
  it("should return health check status ok", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
