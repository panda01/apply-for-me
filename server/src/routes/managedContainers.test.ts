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
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-1", hostPort: 41123 });
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
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-2", hostPort: 41124 });
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
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-X", hostPort: 41200 });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue(new Error("db down"));
    vi.mocked(stopAndRemove).mockResolvedValue();

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/Failed to persist container/);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-X");
  });

  it("returns 409 when the DB insert fails with a Prisma unique-constraint violation", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-Y", hostPort: 41201 });
    const uniqueViolation = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue(uniqueViolation);
    vi.mocked(stopAndRemove).mockResolvedValue();

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(409);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-Y");
  });

  it("returns 500 when the DB insert rejects with a non-object reason", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-S", hostPort: 41203 });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue("string-reject");
    vi.mocked(stopAndRemove).mockResolvedValue();

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/string-reject/);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-S");
  });

  it("logs but does not crash if the rollback also fails", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-Z", hostPort: 41202 });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue(new Error("db down"));
    vi.mocked(stopAndRemove).mockRejectedValue(new Error("docker also offline"));

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(500);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-Z");
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

  it("proxies the health check and returns the upstream body on success", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
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
    fetchSpy.mockRestore();
  });

  it("returns 503 when the container is unreachable", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await request(app).get("/api/managed-containers/1/health");

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/ECONNREFUSED/);
    fetchSpy.mockRestore();
  });

  it("returns 503 when the upstream container reports a non-ok status", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(baseRecord);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("err", { status: 500 }));

    const response = await request(app).get("/api/managed-containers/1/health");

    expect(response.status).toBe(503);
    fetchSpy.mockRestore();
  });

  it("returns 404 when the record is missing", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);

    const response = await request(app).get("/api/managed-containers/999/health");

    expect(response.status).toBe(404);
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

describe("POST error path with non-Error rejection", () => {
  it("includes the stringified non-Error reason when runContainer rejects with a non-Error", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockRejectedValue("docker boom");

    const response = await request(app).post("/api/managed-containers").send({});

    expect(response.status).toBe(500);
    expect(response.body.error).toMatch(/docker boom/);
  });
});
