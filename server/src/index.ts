import "dotenv/config";
import { app } from "./app.js";
import prisma from "./prismaClient.js";

const serverPort = process.env["SERVER_PORT"];
const isMissingServerPort = !serverPort;
if (isMissingServerPort) {
  console.error("SERVER_PORT environment variable is not set. Add it to your .env file.");
  process.exit(1);
}
const PORT = parseInt(serverPort, 10);

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

verifyDatabaseConnection().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
