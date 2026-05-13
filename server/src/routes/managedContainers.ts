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
 * Maximum time (ms) to wait when proxying a screenshot request to a managed container.
 * Kept generous because the page is fetched through the WireGuard tunnel and Playwright's
 * own navigation timeout is 30s, so this must be longer than that to surface the upstream
 * error rather than aborting it.
 */
const SCREENSHOT_TIMEOUT_MS = 60000;

/**
 * Maximum time (ms) to wait when proxying an /analyze request. The agent loop can
 * make several Claude calls plus several Playwright actions, so this is generous —
 * the upstream agent itself caps turns at 8.
 */
const ANALYZE_TIMEOUT_MS = 120000;

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
  let wgConfigName: string;
  try {
    const result = await runContainer(containerName);
    dockerId = result.dockerId;
    hostPort = result.hostPort;
    wgConfigName = result.wgConfigName;
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
        wgConfigName,
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
 * POST /api/managed-containers/:id/screenshot
 * Proxies a screenshot request to the managed container's /screenshot endpoint.
 * The container fetches the URL through WireGuard and returns image/png bytes,
 * which this route streams back to the caller untouched. Validates the URL on
 * the host before contacting the container so obvious bad input doesn't waste
 * a Playwright launch.
 * @param {number} req.params.id - The managed container id
 * @param {string} req.body.url - The URL to screenshot through the container
 * @returns {Buffer} 200 - image/png bytes of the rendered page
 * @returns {object} 400 - Invalid id or missing/invalid URL
 * @returns {object} 404 - Managed container not found
 * @returns {object} 503 - Container unreachable or upstream capture failed
 */
router.post("/:id/screenshot", async (req: Request, res: Response) => {
  const record = await loadManagedContainerOrSend404(req, res);
  if (record === null) {
    return;
  }

  const requestBody = req.body as { url?: unknown; useProxy?: unknown } | undefined;
  const rawUrl = requestBody?.url;
  const isInvalidUrl = typeof rawUrl !== "string" || rawUrl.length === 0;
  if (isInvalidUrl) {
    res.status(400).json({ error: "Request body must include a non-empty 'url' string" });
    return;
  }
  const targetUrl = rawUrl;
  const useProxy = requestBody?.useProxy === true;

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), SCREENSHOT_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(`http://127.0.0.1:${String(record.hostPort)}/screenshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl, useProxy }),
      signal: abortController.signal,
    });

    const isUpstreamOk = upstreamResponse.ok;
    if (!isUpstreamOk) {
      const upstreamErrorMessage = await readUpstreamErrorMessage(upstreamResponse);
      res.status(503).json({ error: `Container screenshot failed: ${upstreamErrorMessage}` });
      return;
    }

    const pngArrayBuffer = await upstreamResponse.arrayBuffer();
    res.setHeader("Content-Type", "image/png");
    res.send(Buffer.from(pngArrayBuffer));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[managed-containers] Screenshot proxy failed for container ${String(record.id)}: ${errorMessage}`);
    res.status(503).json({ error: `Container unreachable: ${errorMessage}` });
  } finally {
    clearTimeout(timeoutHandle);
  }
});

/**
 * POST /api/managed-containers/:id/analyze
 * Proxies an analyze request to the managed container's /analyze endpoint.
 * The container runs a Claude tool-calling agent that dismisses popups,
 * inspects the page, and reports whether the URL is a job description page,
 * along with a final screenshot (base64). Streams the JSON body back to the caller.
 * @param {number} req.params.id - The managed container id
 * @param {string} req.body.url - The URL to analyze
 * @returns {object} 200 - { is_job_description, apply_button_present, description_signals, reasoning, screenshot_b64 }
 * @returns {object} 400 - Invalid id or missing/invalid URL
 * @returns {object} 404 - Managed container not found
 * @returns {object} 503 - Container unreachable or upstream agent failed
 */
router.post("/:id/analyze", async (req: Request, res: Response) => {
  const record = await loadManagedContainerOrSend404(req, res);
  if (record === null) {
    return;
  }

  const requestBody = req.body as { url?: unknown; useProxy?: unknown } | undefined;
  const rawUrl = requestBody?.url;
  const isInvalidUrl = typeof rawUrl !== "string" || rawUrl.length === 0;
  if (isInvalidUrl) {
    res.status(400).json({ error: "Request body must include a non-empty 'url' string" });
    return;
  }
  const targetUrl = rawUrl;
  const useProxy = requestBody?.useProxy === true;

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), ANALYZE_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(`http://127.0.0.1:${String(record.hostPort)}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl, useProxy }),
      signal: abortController.signal,
    });

    const isUpstreamOk = upstreamResponse.ok;
    if (!isUpstreamOk) {
      const upstreamErrorMessage = await readUpstreamErrorMessage(upstreamResponse);
      res.status(503).json({ error: `Container analyze failed: ${upstreamErrorMessage}` });
      return;
    }

    const upstreamBody = await upstreamResponse.json();
    res.json(upstreamBody);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[managed-containers] Analyze proxy failed for container ${String(record.id)}: ${errorMessage}`);
    res.status(503).json({ error: `Container unreachable: ${errorMessage}` });
  } finally {
    clearTimeout(timeoutHandle);
  }
});

/**
 * The whatwg/fetch Response type, aliased to avoid the name collision with
 * Express's Response type that's already in scope in this file.
 */
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

/**
 * Reads an `error` field from a non-OK upstream response, falling back to the HTTP status text.
 * Used so the host's 503 response can include the underlying Playwright/WG failure message.
 * @param {FetchResponse} upstreamResponse - The non-OK fetch Response from the container
 * @returns {Promise<string>} The extracted error message, or the status text if the body wasn't parseable
 */
async function readUpstreamErrorMessage(upstreamResponse: FetchResponse): Promise<string> {
  try {
    const errorBody = await upstreamResponse.json() as { error?: unknown };
    const hasErrorString = typeof errorBody.error === "string" && errorBody.error.length > 0;
    if (hasErrorString) {
      return errorBody.error as string;
    }
  } catch {
    /* upstream returned non-JSON or empty body — fall through to status text */
  }
  return `${String(upstreamResponse.status)} ${upstreamResponse.statusText}`;
}

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
