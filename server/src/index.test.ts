import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./app";

describe("Express Server", () => {
  it("should return health check status ok", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
