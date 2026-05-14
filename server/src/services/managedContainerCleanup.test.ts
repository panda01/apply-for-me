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
    listContainerIdsForAfmImage: vi.fn(),
  };
});

import prisma from "../prismaClient.js";
import { stopAndRemove, listContainerIdsForAfmImage } from "./dockerContainerService.js";
import { cleanupAllManagedContainers, buildShutdownWorkSet } from "./managedContainerCleanup.js";

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
  // Default: image-ancestor listing returns empty so existing tests that don't
  // care about the orphan path see the same "DB only" behavior as before.
  vi.mocked(listContainerIdsForAfmImage).mockResolvedValue([]);
});

describe("buildShutdownWorkSet", () => {
  it("returns an empty map when both inputs are empty", () => {
    const workSet = buildShutdownWorkSet([], []);
    expect(workSet.size).toBe(0);
  });

  it("uses DB records when only DB rows are provided", () => {
    const workSet = buildShutdownWorkSet([baseRecord], []);
    expect(workSet.get("docker-id-1")).toBe(baseRecord);
    expect(workSet.size).toBe(1);
  });

  it("uses null entries for image-only orphans when only image IDs are provided", () => {
    const workSet = buildShutdownWorkSet([], ["docker-id-orphan"]);
    expect(workSet.get("docker-id-orphan")).toBeNull();
    expect(workSet.size).toBe(1);
  });

  it("dedupes by Docker ID, with the DB record taking precedence over a null entry", () => {
    const workSet = buildShutdownWorkSet([baseRecord], ["docker-id-1"]);
    expect(workSet.size).toBe(1);
    expect(workSet.get("docker-id-1")).toBe(baseRecord);
  });

  it("merges disjoint DB rows and image-only orphans into a single map", () => {
    const workSet = buildShutdownWorkSet([baseRecord], ["docker-id-orphan"]);
    expect(workSet.size).toBe(2);
    expect(workSet.get("docker-id-1")).toBe(baseRecord);
    expect(workSet.get("docker-id-orphan")).toBeNull();
  });
});

describe("cleanupAllManagedContainers", () => {
  it("returns immediately when there are no records and no image-ancestor containers", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([]);
    vi.mocked(listContainerIdsForAfmImage).mockResolvedValue([]);

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

  it("cleans up an image-only orphan without attempting any DB delete", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([]);
    vi.mocked(listContainerIdsForAfmImage).mockResolvedValue(["docker-id-orphan"]);
    vi.mocked(stopAndRemove).mockResolvedValue();

    await cleanupAllManagedContainers();

    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-orphan");
    expect(prisma.managedContainer.delete).not.toHaveBeenCalled();
  });

  it("dedupes when a container appears in both DB and image list (stop called once, row deleted on success)", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([baseRecord]);
    vi.mocked(listContainerIdsForAfmImage).mockResolvedValue(["docker-id-1"]);
    vi.mocked(stopAndRemove).mockResolvedValue();
    vi.mocked(prisma.managedContainer.delete).mockResolvedValue(baseRecord);

    await cleanupAllManagedContainers();

    expect(stopAndRemove).toHaveBeenCalledTimes(1);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-1");
    expect(prisma.managedContainer.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("handles a mixed set: DB-only, image-only orphan, and a container in both", async () => {
    const thirdRecord = { ...baseRecord, id: 3, name: "third-rec", dockerId: "docker-id-3", hostPort: 41125 };
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([baseRecord, thirdRecord]);
    vi.mocked(listContainerIdsForAfmImage).mockResolvedValue(["docker-id-1", "docker-id-orphan"]);
    vi.mocked(stopAndRemove).mockResolvedValue();
    vi.mocked(prisma.managedContainer.delete).mockResolvedValue(baseRecord);

    await cleanupAllManagedContainers();

    // 3 unique Docker IDs: base (in both), third (DB-only), orphan (image-only)
    expect(stopAndRemove).toHaveBeenCalledTimes(3);
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-1");
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-3");
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-orphan");
    // Only the two DB-tracked entries get a delete attempt.
    expect(prisma.managedContainer.delete).toHaveBeenCalledTimes(2);
  });

  it("falls back to DB-only sweep when listContainerIdsForAfmImage throws (daemon-down)", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([baseRecord]);
    vi.mocked(listContainerIdsForAfmImage).mockRejectedValue(new Error("daemon down"));
    vi.mocked(stopAndRemove).mockResolvedValue();
    vi.mocked(prisma.managedContainer.delete).mockResolvedValue(baseRecord);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await cleanupAllManagedContainers();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Failed to list afm-image containers/));
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-1");
    expect(prisma.managedContainer.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    errorSpy.mockRestore();
  });

  it("falls back to image-only sweep when prisma.findMany throws", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockRejectedValue(new Error("db unreachable"));
    vi.mocked(listContainerIdsForAfmImage).mockResolvedValue(["docker-id-orphan"]);
    vi.mocked(stopAndRemove).mockResolvedValue();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await cleanupAllManagedContainers();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Failed to read managed_containers from DB/));
    expect(stopAndRemove).toHaveBeenCalledWith("docker-id-orphan");
    expect(prisma.managedContainer.delete).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("logs a stop/remove failure for an image-only orphan without attempting any DB delete", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([]);
    vi.mocked(listContainerIdsForAfmImage).mockResolvedValue(["docker-id-orphan"]);
    vi.mocked(stopAndRemove).mockRejectedValue(new Error("orphan stop failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await cleanupAllManagedContainers();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/image-only orphan/));
    expect(prisma.managedContainer.delete).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("logs the read-DB rejection reason when prisma.findMany rejects with a non-Error", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockRejectedValue("db-string-reason");
    vi.mocked(listContainerIdsForAfmImage).mockResolvedValue([]);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await cleanupAllManagedContainers();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/db-string-reason/));
    errorSpy.mockRestore();
  });

  it("logs the list-images rejection reason when listContainerIdsForAfmImage rejects with a non-Error", async () => {
    vi.mocked(prisma.managedContainer.findMany).mockResolvedValue([]);
    vi.mocked(listContainerIdsForAfmImage).mockRejectedValue("docker-string-reason");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await cleanupAllManagedContainers();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/docker-string-reason/));
    errorSpy.mockRestore();
  });
});
