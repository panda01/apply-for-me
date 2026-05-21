/**
 * High-level orchestration over the managed-container lifecycle. Wraps the
 * lower-level docker primitives in `dockerContainerService.ts` plus the
 * `managed_containers` Prisma table so callers can spawn a container, get
 * back a fully-registered record, and not worry about rollback on partial
 * failures.
 *
 * Two public entrypoints today:
 *   - `spawnAndRegisterContainer(name?)` — full create flow. Used by the
 *     POST /api/managed-containers route AND by the fetch/resolve auto-spawn
 *     paths so the implementation stays in one place.
 *   - `findOrSpawnRunningContainer()` — convenience wrapper used by the
 *     job-listings routes that need a container to scrape with; uses an
 *     existing running container when present, otherwise calls spawn.
 */

import prisma from "../prismaClient.js";
import {
  generateContainerName,
  isValidContainerName,
  runContainer,
  stopAndRemove,
} from "./dockerContainerService.js";

/**
 * The full ManagedContainer Prisma row returned after a successful spawn.
 * Aliased so callers don't have to import generated-client paths.
 */
export type SpawnedContainerRecord = NonNullable<Awaited<ReturnType<typeof prisma.managedContainer.findUnique>>>;

/**
 * Determines whether a thrown error is a Prisma P2002 unique-constraint
 * violation. Used to translate the second-caller-races-the-first scenario
 * into a clear conflict rather than a generic 500.
 *
 * @param {unknown} err - The thrown error
 * @returns {boolean} True if the error is a P2002 unique-constraint violation
 */
export function isPrismaUniqueViolation(err: unknown): boolean {
  const isObject = typeof err === "object" && err !== null;
  if (!isObject) {
    return false;
  }
  const code = (err as { code?: string }).code;
  return code === "P2002";
}

/**
 * Failure modes the route layer needs to map to HTTP status codes when the
 * caller-facing spawn fails. The status mapping lives at the route level so
 * this service stays HTTP-agnostic.
 */
export class SpawnContainerError extends Error {
  constructor(public readonly kind: "invalid_name" | "name_taken" | "docker_failed" | "db_failed", message: string) {
    super(message);
    this.name = "SpawnContainerError";
  }
}

/**
 * Spawns a new managed Docker container and registers it in the
 * `managed_containers` table. On a successful DB insert returns a
 * summary of the new record; on any failure (invalid name, docker
 * create, db insert) throws a `SpawnContainerError` with a structured
 * `kind` the route handler can use to pick the right HTTP status.
 *
 * If Docker created the container but the DB insert subsequently failed,
 * the function stops + removes the docker container before throwing, so
 * we never leak a running container without a corresponding DB row.
 *
 * @param {string} [requestedName] - Optional user-supplied name (without the afm- prefix); auto-generated when omitted
 * @returns {Promise<SpawnedContainerRecord>} The full ManagedContainer row created in the DB
 * @throws {SpawnContainerError} When the name is invalid, already taken, docker fails to start, or the DB insert fails
 */
export async function spawnAndRegisterContainer(requestedName?: string): Promise<SpawnedContainerRecord> {
  const hasRequestedName = typeof requestedName === "string" && requestedName.length > 0;
  const containerName = hasRequestedName ? requestedName : generateContainerName();

  const isInvalidName = !isValidContainerName(containerName);
  if (isInvalidName) {
    throw new SpawnContainerError("invalid_name", "Invalid container name");
  }

  const existingByName = await prisma.managedContainer.findUnique({ where: { name: containerName } });
  const isNameTaken = existingByName !== null;
  if (isNameTaken) {
    throw new SpawnContainerError("name_taken", "A managed container with that name already exists");
  }

  let dockerId: string;
  let hostPort: number;
  let wgConfigName: string;
  try {
    const result = await runContainer(containerName);
    dockerId = result.dockerId;
    hostPort = result.hostPort;
    wgConfigName = result.wgConfigName;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[managed-containers] Failed to start container "${containerName}": ${errorMessage}`);
    throw new SpawnContainerError("docker_failed", `Failed to start container: ${errorMessage}`);
  }

  try {
    const newRecord = await prisma.managedContainer.create({
      data: {
        name: containerName,
        dockerId,
        hostPort,
        wgConfigName,
        status: "running",
      },
    });
    return newRecord;
  } catch (err) {
    // Roll back the docker side so we don't leak a running container without a DB row.
    await stopAndRemove(dockerId).catch((cleanupErr: unknown) => {
      const cleanupMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      console.error(`[managed-containers] Failed to clean up orphaned container ${dockerId}: ${cleanupMessage}`);
    });

    if (isPrismaUniqueViolation(err)) {
      throw new SpawnContainerError("name_taken", "A managed container with that name already exists");
    }
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[managed-containers] DB insert failed; rolled back docker container ${dockerId}: ${errorMessage}`);
    throw new SpawnContainerError("db_failed", `Failed to persist container: ${errorMessage}`);
  }
}

/**
 * Returns a managed container suitable for running smart-proxy scrapes —
 * either the first one already in `running` status, or, if none exist, a
 * freshly-spawned one. This is the function the job-listings routes call so
 * the user never has to manually spawn a container before clicking Fetch
 * Data.
 *
 * Spawning blocks the caller until the container is ready (per
 * dockerContainerService's readiness poll inside runContainer); typically
 * ~10s for a warm image build, ~30s+ on cold start. The route surfaces the
 * latency by holding the 202 response until this resolves.
 *
 * @returns {Promise<{ id: number; hostPort: number }>} The chosen container
 * @throws {SpawnContainerError} Only on spawn failure when no running container existed
 */
export async function findOrSpawnRunningContainer(): Promise<{ id: number; hostPort: number }> {
  const existing = await prisma.managedContainer.findFirst({
    where: { status: "running" },
    orderBy: { id: "asc" },
    select: { id: true, hostPort: true },
  });
  if (existing !== null) {
    return existing;
  }
  console.log("[managed-containers] no running container — spawning one for the fetch/resolve call");
  const spawned = await spawnAndRegisterContainer();
  return { id: spawned.id, hostPort: spawned.hostPort };
}
