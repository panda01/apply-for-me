import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockBuildImage, mockCreateContainer, mockGetContainer, mockFollowProgress } = vi.hoisted(() => ({
  mockBuildImage: vi.fn(),
  mockCreateContainer: vi.fn(),
  mockGetContainer: vi.fn(),
  mockFollowProgress: vi.fn(),
}));

vi.mock("dockerode", () => {
  return {
    default: class MockDocker {
      modem = { followProgress: mockFollowProgress };
      buildImage = mockBuildImage;
      createContainer = mockCreateContainer;
      getContainer = mockGetContainer;
    },
  };
});

import {
  generateContainerName,
  isValidContainerName,
  toDockerName,
  findFreeHostPort,
  ensureImageBuilt,
  runContainer,
  stopAndRemove,
  pickRandomWireGuardConfig,
  resetImageBuildCacheForTesting,
} from "./dockerContainerService.js";

beforeEach(() => {
  vi.clearAllMocks();
  resetImageBuildCacheForTesting();
});

describe("generateContainerName", () => {
  it("returns a 12-character hex string", () => {
    const name = generateContainerName();
    expect(name).toMatch(/^[0-9a-f]{12}$/);
  });

  it("returns unique names across calls", () => {
    const a = generateContainerName();
    const b = generateContainerName();
    expect(a).not.toBe(b);
  });
});

describe("toDockerName", () => {
  it("prefixes the user-visible name with afm-", () => {
    expect(toDockerName("foo")).toBe("afm-foo");
  });
});

describe("isValidContainerName", () => {
  it("accepts simple alphanumeric names", () => {
    expect(isValidContainerName("foo123")).toBe(true);
  });

  it("rejects names with spaces", () => {
    expect(isValidContainerName("foo bar")).toBe(false);
  });

  it("rejects empty names", () => {
    expect(isValidContainerName("")).toBe(false);
  });

  it("rejects names that begin with non-alphanumeric characters", () => {
    expect(isValidContainerName("-foo")).toBe(false);
  });

  it("rejects overly long names", () => {
    expect(isValidContainerName("a".repeat(50))).toBe(false);
  });
});

describe("findFreeHostPort", () => {
  it("returns a port in the configured range", async () => {
    const port = await findFreeHostPort();
    expect(port).toBeGreaterThanOrEqual(41000);
    expect(port).toBeLessThanOrEqual(41999);
  });
});

describe("pickRandomWireGuardConfig", () => {
  it("returns a config basename without the .conf extension", () => {
    const chosen = pickRandomWireGuardConfig();
    // wg_configs/ in the repo holds real us-nyc-wg-* configs; either way the
    // returned name should never include a .conf suffix and should be non-empty.
    expect(chosen).not.toMatch(/\.conf$/);
    expect(chosen.length).toBeGreaterThan(0);
  });
});

describe("ensureImageBuilt", () => {
  it("builds the image once and caches the result", async () => {
    mockBuildImage.mockResolvedValue({ on: vi.fn() });
    mockFollowProgress.mockImplementation((_stream: unknown, cb: (err: Error | null) => void) => cb(null));

    await ensureImageBuilt();
    await ensureImageBuilt();

    expect(mockBuildImage).toHaveBeenCalledTimes(1);
  });

  it("propagates build errors and clears the cached promise so retry is possible", async () => {
    mockBuildImage.mockResolvedValue({ on: vi.fn() });
    mockFollowProgress.mockImplementationOnce((_stream: unknown, cb: (err: Error | null) => void) =>
      cb(new Error("build failed"))
    );

    await expect(ensureImageBuilt()).rejects.toThrow("build failed");

    mockFollowProgress.mockImplementationOnce((_stream: unknown, cb: (err: Error | null) => void) => cb(null));
    await expect(ensureImageBuilt()).resolves.toBeUndefined();
    expect(mockBuildImage).toHaveBeenCalledTimes(2);
  });
});

