import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app.js";

vi.mock("../prismaClient.js", () => {
  return {
    default: {
      managedContainer: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

vi.mock("../services/dockerContainerService.js", () => {
  return {
    runContainer: vi.fn(),
    stopAndRemove: vi.fn(),
    generateContainerName: vi.fn(() => "abc123def456"),
    isValidContainerName: vi.fn((name: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,40}$/.test(name)),
  };
});

import prisma from "../prismaClient.js";
import {
  runContainer,
  stopAndRemove,
  generateContainerName,
  isValidContainerName,
} from "../services/dockerContainerService.js";

const baseRecord = {
  id: 1,
  name: "abc123def456",
  dockerId: "docker-id-1",
  hostPort: 41123,
  wgConfigName: "us-nyc-wg-301",
  status: "running" as const,
  created_date: new Date("2026-05-07T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateContainerName).mockReturnValue("abc123def456");
  vi.mocked(isValidContainerName).mockImplementation((name: string) =>
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,40}$/.test(name)
  );
});

describe("POST /api/managed-containers", () => {
  it("creates a container with an auto-generated name and returns 201", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-1", hostPort: 41123, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockResolvedValue(baseRecord);

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(201);
    expect(response.body.name).toBe("abc123def456");
    expect(response.body.hostPort).toBe(41123);
    expect(runContainer).toHaveBeenCalledWith("abc123def456");
    expect(prisma.managedContainer.create).toHaveBeenCalledOnce();
  });

  it("uses a user-supplied name when provided", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-2", hostPort: 41124, wgConfigName: "us-nyc-wg-302" });
    vi.mocked(prisma.managedContainer.create).mockResolvedValue({
      ...baseRecord,
      name: "user-name",
    });

    const response = await request(app)
      .post("/api/managed-containers")
      .send({ name: "user-name" });

    expect(response.status).toBe(201);
    expect(runContainer).toHaveBeenCalledWith("user-name");
  });

  it("returns 400 when name is invalid", async () => {
    const response = await request(app)
      .post("/api/managed-containers")
      .send({ name: "bad name with spaces" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid container name/);
    expect(runContainer).not.toHaveBeenCalled();
  });

  it("returns 409 when the name is already in use", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);

    const response = await request(app)
      .post("/api/managed-containers")
      .send({ name: "abc123def456" });

    expect(response.status).toBe(409);
    expect(runContainer).not.toHaveBeenCalled();
  });

  it("returns 500 when docker fails to start the container", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockRejectedValue(new Error("docker daemon offline"));

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/docker daemon offline/);
    expect(prisma.managedContainer.create).not.toHaveBeenCalled();
  });

  it("rolls back the docker container when the DB insert fails", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-X", hostPort: 41200, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue(new Error("db down"));
    vi.mocked(stopAndRemove).mockResolvedValue();

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/Failed to persist container/);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-X");
  });

  it("returns 409 when the DB insert fails with a Prisma unique-constraint violation", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-Y", hostPort: 41201, wgConfigName: "us-nyc-wg-301" });
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue(uniqueViolation);
    vi.mocked(stopAndRemove).mockResolvedValue();

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(409);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-Y");
  });

  it("returns 500 when the DB insert rejects with a non-object reason", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-S", hostPort: 41203, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue("string-reject");
    vi.mocked(stopAndRemove).mockResolvedValue();

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/string-reject/);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-S");
  });

  it("logs but does not crash if the rollback also fails", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-Z", hostPort: 41202, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue(new Error("db down"));
    vi.mocked(stopAndRemove).mockRejectedValue(new Error("docker also offline"));

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(500);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-Z");
  });

  it("stringifies a non-Error rollback failure in the orphan-cleanup log line", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-W", hostPort: 41205, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue(new Error("db down"));
    vi.mocked(stopAndRemove).mockRejectedValue("non-error-cleanup");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to clean up orphaned container docker-id-W: non-error-cleanup/)
    );
    consoleErrorSpy.mockRestore();
  });
});

describe("GET /api/managed-containers", () => {
  it("returns the list of managed containers", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([baseRecord]);

    const response = await request(app).get("/api/managed-containers");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe("abc123def456");
  });
});

