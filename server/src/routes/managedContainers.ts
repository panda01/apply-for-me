import { Router, Request, Response } from "express";
import prisma from "../prismaClient.js";
import {
  generateContainerName,
  isValidContainerName,
  runContainer,
  stopAndRemove,
} from "../services/dockerContainerService.js";

const router = Router();

/**
 * Maximum time (ms) to wait when proxying a health check to a managed container
 * before giving up and reporting the container unreachable.
 */
const HEALTH_CHECK_TIMEOUT_MS = 3000;

/**
 * POST /api/managed-containers
 * Creates and starts a new managed Docker container with an auto-generated name,
 * then persists a record. Optionally accepts { name } in the body to override the auto-generated name.
 * @param {string} [req.body.name] - Optional user-supplied container name (without afm- prefix)
 * @returns {object} 201 - The created managed container record
 * @returns {object} 400 - Invalid name error
 * @returns {object} 409 - Name already in use error
 * @returns {object} 500 - Docker failure error
 */
router.post("/", async (req: Request, res: Response) => {
  const requestedNameRaw = (req.body as { name?: unknown } | undefined)?.name;
  const hasRequestedName = typeof requestedNameRaw === "string" && requestedNameRaw.length > 0;
  const containerName = hasRequestedName ? requestedNameRaw : generateContainerName();

  const isInvalidName = !isValidContainerName(containerName);
  if (isInvalidName) {
    res.status(400).json({ error: "Invalid container name" });
    return;
  }

  const existingByName = await prisma.managedContainer.findUnique({
    where: { name: containerName },
  });
  const isNameTaken = existingByName !== null;
  if (isNameTaken) {
    res.status(409).json({ error: "A managed container with that name already exists" });
    return;
  }

  let dockerId: string;
  let hostPort: number;
  try {
    const result = await runContainer(containerName);
    dockerId = result.dockerId;
    hostPort = result.hostPort;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[managed-containers] Failed to start container "${containerName}": ${errorMessage}`);
    res.status(500).json({ error: `Failed to start container: ${errorMessage}` });
    return;
  }

  // If the DB insert fails after docker created the container, we need to roll back
  // the docker side or the container leaks (running with no record to find/delete it).
  try {
    const newRecord = await prisma.managedContainer.create({
      data: {
        name: containerName,
        dockerId,
        hostPort,
        status: "running",
      },
    });
    res.status(201).json(newRecord);
  } catch (err) {
    await stopAndRemove(dockerId).catch((cleanupErr: unknown) => {
      const cleanupMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      console.error(`[managed-containers] Failed to clean up orphaned container ${dockerId}: ${cleanupMessage}`);
    });

    const isUniqueViolation = isPrismaUniqueViolation(err);
    if (isUniqueViolation) {
      res.status(409).json({ error: "A managed container with that name already exists" });
      return;
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[managed-containers] DB insert failed; rolled back docker container ${dockerId}: ${errorMessage}`);
    res.status(500).json({ error: `Failed to persist container: ${errorMessage}` });
  }
});

/**
 * Determines whether a thrown error is a Prisma P2002 unique-constraint violation.
 * @param {unknown} err - The thrown error
 * @returns {boolean} True if the error is a P2002 unique-constraint violation
 */
function isPrismaUniqueViolation(err: unknown): boolean {
  const isObject = typeof err === "object" && err !== null;
  if (!isObject) {
    return false;
  }
  const code = (err as { code?: string }).code;
  return code === "P2002";
}

/**
 * GET /api/managed-containers
 * Lists all managed containers ordered by created_date descending.
 * @returns {object[]} 200 - Array of managed container records
 */
router.get("/", async (_req: Request, res: Response) => {
  const records = await prisma.managedContainer.findMany({
    orderBy: { created_date: "desc" },
  });
  res.json(records);
});

