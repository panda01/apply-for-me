import prisma from "../prismaClient.js";
import { stopAndRemove, listContainerIdsForAfmImage } from "./dockerContainerService.js";

/**
 * The row shape of a record in the managed_containers table, inferred from
 * the prisma client so it stays in sync with the schema without taking on a
 * direct dependency on the generated model file paths.
 */
type ManagedContainerRow = NonNullable<Awaited<ReturnType<typeof prisma.managedContainer.findUnique>>>;

/**
 * The unified shutdown work set: every Docker ID that needs to be stopped and
 * removed, paired with the DB row that points at it (or null if the container
 * is an image-ancestor orphan that the DB does not know about).
 */
type ShutdownWorkSet = Map<string, ManagedContainerRow | null>;

/**
 * Merges DB-tracked managed containers with Docker IDs discovered by image
 * ancestor into a single map keyed by Docker ID. When a Docker ID appears in
 * both inputs the DB record wins so we still know to delete its row after
 * stop/remove succeeds. IDs that only appear in the image-list have a null
 * value, signalling "no DB row to delete after cleanup".
 *
 * Pulled out as a pure helper so the merge/dedup logic can be tested in
 * isolation without mocking Docker or Prisma.
 *
 * @param {ManagedContainerRow[]} dbRecords - Every row currently in the managed_containers table
 * @param {string[]} imageContainerIds - Docker IDs of every container built from the afm image
 * @returns {ShutdownWorkSet} Map of Docker ID → DB record (or null if image-only orphan)
 */
export function buildShutdownWorkSet(
  dbRecords: ManagedContainerRow[],
  imageContainerIds: string[]
): ShutdownWorkSet {
  const workSet: ShutdownWorkSet = new Map();
  for (const dockerId of imageContainerIds) {
    workSet.set(dockerId, null);
  }
  for (const record of dbRecords) {
    workSet.set(record.dockerId, record);
  }
  return workSet;
}

/**
 * Stops + removes every Docker container that this server should not outlive.
 * The work set is the union of (a) rows in the managed_containers table and
 * (b) any container on the host whose ancestor image is afm-managed-container:latest.
 * The image-ancestor sweep catches containers the DB does not know about —
 * e.g. an operator's `docker run`, a row deleted out of band, or a leftover
 * from a previous unclean exit.
 *
 * Called by the SIGINT/SIGTERM handlers in index.ts. Failures for individual
 * containers (and for the listing itself) are logged and swallowed — best-effort
 * cleanup is preferable to bailing on the first error and leaving the rest
 * orphaned. DB rows are deleted only when the matching stop/remove succeeded;
 * image-only orphans have no DB row to delete.
 *
 * @returns {Promise<void>} Resolves once every container in the work set has been processed
 */
export async function cleanupAllManagedContainers(): Promise<void> {
  const [dbRecordsResult, imageIdsResult] = await Promise.allSettled([
    prisma.managedContainer.findMany(),
    listContainerIdsForAfmImage(),
  ]);

  const dbRecords = extractDbRecords(dbRecordsResult);
  const imageContainerIds = extractImageContainerIds(imageIdsResult);

  const workSet = buildShutdownWorkSet(dbRecords, imageContainerIds);
  const hasNothingToClean = workSet.size === 0;
  if (hasNothingToClean) {
    return;
  }

  const databaseTrackedCount = countDatabaseTrackedEntries(workSet);
  const imageOnlyOrphanCount = workSet.size - databaseTrackedCount;
  console.log(
    `[shutdown] Cleaning up ${String(workSet.size)} managed container(s): `
    + `${String(databaseTrackedCount)} DB-tracked, `
    + `${String(imageOnlyOrphanCount)} image-only orphan(s)`
  );

  const cleanupPromises: Promise<void>[] = [];
  for (const [dockerId, dbRecord] of workSet) {
    cleanupPromises.push(stopRemoveAndForgetSingleContainer(dockerId, dbRecord));
  }
  await Promise.all(cleanupPromises);
}

/**
 * Extracts the DB rows from the Promise.allSettled result for prisma.findMany.
 * Logs and returns an empty array if the query failed so the image-ancestor
 * sweep can still proceed.
 *
 * @param {PromiseSettledResult<ManagedContainerRow[]>} result - Settled result of findMany
 * @returns {ManagedContainerRow[]} The DB rows, or [] if the query rejected
 */
function extractDbRecords(
  result: PromiseSettledResult<ManagedContainerRow[]>
): ManagedContainerRow[] {
  if (result.status === "fulfilled") {
    return result.value;
  }
  const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason);
  console.error(`[shutdown] Failed to read managed_containers from DB: ${errorMessage}`);
  return [];
}

/**
 * Extracts the Docker IDs from the Promise.allSettled result for the image
 * ancestor listing. Logs and returns an empty array if Docker rejected so the
 * DB-tracked sweep can still proceed.
 *
 * @param {PromiseSettledResult<string[]>} result - Settled result of listContainerIdsForAfmImage
 * @returns {string[]} The Docker IDs, or [] if the listing rejected
 */
function extractImageContainerIds(
  result: PromiseSettledResult<string[]>
): string[] {
  if (result.status === "fulfilled") {
    return result.value;
  }
  const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason);
  console.error(`[shutdown] Failed to list afm-image containers: ${errorMessage}`);
  return [];
}

/**
 * Counts how many entries in the work set are backed by a DB row, used only
 * for the shutdown log line. The remainder (workSet.size - this count) are
 * image-only orphans.
 *
 * @param {ShutdownWorkSet} workSet - The merged shutdown work set
 * @returns {number} Number of entries that have a non-null DB record
 */
function countDatabaseTrackedEntries(workSet: ShutdownWorkSet): number {
  let trackedCount = 0;
  for (const dbRecord of workSet.values()) {
    if (dbRecord !== null) {
      trackedCount += 1;
    }
  }
  return trackedCount;
}

/**
 * Stops and removes a single container, then deletes its DB row if one
 * existed and the stop/remove succeeded. Individual failures are logged and
 * swallowed — see cleanupAllManagedContainers for the overall best-effort
 * contract. When stop/remove fails the DB row is intentionally left alone so
 * a future operator can find and clean the leak.
 *
 * @param {string} dockerId - The full Docker container ID to stop and remove
 * @param {ManagedContainerRow | null} dbRecord - The matching DB row, or null for image-only orphans
 * @returns {Promise<void>} Resolves once this container's cleanup attempt is done
 */
async function stopRemoveAndForgetSingleContainer(
  dockerId: string,
  dbRecord: ManagedContainerRow | null
): Promise<void> {
  try {
    await stopAndRemove(dockerId);
  } catch (err) {
    const dockerErrorMessage = err instanceof Error ? err.message : String(err);
    const containerLabel = dbRecord !== null ? `${dockerId} (${dbRecord.name})` : `${dockerId} (image-only orphan)`;
    console.error(`[shutdown] Failed to stop/remove container ${containerLabel}: ${dockerErrorMessage}`);
    return;
  }

  const hasNoDatabaseRowToDelete = dbRecord === null;
  if (hasNoDatabaseRowToDelete) {
    return;
  }

  try {
    await prisma.managedContainer.delete({ where: { id: dbRecord.id } });
  } catch (err) {
    const dbErrorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[shutdown] Failed to delete DB row for ${dbRecord.name}: ${dbErrorMessage}`);
  }
}
