/**
 * Prisma seed script. Runs:
 *   - automatically after `npm run db:push` (see package.json), so every schema
 *     push restores any custom raw-SQL indexes Prisma's @@unique can't express
 *   - on demand via `npx prisma db seed`
 *
 * Today's only responsibility is to (re-)apply the case-insensitive,
 * null-collapsing dedup index on `discovered_jobs`. Prisma's SQLite driver
 * does not expose `COLLATE NOCASE` or `COALESCE(col, '')` inside a
 * `@@unique([...])`, so we drop whatever index Prisma's most recent `db push`
 * created under the canonical `discovered_jobs_dedupe_key` name and recreate
 * it with the custom expressions. This is idempotent — re-running the seed
 * always leaves the DB in the same state.
 *
 * If you need to add more raw-SQL indexes (or other post-push fixups) in the
 * future, append them to `applyCustomIndexes` below so a single
 * `db push` + seed pass restores the full intended schema.
 */

import { PrismaClient } from "./generated/client/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/**
 * Builds the singleton Prisma client used by the seed script. Reads
 * `DATABASE_URL` exactly the way the server's runtime client does so the seed
 * always operates against the same database the dev server boots into.
 *
 * @returns {PrismaClient} A connected Prisma client backed by better-sqlite3
 * @throws {Error} When `DATABASE_URL` is not set in the environment
 */
function createSeedPrismaClient(): PrismaClient {
  const databaseUrl = process.env["DATABASE_URL"];
  const isMissingDatabaseUrl = !databaseUrl;
  if (isMissingDatabaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
}

/**
 * Drops + recreates every custom raw-SQL index the @@unique / @@index Prisma
 * directives cannot express. Currently only `discovered_jobs_dedupe_key`,
 * which needs `COLLATE NOCASE` on the (company, title, location) part and
 * `COALESCE(location, '')` so NULL locations collapse to a single slot rather
 * than inserting duplicates.
 *
 * Both statements run in a transaction so a partial failure can't leave the
 * DB in a half-indexed state. Safe to re-run — `DROP INDEX IF EXISTS` makes
 * the operation idempotent.
 *
 * @param {PrismaClient} prisma - The connected Prisma client
 * @returns {Promise<void>}
 */
async function applyCustomIndexes(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "discovered_jobs_dedupe_key"`),
    prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "discovered_jobs_dedupe_key" ` +
        `ON "discovered_jobs" (` +
        `"gmail_message_id", ` +
        `"company" COLLATE NOCASE, ` +
        `"title" COLLATE NOCASE, ` +
        `COALESCE("location", '') COLLATE NOCASE` +
        `)`
    ),
  ]);
}

/**
 * Seed entry point. Applies every fixup the schema-pusher can't express on
 * its own, then disconnects. Logs each step so a `db push` + seed flow leaves
 * an audit trail in stdout.
 *
 * @returns {Promise<void>}
 */
async function runSeed(): Promise<void> {
  const prisma = createSeedPrismaClient();
  try {
    process.stdout.write("[prisma-seed] applying custom raw-SQL indexes\n");
    await applyCustomIndexes(prisma);
    process.stdout.write(
      "[prisma-seed] discovered_jobs_dedupe_key recreated with COLLATE NOCASE + COALESCE\n"
    );
  } finally {
    await prisma.$disconnect();
  }
}

runSeed().catch((err: unknown) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[prisma-seed] failed: ${errorMessage}\n`);
  process.exit(1);
});