/**
 * GET /api/managed-containers/:id
 * Retrieves a single managed container by id.
 * @param {number} req.params.id - The managed container id
 * @returns {object} 200 - The managed container record
 * @returns {object} 400 - Invalid id error
 * @returns {object} 404 - Not found error
 */
router.get("/:id", async (req: Request, res: Response) => {
  const record = await loadManagedContainerOrSend404(req, res);
  if (record === null) {
    return;
  }
  res.json(record);
});

/**
 * GET /api/managed-containers/:id/health
 * Proxies a health check to the managed container, hitting its mapped host port.
 * Returns the container's response on success, or 503 on unreachable.
 * @param {number} req.params.id - The managed container id
 * @returns {object} 200 - { status: "ok", name } from the container
 * @returns {object} 400 - Invalid id error
 * @returns {object} 404 - Managed container not found
 * @returns {object} 503 - Container unreachable
 */
router.get("/:id/health", async (req: Request, res: Response) => {
  const record = await loadManagedContainerOrSend404(req, res);
  if (record === null) {
    return;
  }

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(`http://127.0.0.1:${record.hostPort}/health`, {
      signal: abortController.signal,
    });
    const isUpstreamOk = upstreamResponse.ok;
    if (!isUpstreamOk) {
      res.status(503).json({ error: "Container reported non-ok status" });
      return;
    }
    const upstreamBody = await upstreamResponse.json() as { status?: string; name?: string };
    res.json(upstreamBody);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `Container unreachable: ${errorMessage}` });
  } finally {
    clearTimeout(timeoutHandle);
  }
});

/**
 * DELETE /api/managed-containers/:id
 * Stops and removes the underlying Docker container, then deletes the record.
 * Tolerates already-removed containers so the DB is always cleaned up.
 * @param {number} req.params.id - The managed container id
 * @returns {object} 200 - The deleted managed container record
 * @returns {object} 400 - Invalid id error
 * @returns {object} 404 - Managed container not found
 * @returns {object} 500 - Docker failure error
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const existing = await loadManagedContainerOrSend404(req, res);
  if (existing === null) {
    return;
  }

  try {
    await stopAndRemove(existing.dockerId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[managed-containers] Failed to stop/remove ${existing.dockerId}: ${errorMessage}`);
    res.status(500).json({ error: `Failed to remove container: ${errorMessage}` });
    return;
  }

  const deleted = await prisma.managedContainer.delete({ where: { id: existing.id } });
  res.json(deleted);
});

/**
 * Parses the :id route param into a positive integer. Sends a 400 response
 * and returns null when the param is missing or not a number; otherwise returns the id.
 * @param {Request} req - The incoming request
 * @param {Response} res - The response (used to write 400 on error)
 * @returns {number | null} The parsed id, or null if invalid (response already written)
 */
function parseManagedContainerId(req: Request, res: Response): number | null {
  const rawId = req.params.id;
  const id = typeof rawId === "string" ? parseInt(rawId, 10) : NaN;
  const isInvalidId = isNaN(id);
  if (isInvalidId) {
    res.status(400).json({ error: "Invalid id parameter" });
    return null;
  }
  return id;
}

/**
 * Parses the :id param, looks up the managed container, and writes 400/404 responses
 * for missing or invalid ids. Returns the record on success, or null if a response was sent.
 * @param {Request} req - The incoming request
 * @param {Response} res - The response (used to write 400/404 on error)
 * @returns {Promise<{ id: number; name: string; dockerId: string; hostPort: number; status: string; created_date: Date } | null>} The record or null
 */
async function loadManagedContainerOrSend404(
  req: Request,
  res: Response
): Promise<Awaited<ReturnType<typeof prisma.managedContainer.findUnique>> | null> {
  const id = parseManagedContainerId(req, res);
  if (id === null) {
    return null;
  }
  const record = await prisma.managedContainer.findUnique({ where: { id } });
  if (record === null) {
    res.status(404).json({ error: "Managed container not found" });
    return null;
  }
  return record;
}

export { router as managedContainersRouter };
