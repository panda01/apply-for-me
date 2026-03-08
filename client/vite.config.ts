import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { config } from "dotenv";
import { resolve } from "path";

/**
 * Load environment variables from the project root .env file.
 * process.cwd() is always the project root since npm scripts run from there.
 */
config({ path: resolve(process.cwd(), ".env") });

const clientPort = process.env["CLIENT_PORT"];
const serverPort = process.env["SERVER_PORT"];

const isMissingClientPort = !clientPort;
if (isMissingClientPort) {
  throw new Error("CLIENT_PORT environment variable is not set. Add it to your .env file.");
}

const isMissingServerPort = !serverPort;
if (isMissingServerPort) {
  throw new Error("SERVER_PORT environment variable is not set. Add it to your .env file.");
}

export default defineConfig({
  plugins: [react()],
  root: "client",
  server: {
    port: parseInt(clientPort, 10),
    proxy: {
      "/api": {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
});
