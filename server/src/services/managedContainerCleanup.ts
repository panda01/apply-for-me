import prisma from "../prismaClient.js";
import { stopAndRemove } from "./dockerContainerService.js";

/**
 * Stops + removes every Docker container tracked in the managed_containers
 * table, then deletes the corresponding rows so the DB matches reality after
 * the server exits. Used by the SIGINT/SIGTERM handlers in index.ts to make
 * sure containers don't outlive the process that spawned them.
 *
 * Failures for individual containers are logged and swallowed — best-effort
 * cleanup is preferable to bailing on the first error and leaving the rest
 * orphaned. Per-container work runs in parallel so total shutdown time is
 * bounded by the slowest container, not the sum.
 *
 * @returns {Promise<void>} Resolves once every record has been processed
 */
export async function cleanupAllManagedContainers(): Promise<void> {
  const records = await prisma.managedContainer.findMany();
  const hasNoRecords = records.length === 0;
  if (hasNoRecords) {
    return;
  }
  console.log(`[shutdown] Cleaning up ${String(records.length)} managed container(s)`);

  await Promise.all(records.map(async (record) => {
    try {
      await stopAndRemove(record.dockerId);
    } catch (err) {
      const dockerErrorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[shutdown] Failed to stop/remove container ${record.dockerId} (${record.name}): ${dockerErrorMessage}`);
      // Don't delete the DB row if we couldn't actually remove the docker container —
      // it may still be running and a future operator will want to find/clean it.
      return;
    }
    try {
      await prisma.managedContainer.delete({ where: { id: record.id } });
    } catch (err) {
      const dbErrorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[shutdown] Failed to delete DB row for ${record.name}: ${dbErrorMessage}`);
    }
  }));
}
