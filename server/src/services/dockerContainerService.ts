import Docker from "dockerode";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { readdirSync } from "node:fs";

/**
 * Service module wrapping dockerode to spawn, stop, and remove
 * managed containers built from the in-repo image at docker/managed-container.
 *
 * The first call to runContainer ensures the image has been built; subsequent calls reuse it.
 * Each container exposes its internal port 3000 on a free host port in the configured range.
 *
 * Each container is also started with a WireGuard config (one of the *.conf files in
 * the repo's wg_configs directory). The config dir is bind-mounted read-only into the
 * container at /etc/wireguard-configs, NET_ADMIN + /dev/net/tun are granted, and the
 * container entrypoint hard-fails if it cannot bring wg0 up. As a result, all egress
 * from the container is forced through WireGuard; if the tunnel cannot start, the
 * container does not start.
 */

const IMAGE_TAG = "afm-managed-container:latest";
const CONTAINER_INTERNAL_PORT = "3000/tcp";
const HOST_NAME_PREFIX = "afm-";
const HOST_PORT_RANGE_START = 41000;
const HOST_PORT_RANGE_END = 41999;
const IMAGE_BUILD_CONTEXT = resolve(__dirname, "../../../docker/managed-container");
const WG_CONFIGS_HOST_DIR = resolve(__dirname, "../../../wg_configs");
const WG_CONFIGS_CONTAINER_MOUNT = "/etc/wireguard-configs";
const CONTAINER_READINESS_TIMEOUT_MS = 45000;
const CONTAINER_READINESS_INTERVAL_MS = 250;

const docker: Docker = new Docker();

let imageBuildPromise: Promise<void> | null = null;

/**
 * The result returned after a container is created and started.
 */
export interface RunContainerResult {
  dockerId: string;
  hostPort: number;
  wgConfigName: string;
}

/**
 * Generates a short, docker-safe container name without the afm- prefix.
 * Names are 12 hex characters, derived from cryptographic random bytes.
 * @returns {string} A unique short name for a managed container
 */
export function generateContainerName(): string {
  return randomBytes(6).toString("hex");
}

/**
 * Returns the prefixed Docker container name for a given user-visible name.
 * @param {string} name - The user-visible container name (without prefix)
 * @returns {string} The fully prefixed Docker container name
 */
export function toDockerName(name: string): string {
  return `${HOST_NAME_PREFIX}${name}`;
}

/**
 * Validates that a container name only contains characters Docker accepts as a name.
 * @param {string} name - The user-visible container name (without prefix)
 * @returns {boolean} True if the name is valid
 */
export function isValidContainerName(name: string): boolean {
  const containerNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,40}$/;
  return containerNamePattern.test(name);
}

/**
 * Picks a random WireGuard config from the repo's wg_configs directory.
 * Reuse is allowed: the same config may be assigned to multiple running containers.
 * Throws if the directory exists but contains no *.conf files.
 * @returns {string} The basename (without .conf extension) of the chosen config
 */
export function pickRandomWireGuardConfig(): string {
  const entries = readdirSync(WG_CONFIGS_HOST_DIR);
  const configBasenames = entries
    .filter((entry) => entry.endsWith(".conf"))
    .map((entry) => entry.slice(0, -".conf".length));
  const hasNoConfigs = configBasenames.length === 0;
  if (hasNoConfigs) {
    throw new Error(`No WireGuard configs found in ${WG_CONFIGS_HOST_DIR}`);
  }
  const chosenIndex = Math.floor(Math.random() * configBasenames.length);
  // Non-empty array guarded above, so [chosenIndex] is always defined.
  return configBasenames[chosenIndex] as string;
}

/**
 * Finds a free TCP port on the loopback interface inside the configured range.
 * Picks a random starting port in the range and probes upward, wrapping around,
 * until it finds one that successfully binds.
 *
 * Note: there is an inherent TOCTOU window between this probe and Docker's bind.
 * If another process grabs the port in that window, docker.createContainer will
 * reject and the caller's catch handler must roll back any partial state.
 * @returns {Promise<number>} A free host port within HOST_PORT_RANGE_START..HOST_PORT_RANGE_END
 */
