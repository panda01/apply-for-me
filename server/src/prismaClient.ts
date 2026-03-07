import { PrismaClient } from "../prisma/generated/client/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

/**
 * Singleton Prisma client instance for database access.
 * Uses better-sqlite3 adapter for SQLite connectivity.
 * Reuses the same connection across the application to avoid
 * creating multiple database connections.
 */
const adapter = new PrismaBetterSqlite3({
  url: process.env["DATABASE_URL"] ?? "file:./prisma/dev.db",
});

const prisma = new PrismaClient({ adapter });

export default prisma;
