import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listManagedContainers,
  getManagedContainer,
  createManagedContainer,
  deleteManagedContainer,
  pingManagedContainerHealth,
} from "./managedContainersApi";

const mockRecord = {
  id: 1,
  name: "abc123def456",
  dockerId: "docker-id-1",
  hostPort: 41123,
  status: "running",
  created_date: "2026-05-07T00:00:00.000Z",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("listManagedContainers", () => {
  it("returns the list on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([mockRecord]),
    }));

    const result = await listManagedContainers();

    expect(result).toEqual([mockRecord]);
    expect(fetch).toHaveBeenCalledWith("/api/managed-containers");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(listManagedContainers()).rejects.toThrow("Failed to fetch managed containers");
  });
});

describe("getManagedContainer", () => {
  it("returns the record on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRecord),
    }));

    const result = await getManagedContainer(1);

    expect(result).toEqual(mockRecord);
    expect(fetch).toHaveBeenCalledWith("/api/managed-containers/1");
  });

  it("throws with API error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Managed container not found" }),
    }));

    await expect(getManagedContainer(999)).rejects.toThrow("Managed container not found");
  });

  it("throws a generic message when error body lacks error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(getManagedContainer(999)).rejects.toThrow("Failed to fetch managed container");
  });
});

describe("createManagedContainer", () => {
  it("posts to the API and returns the record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRecord),
    }));

    const result = await createManagedContainer();

    expect(result).toEqual(mockRecord);
    expect(fetch).toHaveBeenCalledWith("/api/managed-containers", expect.objectContaining({ method: "POST" }));
  });

  it("throws with API error on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Failed to start container: docker offline" }),
    }));

    await expect(createManagedContainer()).rejects.toThrow("docker offline");
  });
});

describe("deleteManagedContainer", () => {
  it("deletes by id on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRecord),
    }));

    const result = await deleteManagedContainer(1);

    expect(result).toEqual(mockRecord);
    expect(fetch).toHaveBeenCalledWith("/api/managed-containers/1", expect.objectContaining({ method: "DELETE" }));
  });

  it("throws on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "boom" }),
    }));

    await expect(deleteManagedContainer(1)).rejects.toThrow("boom");
  });

  it("throws with generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(deleteManagedContainer(1)).rejects.toThrow("Failed to delete managed container");
  });
});

describe("pingManagedContainerHealth", () => {
  it("returns the health body on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ok", name: "abc123def456" }),
    }));

    const result = await pingManagedContainerHealth(1);

    expect(result).toEqual({ status: "ok", name: "abc123def456" });
    expect(fetch).toHaveBeenCalledWith("/api/managed-containers/1/health");
  });

  it("throws with API error on unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Container unreachable: ECONNREFUSED" }),
    }));

    await expect(pingManagedContainerHealth(1)).rejects.toThrow("ECONNREFUSED");
  });

  it("throws with a generic message when error body has no error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(pingManagedContainerHealth(1)).rejects.toThrow("Container health check failed");
  });
});