export async function findFreeHostPort(): Promise<number> {
  const rangeSize = HOST_PORT_RANGE_END - HOST_PORT_RANGE_START + 1;
  const startOffset = Math.floor(Math.random() * rangeSize);

  for (let offset = 0; offset < rangeSize; offset += 1) {
    const candidate = HOST_PORT_RANGE_START + ((startOffset + offset) % rangeSize);
    const isAvailable = await isPortAvailable(candidate);
    if (isAvailable) {
      return candidate;
    }
  }

  throw new Error("Could not find a free host port in the managed-container port range");
}

/**
 * Probes whether the given TCP port is bindable on the loopback interface.
 * @param {number} port - The port to check
 * @returns {Promise<boolean>} True if the port can be bound, false if it is in use
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolveAvailable) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolveAvailable(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolveAvailable(true));
    });
  });
}

/**
 * Builds the managed-container image from the in-repo Dockerfile if it has not yet been built.
 * The build is idempotent and cached; subsequent invocations within the process reuse the same promise.
 * @returns {Promise<void>} Resolves once the image is available
 */
export async function ensureImageBuilt(): Promise<void> {
  if (imageBuildPromise !== null) {
    return imageBuildPromise;
  }

  imageBuildPromise = (async () => {
    const buildStream = await docker.buildImage(
      {
        context: IMAGE_BUILD_CONTEXT,
        src: [
          "Dockerfile",
          "server.ts",
          "agent.ts",
          "popup.ts",
          "smartproxy.ts",
          "package.json",
          "tsconfig.json",
          "entrypoint.sh",
          "resolvconf-shim.sh",
        ],
      },
      { t: IMAGE_TAG }
    );
    await new Promise<void>((resolveBuild, rejectBuild) => {
      docker.modem.followProgress(buildStream, (err) => {
        const hasError = err !== null && err !== undefined;
        if (hasError) {
          rejectBuild(err);
          return;
        }
        resolveBuild();
      });
    });
  })();

  try {
    await imageBuildPromise;
  } catch (err) {
    imageBuildPromise = null;
    throw err;
  }
}

/**
 * Spawns a new managed container with the given user-visible name.
 * Builds the image if needed, allocates a free host port, picks a random WireGuard
 * config, and creates+starts the container with the privileges WireGuard requires
 * (NET_ADMIN, /dev/net/tun, src_valid_mark sysctl) and the wg_configs dir bind-mounted
 * read-only. Waits until /health responds, then returns the docker id, host port, and
 * the assigned WG config name. If readiness times out, the container is stopped and
 * removed so it doesn't leak.
 * @param {string} name - The user-visible container name (without afm- prefix)
 * @returns {Promise<RunContainerResult>} The new container's docker id, host port, and WG config name
 */
export async function runContainer(name: string): Promise<RunContainerResult> {
  await ensureImageBuilt();
  const hostPort = await findFreeHostPort();
  const dockerName = toDockerName(name);
  const wgConfigName = pickRandomWireGuardConfig();

  // The container's /analyze endpoint needs an Anthropic API key to talk to
  // Claude. The host stores it as CLAUDE_API_KEY in .env; the container reads
  // it as ANTHROPIC_API_KEY (the Anthropic SDK's default env var name). If
  // it's missing we forward an empty string and let the /analyze route
  // surface a clear 500 — spawning containers without the key still works
  // for screenshot-only flows.
  const claudeApiKey = process.env["CLAUDE_API_KEY"] ?? "";

  // Smartproxy creds for the optional residential-proxy egress path. When
  // /screenshot or /analyze is called with useProxy=true, the container
  // reads these env vars to build the Playwright proxy config. Forwarding
  // empty strings is fine — the container code returns null and the route
  // returns a clear 500 ("useProxy=true but creds not set").
  const smartproxyUsername = process.env["SMARTPROXY_USERNAME"] ?? "";
  const smartproxyPassword = process.env["SMARTPROXY_PASSWORD"] ?? "";
  const smartproxyEndpoint = process.env["SMARTPROXY_ENDPOINT"] ?? "";

  const container = await docker.createContainer({
    Image: IMAGE_TAG,
    name: dockerName,
    Env: [
      `CONTAINER_NAME=${name}`,
      `WG_CONFIG_NAME=${wgConfigName}`,
      `ANTHROPIC_API_KEY=${claudeApiKey}`,
      `SMARTPROXY_USERNAME=${smartproxyUsername}`,
      `SMARTPROXY_PASSWORD=${smartproxyPassword}`,
      `SMARTPROXY_ENDPOINT=${smartproxyEndpoint}`,
    ],
    ExposedPorts: { [CONTAINER_INTERNAL_PORT]: {} },
    HostConfig: {
      PortBindings: {
        [CONTAINER_INTERNAL_PORT]: [{ HostIp: "127.0.0.1", HostPort: String(hostPort) }],
      },
      AutoRemove: false,
      CapAdd: ["NET_ADMIN"],
      Devices: [
        { PathOnHost: "/dev/net/tun", PathInContainer: "/dev/net/tun", CgroupPermissions: "rwm" },
      ],
      Sysctls: { "net.ipv4.conf.all.src_valid_mark": "1" },
      Binds: [`${WG_CONFIGS_HOST_DIR}:${WG_CONFIGS_CONTAINER_MOUNT}:ro`],
    },
  });

  await container.start();

  try {
    await waitForContainerReady(hostPort);
  } catch (err) {
    await stopAndRemove(container.id).catch(() => {
      /* swallow cleanup error: caller will surface the readiness failure */
    });
    throw err;
  }

  return { dockerId: container.id, hostPort, wgConfigName };
}