describe("GET /api/managed-containers/:id", () => {
  it("returns 200 with the record when found", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);

    const response = await request(app).get("/api/managed-containers/1");

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(1);
  });

  it("returns 400 when id is not a number", async () => {
    const response = await request(app).get("/api/managed-containers/not-a-number");

    expect(response.status).toBe(400);
  });

  it("returns 404 when not found", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);

    const response = await request(app).get("/api/managed-containers/999");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/managed-containers/:id/health", () => {
  it("returns 400 when id is not a number", async () => {
    const response = await request(app).get("/api/managed-containers/abc/health");

    expect(response.status).toBe(400);
    expect(prisma.managedContainer.findUnique).not.toHaveBeenCalled();
  });

  it("proxies the health check, returns the upstream body, and persists status=running on success", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    vi.mocked(prisma.managedContainer.update).mockResolvedValue({ ...baseRecord, status: "running" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", name: "abc123def456" }), { status: 200 }));

    const response = await request(app).get("/api/managed-containers/1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", name: "abc123def456" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:41123/health",
      expect.objectContaining({ signal: expect.anything() })
    );
    expect(prisma.managedContainer.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: "running" },
    });
    fetchSpy.mockRestore();
  });

  it("returns 503 and persists status=stopped when the container is unreachable", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    vi.mocked(prisma.managedContainer.update).mockResolvedValue({ ...baseRecord, status: "stopped" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await request(app).get("/api/managed-containers/1/health");

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/ECONNREFUSED/);
    expect(prisma.managedContainer.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: "stopped" },
    });
    fetchSpy.mockRestore();
  });

  it("returns 503 and persists status=error when the upstream container reports a non-ok status", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    vi.mocked(prisma.managedContainer.update).mockResolvedValue({ ...baseRecord, status: "error" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("err", { status: 500 }));

    const response = await request(app).get("/api/managed-containers/1/health");

    expect(response.status).toBe(503);
    expect(prisma.managedContainer.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: "error" },
    });
    fetchSpy.mockRestore();
  });

  it("still returns the probe result when the DB status write fails", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    vi.mocked(prisma.managedContainer.update).mockRejectedValue(new Error("db down"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", name: "abc123def456" }), { status: 200 }));

    const response = await request(app).get("/api/managed-containers/1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", name: "abc123def456" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to persist health status for 1: db down/)
    );
    fetchSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("logs a stringified non-Error when the DB status write rejects with a non-Error", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    vi.mocked(prisma.managedContainer.update).mockRejectedValue("string-db-error");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", name: "abc123def456" }), { status: 200 }));

    const response = await request(app).get("/api/managed-containers/1/health");

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to persist health status for 1: string-db-error/)
    );
    fetchSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("returns 404 when the record is missing", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);

    const response = await request(app).get("/api/managed-containers/999/health");

    expect(response.status).toBe(404);
  });

  it("stringifies a non-Error fetch rejection into the unreachable response", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    vi.mocked(prisma.managedContainer.update).mockResolvedValue({ ...baseRecord, status: "stopped" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue("non-error-reject");

    const response = await request(app).get("/api/managed-containers/1/health");

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/Container unreachable: non-error-reject/);
    fetchSpy.mockRestore();
  });
});

describe("DELETE /api/managed-containers/:id", () => {
  it("returns 400 when id is not a number", async () => {
    const response = await request(app).delete("/api/managed-containers/abc");

    expect(response.status).toBe(400);
    expect(prisma.managedContainer.findUnique).not.toHaveBeenCalled();
  });

  it("stops and removes the docker container, then deletes the record", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    vi.mocked(stopAndRemove).mockResolvedValue();
    vi.mocked(prisma.managedContainer.delete).mockResolvedValue(baseRecord);

    const response = await request(app).delete("/api/managed-containers/1");

    expect(response.status).toBe(200);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-1");
    expect(prisma.managedContainer.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("returns 404 when the record is missing", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);

    const response = await request(app).delete("/api/managed-containers/999");

    expect(response.status).toBe(404);
    expect(stopAndRemove).not.toHaveBeenCalled();
  });

  it("returns 500 when docker removal fails", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    vi.mocked(stopAndRemove).mockRejectedValue(new Error("docker offline"));

    const response = await request(app).delete("/api/managed-containers/1");

    expect(response.status).toBe(500);
    expect(prisma.managedContainer.delete).not.toHaveBeenCalled();
  });

  it("includes the stringified non-Error reason when stopAndRemove rejects with a non-Error", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    vi.mocked(stopAndRemove).mockRejectedValue("string-error");

    const response = await request(app).delete("/api/managed-containers/1");

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/string-error/);
  });
});

