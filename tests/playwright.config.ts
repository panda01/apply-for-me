import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
import { resolve } from "node:path";

/**
 * Load the project's .env so this config picks up the same CLIENT_PORT
 * that vite.config.ts uses. The Playwright config file lives in tests/, so
 * resolve relative to its parent directory.
 */
config({ path: resolve(__dirname, "..", ".env") });

const clientPort = process.env.CLIENT_PORT;
const isMissingClientPort = !clientPort;
if (isMissingClientPort) {
  throw new Error("CLIENT_PORT environment variable is not set. Add it to your .env file.");
}

const serverPort = process.env.SERVER_PORT;
const isMissingServerPort = !serverPort;
if (isMissingServerPort) {
  throw new Error("SERVER_PORT environment variable is not set. Add it to your .env file.");
}

const baseURL = `http://localhost:${clientPort}`;

export default defineConfig({
  testDir: "./playwright",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL,
    headless: true,
  },
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
