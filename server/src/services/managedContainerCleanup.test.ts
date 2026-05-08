import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../prismaClient.js", () => {
  return {
    default: {
      managedContainer: {
        findMany: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

vi.mock("./dockerContainerService.js", () => {
  return {
    stopAndRemove: vi.fn(),
  };
});

import prisma from "../prismaClient.js";
import { stopAndRemove } from "./dockerContainerService.js";
import { cleanupAllManagedContainers } from "./managedContainerCleanup.js";

const baseRecord = {
  id: 1,
  name: "abc123def456",
  dockerId: "docker-id-1",
  hostPort: 41123,
  wgConfigName: "us-nyc-wg-301",
  status: "running" as const,
  created_date: new Date("2026-05-08T00:00:00.000Z"),
};

const secondRecord = {
  ...baseRecord,
  id: 2,
  name: "fedcba654321",
  dockerId: "docker-id-2",
  hostPort: 41124,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cleanupAllManagedContainers", () => {
  it("returns immediately when there are no records", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([]);

    await cleanupAllManagedContainers();

    expect(stopAndRemove).not.toHaveBeenCalled();
    expect(prisma.managedContainer.delete).not.toHaveBeenCalled();
  });

  it("stops + removes every tracked container and deletes its DB row", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([baseRecord, secondRecord]);
    vi.mocked(stopAndRemove).mockResolvedValue();
    vi.mocked(prisma.managedContainer.delete).mockResolvedValue(baseRecord);

    await cleanupAllManagedContainers();

    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-1");
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-2");
    expect(prisma.managedContainer.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(prisma.managedContainer.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });

  it("keeps the DB row when stopAndRemove fails so operators can find the leak", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([baseRecord]);
    vi.mocked(stopAndRemove).mockRejectedValue(new Error("docker daemon offline"));

    await cleanupAllManagedContainers();

    expect(prisma.managedContainer.delete).not.toHaveBeenCalled();
  });

  it("does not crash when the DB delete also fails after stopAndRemove succeeds", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([baseRecord]);
    vi.mocked(stopAndRemove).mockResolvedValue();
    vi.mocked(prisma.managedContainer.delete).mockRejectedValue(new Error("db locked"));

    await expect(cleanupAllManagedContainers()).resolves.toBeUndefined();
    expect(stopAndRemove).toHaveBeenCalledOnce();
  });

  it("processes the remaining containers when one of them throws", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([baseRecord, secondRecord]);
    vi.mocked(stopAndRemove)
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce();
    vi.mocked(prisma.managedContainer.delete).mockResolvedValue(secondRecord);

    await cleanupAllManagedContainers();

    expect(stopAndRemove).toHaveBeenCalledTimes(2);
    // First record's DB row should remain (its stop failed); second should be deleted.
    expect(prisma.managedContainer.delete).toHaveBeenCalledTimes(1);
    expect(prisma.managedContainer.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });

  it("logs the docker error message when stopAndRemove rejects with a non-Error", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([baseRecord]);
    vi.mocked(stopAndRemove).mockRejectedValue("string-rejection");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await cleanupAllManagedContainers();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/string-rejection/));
    errorSpy.mockRestore();
  });

  it("logs the db error message when prisma.delete rejects with a non-Error", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([baseRecord]);
    vi.mocked(stopAndRemove).mockResolvedValue();
    vi.mocked(prisma.managedContainer.delete).mockRejectedValue("db-string-rejection");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await cleanupAllManagedContainers();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/db-string-rejection/));
    errorSpy.mockRestore();
  });
});