describe("runContainer", () => {
  it("creates and starts a container, waits for readiness, then returns the id and host port", async () => {
    mockBuildImage.mockResolvedValue({ on: vi.fn() });
    mockFollowProgress.mockImplementation((_stream: unknown, cb: (err: Error | null) => void) => cb(null));
    const startMock = vi.fn().mockResolvedValue(undefined);
    mockCreateContainer.mockResolvedValue({ id: "docker-id-xyz", start: startMock });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await runContainer("foo");

    expect(result.dockerId).toBe("docker-id-xyz");
    expect(result.hostPort).toBeGreaterThanOrEqual(41000);
    expect(result.hostPort).toBeLessThanOrEqual(41999);
    expect(result.wgConfigName.length).toBeGreaterThan(0);

    const createArgs = mockCreateContainer.mock.calls[0]?.[0] as {
      name: string;
      Env: string[];
      HostConfig: {
        PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>;
        CapAdd: string[];
        Devices: Array<{ PathOnHost: string; PathInContainer: string; CgroupPermissions: string }>;
        Sysctls: Record<string, string>;
        Binds: string[];
      };
    };
    expect(createArgs.name).toBe("afm-foo");
    expect(createArgs.Env).toContain("CONTAINER_NAME=foo");
    expect(createArgs.Env.some((entry) => entry.startsWith("WG_CONFIG_NAME="))).toBe(true);
    expect(createArgs.Env.some((entry) => entry.startsWith("ANTHROPIC_API_KEY="))).toBe(true);
    expect(createArgs.HostConfig.PortBindings["3000/tcp"]?.[0]?.HostIp).toBe("127.0.0.1");
    expect(createArgs.HostConfig.CapAdd).toContain("NET_ADMIN");
    expect(createArgs.HostConfig.Devices[0]?.PathOnHost).toBe("/dev/net/tun");
    expect(createArgs.HostConfig.Sysctls["net.ipv4.conf.all.src_valid_mark"]).toBe("1");
    expect(createArgs.HostConfig.Binds.some((bind) => bind.endsWith("/etc/wireguard-configs:ro"))).toBe(true);
    expect(startMock).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rolls back the docker container if readiness times out", async () => {
    vi.useFakeTimers();
    mockBuildImage.mockResolvedValue({ on: vi.fn() });
    mockFollowProgress.mockImplementation((_stream: unknown, cb: (err: Error | null) => void) => cb(null));
    const startMock = vi.fn().mockResolvedValue(undefined);
    const stopMock = vi.fn().mockResolvedValue(undefined);
    const removeMock = vi.fn().mockResolvedValue(undefined);
    mockCreateContainer.mockResolvedValue({ id: "docker-id-rb", start: startMock });
    mockGetContainer.mockReturnValue({ stop: stopMock, remove: removeMock });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const promise = runContainer("foo").catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(50000);
    const result = await promise;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/did not become ready/);
    expect(stopMock).toHaveBeenCalled();
    expect(removeMock).toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe("stopAndRemove", () => {
  it("stops then removes the container", async () => {
    const stopMock = vi.fn().mockResolvedValue(undefined);
    const removeMock = vi.fn().mockResolvedValue(undefined);
    mockGetContainer.mockReturnValue({ stop: stopMock, remove: removeMock });

    await stopAndRemove("docker-id-xyz");

    expect(stopMock).toHaveBeenCalledOnce();
    expect(removeMock).toHaveBeenCalledOnce();
  });

  it("tolerates 304 (already stopped) when stopping", async () => {
    const stopMock = vi.fn().mockRejectedValue(Object.assign(new Error("not modified"), { statusCode: 304 }));
    const removeMock = vi.fn().mockResolvedValue(undefined);
    mockGetContainer.mockReturnValue({ stop: stopMock, remove: removeMock });

    await expect(stopAndRemove("docker-id-xyz")).resolves.toBeUndefined();
    expect(removeMock).toHaveBeenCalledOnce();
  });

  it("tolerates 404 (already gone) when removing", async () => {
    const stopMock = vi.fn().mockResolvedValue(undefined);
    const removeMock = vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 }));
    mockGetContainer.mockReturnValue({ stop: stopMock, remove: removeMock });

    await expect(stopAndRemove("docker-id-xyz")).resolves.toBeUndefined();
  });

  it("rethrows non-tolerated errors", async () => {
    const stopMock = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    mockGetContainer.mockReturnValue({ stop: stopMock, remove: vi.fn() });

    await expect(stopAndRemove("docker-id-xyz")).rejects.toThrow("boom");
  });

  it("rethrows non-tolerated errors thrown by remove", async () => {
    const stopMock = vi.fn().mockResolvedValue(undefined);
    const removeMock = vi.fn().mockRejectedValue(Object.assign(new Error("remove failed"), { statusCode: 500 }));
    mockGetContainer.mockReturnValue({ stop: stopMock, remove: removeMock });

    await expect(stopAndRemove("docker-id-xyz")).rejects.toThrow("remove failed");
  });

  it("rethrows non-object errors thrown during stop (e.g. a string)", async () => {
    const stopMock = vi.fn().mockRejectedValue("string-error");
    mockGetContainer.mockReturnValue({ stop: stopMock, remove: vi.fn() });

    await expect(stopAndRemove("docker-id-xyz")).rejects.toBe("string-error");
  });

  it("rethrows non-object errors thrown during remove (e.g. a string)", async () => {
    const stopMock = vi.fn().mockResolvedValue(undefined);
    const removeMock = vi.fn().mockRejectedValue("string-error");
    mockGetContainer.mockReturnValue({ stop: stopMock, remove: removeMock });

    await expect(stopAndRemove("docker-id-xyz")).rejects.toBe("string-error");
  });
});
