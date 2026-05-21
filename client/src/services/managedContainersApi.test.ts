import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listManagedContainers,
  getManagedContainer,
  createManagedContainer,
  deleteManagedContainer,
  pingManagedContainerHealth,
  captureScreenshot,
  analyzeUrl,
} from "./managedContainersApi";

const mockRecord = {
  id: 1,
  name: "abc123def456",
  dockerId: "docker-id-1",
  hostPort: 41123,
  wgConfigName: "us-nyc-wg-301",
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

describe("captureScreenshot", () => {
  it("returns a Blob on success", async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    }));

    const result = await captureScreenshot(1, "https://google.com");

    expect(result).toBe(blob);
    expect(fetch).toHaveBeenCalledWith(
      "/api/managed-containers/1/screenshot",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://google.com", useProxy: false }),
      })
    );
  });

  it("forwards useProxy=true in the body when explicitly enabled", async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
    }));

    await captureScreenshot(1, "https://indeed.com/jobs", true);

    expect(fetch).toHaveBeenCalledWith(
      "/api/managed-containers/1/screenshot",
      expect.objectContaining({
        body: JSON.stringify({ url: "https://indeed.com/jobs", useProxy: true }),
      })
    );
  });

  it("throws with the server's error message on non-OK responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Container screenshot failed: page.goto timeout" }),
    }));

    await expect(captureScreenshot(1, "https://google.com")).rejects.toThrow(/page\.goto timeout/);
  });

  it("throws a generic message when the error body lacks an error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(captureScreenshot(1, "https://google.com")).rejects.toThrow("Failed to capture screenshot");
  });

  it("throws a generic message when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error("not json")),
    }));

    await expect(captureScreenshot(1, "https://google.com")).rejects.toThrow("Failed to capture screenshot");
  });
});

describe("analyzeUrl", () => {
  const fixture = {
    is_job_description: true,
    apply_button_present: true,
    description_signals: ["Responsibilities", "Full-time"],
    reasoning: "OK",
    screenshot_b64: "iVBORw0KGgo=",
    title: "Software Engineer",
    company: "Acme Corp",
    description: "Description text.",
    salary: "$100k",
    post_date: "3 days ago",
    apply_button_url: "https://acme.com/apply",
  };

  it("posts to the analyze endpoint and returns the parsed verdict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture),
    }));

    const result = await analyzeUrl(1, "https://example.com/job/1");

    expect(result).toEqual(fixture);
    expect(fetch).toHaveBeenCalledWith(
      "/api/managed-containers/1/analyze",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/job/1", useProxy: false }),
      })
    );
  });

  it("forwards useProxy=true in the body when explicitly enabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture),
    }));

    await analyzeUrl(1, "https://indeed.com/jobs", true);

    expect(fetch).toHaveBeenCalledWith(
      "/api/managed-containers/1/analyze",
      expect.objectContaining({
        body: JSON.stringify({ url: "https://indeed.com/jobs", useProxy: true }),
      })
    );
  });

  it("throws with the server's error message on non-OK responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Container analyze failed: Agent exceeded 8 turns" }),
    }));

    await expect(analyzeUrl(1, "https://example.com")).rejects.toThrow(/exceeded 8 turns/);
  });

  it("throws a generic message when the error body lacks an error field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    await expect(analyzeUrl(1, "https://example.com")).rejects.toThrow("Failed to analyze URL");
  });
});