/**
 * Polls the container's /health endpoint until it returns 200 or the timeout expires.
 * Required because tsx + npm install inside the container take a few seconds to start
 * Express, and the WireGuard handshake adds further startup latency, so the API would
 * otherwise respond with an unreachable container.
 * @param {number} hostPort - The host port the container's /health is mapped to
 * @returns {Promise<void>} Resolves when the container responds 200; rejects on timeout
 */
async function waitForContainerReady(hostPort: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < CONTAINER_READINESS_TIMEOUT_MS) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(hostPort)}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      /* container not yet listening — keep polling */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, CONTAINER_READINESS_INTERVAL_MS));
  }

  throw new Error(`Container did not become ready within ${String(CONTAINER_READINESS_TIMEOUT_MS)}ms`);
}

/**
 * Stops and removes a Docker container by its full Docker ID.
 * Tolerates already-stopped or already-removed containers (treats those as success).
 * @param {string} dockerId - The full Docker container ID
 * @returns {Promise<void>} Resolves once the container is gone
 */
export async function stopAndRemove(dockerId: string): Promise<void> {
  const container = docker.getContainer(dockerId);
  try {
    await container.stop();
  } catch (err) {
    const isAlreadyStopped = isDockerNotModifiedError(err);
    const isAlreadyGone = isDockerNotFoundError(err);
    if (!isAlreadyStopped && !isAlreadyGone) {
      throw err;
    }
  }
  try {
    await container.remove();
  } catch (err) {
    const isAlreadyGone = isDockerNotFoundError(err);
    if (!isAlreadyGone) {
      throw err;
    }
  }
}

/**
 * Determines whether a thrown error is a Docker "404 not found" response.
 * @param {unknown} err - The thrown error
 * @returns {boolean} True if the error indicates the container is missing
 */
function isDockerNotFoundError(err: unknown): boolean {
  const isObject = typeof err === "object" && err !== null;
  if (!isObject) {
    return false;
  }
  const statusCode = (err as { statusCode?: number }).statusCode;
  return statusCode === 404;
}

/**
 * Determines whether a thrown error is a Docker "304 not modified" response,
 * which indicates the operation (e.g., stop) had no effect because the container was already in that state.
 * @param {unknown} err - The thrown error
 * @returns {boolean} True if the error indicates the container was already in the target state
 */
function isDockerNotModifiedError(err: unknown): boolean {
  const isObject = typeof err === "object" && err !== null;
  if (!isObject) {
    return false;
  }
  const statusCode = (err as { statusCode?: number }).statusCode;
  return statusCode === 304;
}

/**
 * Resets the in-memory image-build promise. Intended for use in tests so each test
 * starts with a clean cache state. Not exported via the index.
 * @returns {void}
 */
export function resetImageBuildCacheForTesting(): void {
  imageBuildPromise = null;
}
