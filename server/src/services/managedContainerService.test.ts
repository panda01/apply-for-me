import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prismaClient.js", () => ({
  default: {
    managedContainer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("./dockerContainerService.js", () => ({
  generateContainerName: vi.fn(() => "abc123def456"),
  isValidContainerName: vi.fn((name: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,40}$/.test(name)),
  runContainer: vi.fn(),
  stopAndRemove: vi.fn(),
}));

import prisma from "../prismaClient.js";
import {
  generateContainerName,
  isValidContainerName,
  runContainer,
  stopAndRemove,
} from "./dockerContainerService.js";
import {
  spawnAndRegisterContainer,
  findOrSpawnRunningContainer,
  isPrismaUniqueViolation,
  SpawnContainerError,
} from "./managedContainerService.js";

const mockCreatedRecord = {
  id: 7,
  name: "abc123def456",
  dockerId: "docker-id-1",
  hostPort: 41001,
  wgConfigName: "us-nyc-wg-301",
  status: "running" as const,
  created_date: new Date("2026-05-17T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateContainerName).mockReturnValue("abc123def456");
  vi.mocked(isValidContainerName).mockImplementation((name: string) =>
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,40}$/.test(name)
  );
});

describe("isPrismaUniqueViolation", () => {
  it("returns true for an object with code P2002", () => {
    expect(isPrismaUniqueViolation({ code: "P2002" })).toBe(true);
  });

  it("returns false for an object with a different code", () => {
    expect(isPrismaUniqueViolation({ code: "P3000" })).toBe(false);
  });

  it("returns false for null/undefined/primitives", () => {
    expect(isPrismaUniqueViolation(null)).toBe(false);
    expect(isPrismaUniqueViolation(undefined)).toBe(false);
    expect(isPrismaUniqueViolation("P2002")).toBe(false);
    expect(isPrismaUniqueViolation(42)).toBe(false);
  });

  it("returns false for an object without a code property", () => {
    expect(isPrismaUniqueViolation({ message: "boom" })).toBe(false);
  });
});

describe("SpawnContainerError", () => {
  it("preserves the kind discriminator and the message", () => {
    const err = new SpawnContainerError("docker_failed", "docker is down");
    expect(err.kind).toBe("docker_failed");
    expect(err.message).toBe("docker is down");
    expect(err.name).toBe("SpawnContainerError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("spawnAndRegisterContainer", () => {
  it("auto-generates a container name when none is provided", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-1", hostPort: 41001, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockResolvedValue(mockCreatedRecord);

    await spawnAndRegisterContainer();

    expect(generateContainerName).toHaveBeenCalled();
    expect(runContainer).toHaveBeenCalledWith("abc123def456");
  });

  it("uses the provided name when one is supplied", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "d", hostPort: 41001, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockResolvedValue(mockCreatedRecord);

    await spawnAndRegisterContainer("my-container");

    expect(generateContainerName).not.toHaveBeenCalled();
    expect(runContainer).toHaveBeenCalledWith("my-container");
  });

  it("throws SpawnContainerError(invalid_name) for an invalid name", async () => {
    await expect(spawnAndRegisterContainer("!!invalid!!")).rejects.toMatchObject({
      name: "SpawnContainerError",
      kind: "invalid_name",
    });
    expect(runContainer).not.toHaveBeenCalled();
  });

  it("throws SpawnContainerError(name_taken) when the name already exists", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(mockCreatedRecord);

    await expect(spawnAndRegisterContainer("my-container")).rejects.toMatchObject({
      kind: "name_taken",
    });
    expect(runContainer).not.toHaveBeenCalled();
  });

  it("throws SpawnContainerError(docker_failed) when runContainer rejects with Error", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockRejectedValue(new Error("docker daemon offline"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    await expect(spawnAndRegisterContainer()).rejects.toMatchObject({
      kind: "docker_failed",
      message: expect.stringMatching(/docker daemon offline/),
    });
    consoleErrorSpy.mockRestore();
  });

  it("stringifies a non-Error rejection from runContainer in the message", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockRejectedValue("docker-string-failure");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    await expect(spawnAndRegisterContainer()).rejects.toMatchObject({
      kind: "docker_failed",
      message: expect.stringMatching(/docker-string-failure/),
    });
    consoleErrorSpy.mockRestore();
  });

  it("rolls back the docker container and throws name_taken on a P2002 DB race", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-1", hostPort: 41001, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue({ code: "P2002" });
    vi.mocked(stopAndRemove).mockResolvedValue(undefined);

    await expect(spawnAndRegisterContainer()).rejects.toMatchObject({
      kind: "name_taken",
    });
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-1");
  });

  it("rolls back the docker container and throws db_failed on a generic DB error", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-2", hostPort: 41002, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue(new Error("DB write failed"));
    vi.mocked(stopAndRemove).mockResolvedValue(undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    await expect(spawnAndRegisterContainer()).rejects.toMatchObject({
      kind: "db_failed",
      message: expect.stringMatching(/DB write failed/),
    });
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-2");
    consoleErrorSpy.mockRestore();
  });

  it("logs a non-Error rollback failure when stopAndRemove rejects", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-3", hostPort: 41003, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockRejectedValue(new Error("DB write failed"));
    vi.mocked(stopAndRemove).mockRejectedValue("cleanup-non-error");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    await expect(spawnAndRegisterContainer()).rejects.toMatchObject({ kind: "db_failed" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/cleanup-non-error/));
    consoleErrorSpy.mockRestore();
  });

  it("returns the created record on the happy path", async () => {
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-1", hostPort: 41001, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockResolvedValue(mockCreatedRecord);

    const result = await spawnAndRegisterContainer();

    expect(result).toEqual(mockCreatedRecord);
  });
});

describe("findOrSpawnRunningContainer", () => {
  it("returns an existing running container when one is found", async () => {
    vi.mocked(prisma.managedContainer.findFirst).mockResolvedValue({ id: 5, hostPort: 41005 } as never);

    const result = await findOrSpawnRunningContainer();

    expect(result).toEqual({ id: 5, hostPort: 41005 });
    expect(runContainer).not.toHaveBeenCalled();
  });

  it("spawns a new container when no running one exists", async () => {
    vi.mocked(prisma.managedContainer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockResolvedValue({ dockerId: "docker-id-1", hostPort: 41001, wgConfigName: "us-nyc-wg-301" });
    vi.mocked(prisma.managedContainer.create).mockResolvedValue(mockCreatedRecord);

    const result = await findOrSpawnRunningContainer();

    expect(result).toEqual({ id: mockCreatedRecord.id, hostPort: mockCreatedRecord.hostPort });
    expect(runContainer).toHaveBeenCalled();
  });

  it("propagates SpawnContainerError when spawn fails", async () => {
    vi.mocked(prisma.managedContainer.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.managedContainer.findUnique).mockResolvedValue(null);
    vi.mocked(runContainer).mockRejectedValue(new Error("docker offline"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* swallow */ });

    await expect(findOrSpawnRunningContainer()).rejects.toMatchObject({
      name: "SpawnContainerError",
      kind: "docker_failed",
    });
    consoleErrorSpy.mockRestore();
  });
});
