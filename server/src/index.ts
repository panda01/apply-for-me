import "dotenv/config";
import type { Server } from "node:http";
import { app } from "./app.js";
import prisma from "./prismaClient.js";
import { cleanupAllManagedContainers } from "./services/managedContainerCleanup.js";
import { markStaleRunningAsFailed } from "./services/gmailSyncSessionService.js";

const serverPort = process.env["SERVER_PORT"];
const isMissingServerPort = !serverPort;
if (isMissingServerPort) {
  console.error("SERVER_PORT environment variable is not set. Add it to your .env file.");
  process.exit(1);
}
const PORT = parseInt(serverPort, 10);

/**
 * Hard upper bound on graceful shutdown. If cleanup hasn't finished by then
 * (e.g. Docker daemon is unresponsive) we give up and exit non-zero so the
 * process supervisor can restart us instead of hanging forever.
 */
const SHUTDOWN_TIMEOUT_MS = 30000;

let isShuttingDown = false;

/**
 * Verifies the database connection by running a simple query.
 * Logs an error and exits with code 1 if the connection fails.
 */
async function verifyDatabaseConnection(): Promise<void> {
  try {
    await prisma.jobListing.findFirst();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Failed to connect to the database: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Closes the HTTP server, stops + removes every managed Docker container we
 * spawned (so they don't outlive this process), disconnects prisma, and
 * exits. Re-entry via repeated signals is a no-op.
 * @param {Server} httpServer - The express http server to close
 * @param {string} signal - The signal that triggered shutdown (for logging)
 */
async function gracefulShutdown(httpServer: Server, signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`[shutdown] Received ${signal}, shutting down gracefully`);

  const forceExitTimeout = setTimeout(() => {
    console.error(`[shutdown] Cleanup did not finish within ${String(SHUTDOWN_TIMEOUT_MS)}ms — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimeout.unref();

  await new Promise<void>((resolveClose) => {
    httpServer.close(() => resolveClose());
  });

  await cleanupAllManagedContainers().catch((err: unknown) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[shutdown] Cleanup error: ${errorMessage}`);
  });

  await prisma.$disconnect().catch(() => {
    /* prisma may already be disconnected — exit anyway */
  });

  clearTimeout(forceExitTimeout);
  console.log("[shutdown] Done");
  process.exit(0);
}

verifyDatabaseConnection().then(async () => {
  // Reconcile any GmailSyncSession rows that were left in `running` because
  // the previous process died mid-scan. Runs BEFORE app.listen so the very
  // first /api/inbox/scan/active request after boot is already consistent.
  await markStaleRunningAsFailed();

  const httpServer = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  process.on("SIGINT", () => { void gracefulShutdown(httpServer, "SIGINT"); });
  process.on("SIGTERM", () => { void gracefulShutdown(httpServer, "SIGTERM"); });
});