describe("POST /api/managed-containers/:id/screenshot", () => {
  const pngMagicHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // \x89PNG

  it("returns 400 when id is not a number", async () => {
    const response = await request(app)
      .post("/api/managed-containers/abc/screenshot")
      .send({ url: "https://google.com" });

    expect(response.status).toBe(400);
    expect(prisma.managedContainer.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the record is missing", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);

    const response = await request(app)
      .post("/api/managed-containers/999/screenshot")
      .send({ url: "https://google.com" });

    expect(response.status).toBe(404);
  });

  it("returns 400 when the request body is missing the url", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);

    const response = await request(app)
      .post("/api/managed-containers/1/screenshot")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/url/);
  });

  it("proxies the screenshot and streams the image bytes back", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pngMagicHeader, { status: 200, headers: { "Content-Type": "image/png" } })
    );

    const response = await request(app)
      .post("/api/managed-containers/1/screenshot")
      .send({ url: "https://google.com" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/image\/png/);
    expect(response.body.slice(0, 4)).toEqual(pngMagicHeader);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:41123/screenshot",
      expect.objectContaining({ method: "POST" })
    );
    fetchSpy.mockRestore();
  });

  it("returns 503 when the container itself reports a screenshot failure", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "page.goto: net::ERR_NAME_NOT_RESOLVED" }), { status: 500 })
    );

    const response = await request(app)
      .post("/api/managed-containers/1/screenshot")
      .send({ url: "https://nonexistent.invalid" });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/ERR_NAME_NOT_RESOLVED/);
    fetchSpy.mockRestore();
  });

  it("returns 503 with the status text when the upstream non-OK body is not JSON", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json", { status: 502, statusText: "Bad Gateway" })
    );

    const response = await request(app)
      .post("/api/managed-containers/1/screenshot")
      .send({ url: "https://google.com" });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/502/);
    fetchSpy.mockRestore();
  });

  it("returns 503 when the container is unreachable", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await request(app)
      .post("/api/managed-containers/1/screenshot")
      .send({ url: "https://google.com" });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/ECONNREFUSED/);
    fetchSpy.mockRestore();
  });

  it("stringifies a non-Error fetch rejection in the screenshot unreachable response", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue("screenshot-non-error");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(app)
      .post("/api/managed-containers/1/screenshot")
      .send({ url: "https://google.com" });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/Container unreachable: screenshot-non-error/);
    fetchSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

describe("POST /api/managed-containers/:id/analyze", () => {
  const fixtureResult = {
    is_job_description: true,
    apply_button_present: true,
    description_signals: ["Responsibilities", "Full-time", "Remote"],
    reasoning: "Page has an Apply button and matching description sections.",
    screenshot_b64: "iVBORw0KGgo=",
    title: "Software Engineer",
    company: "Acme Corp",
    description: "We are hiring a Software Engineer to build things.",
    salary: "$120,000-$150,000/yr",
    post_date: "2 hours ago",
    apply_button_url: "https://acme.com/jobs/123/apply",
  };

  it("returns 400 when id is not a number", async () => {
    const response = await request(app)
      .post("/api/managed-containers/abc/analyze")
      .send({ url: "https://example.com" });

    expect(response.status).toBe(400);
    expect(prisma.managedContainer.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the record is missing", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);

    const response = await request(app)
      .post("/api/managed-containers/999/analyze")
      .send({ url: "https://example.com" });

    expect(response.status).toBe(404);
  });

  it("returns 400 when the request body is missing the url", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);

    const response = await request(app)
      .post("/api/managed-containers/1/analyze")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/url/);
  });

  it("proxies the analyze response when the upstream agent succeeds", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fixtureResult), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const response = await request(app)
      .post("/api/managed-containers/1/analyze")
      .send({ url: "https://example.com/job/1" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(fixtureResult);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:41123/analyze",
      expect.objectContaining({ method: "POST" })
    );
    fetchSpy.mockRestore();
  });

  it("returns 503 when the container reports an agent failure", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Agent exceeded 8 turns without calling report" }), { status: 500 })
    );

    const response = await request(app)
      .post("/api/managed-containers/1/analyze")
      .send({ url: "https://example.com" });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/exceeded 8 turns/);
    fetchSpy.mockRestore();
  });

  it("returns 503 with status text when upstream non-OK body is not JSON", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json", { status: 502, statusText: "Bad Gateway" })
    );

    const response = await request(app)
      .post("/api/managed-containers/1/analyze")
      .send({ url: "https://example.com" });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/502/);
    fetchSpy.mockRestore();
  });

  it("returns 503 when the container is unreachable", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await request(app)
      .post("/api/managed-containers/1/analyze")
      .send({ url: "https://example.com" });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/ECONNREFUSED/);
    fetchSpy.mockRestore();
  });

  it("stringifies a non-Error fetch rejection in the analyze unreachable response", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue("analyze-non-error");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(app)
      .post("/api/managed-containers/1/analyze")
      .send({ url: "https://example.com" });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/Container unreachable: analyze-non-error/);
    fetchSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

describe("managed-containers timeout abort callbacks", () => {
  /**
   * Each of the three proxied endpoints (health, screenshot, analyze) schedules a
   * `setTimeout(() => abortController.abort(), …)` to bound the upstream call. We
   * cover those abort callbacks by replacing global setTimeout with a stub that
   * schedules the timer's callback on the next microtask — that fires AFTER the route
   * has called fetch (so the AbortSignal is the one passed to fetch) but BEFORE the
   * fetch mock's signal listener has had a chance to be exercised by anything else.
   * Fetch itself is mocked to never resolve unless its AbortSignal aborts.
   */

  /**
   * Returns a fetch mock that resolves only when the AbortSignal fires, rejecting with
   * an AbortError. Lets the abort-callback path drive the route's catch block.
   * @returns {ReturnType<typeof vi.fn>} A fetch mock honoring AbortSignal
   */
  function makeAbortableFetchMock(): typeof fetch {
    const mock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === null || signal === undefined) {
          return;
        }
        signal.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    });
    return mock as unknown as typeof fetch;
  }

  /**
   * Replaces globalThis.setTimeout with a stub that fires its callback on the next microtask.
   * Returns a function that restores the original setTimeout.
   * @returns {() => void} Restore function
   */
  function fireSetTimeoutsImmediately(): () => void {
    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((fn: () => void) => {
      Promise.resolve().then(() => fn());
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    return () => {
      (globalThis as { setTimeout: typeof setTimeout }).setTimeout = originalSetTimeout;
    };
  }

  it("aborts the health probe when the timeout fires and persists stopped", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    vi.mocked(prisma.managedContainer.update).mockResolvedValue({ ...baseRecord, status: "stopped" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(makeAbortableFetchMock());
    const restoreSetTimeout = fireSetTimeoutsImmediately();

    try {
      const response = await request(app).get("/api/managed-containers/1/health");

      expect(response.status).toBe(503);
      expect(response.body.error).toMatch(/Container unreachable/);
      expect(prisma.managedContainer.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: "stopped" },
      });
    } finally {
      restoreSetTimeout();
      fetchSpy.mockRestore();
    }
  });

  it("aborts the screenshot proxy when the timeout fires", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(makeAbortableFetchMock());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const restoreSetTimeout = fireSetTimeoutsImmediately();

    try {
      const response = await request(app)
        .post("/api/managed-containers/1/screenshot")
        .send({ url: "https://google.com" });

      expect(response.status).toBe(503);
      expect(response.body.error).toMatch(/Container unreachable/);
    } finally {
      restoreSetTimeout();
      fetchSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("aborts the analyze proxy when the timeout fires", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(makeAbortableFetchMock());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const restoreSetTimeout = fireSetTimeoutsImmediately();

    try {
      const response = await request(app)
        .post("/api/managed-containers/1/analyze")
        .send({ url: "https://example.com" });

      expect(response.status).toBe(503);
      expect(response.body.error).toMatch(/Container unreachable/);
    } finally {
      restoreSetTimeout();
      fetchSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});

describe("POST error path with non-Error rejection", () => {
  it("includes the stringified non-Error reason when runContainer rejects with a non-Error", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockRejectedValue("docker boom");

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/docker boom/);
  });
});
