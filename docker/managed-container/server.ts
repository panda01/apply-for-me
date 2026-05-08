import express, { Request, Response } from "express";

const PORT = 3000;
const containerName = process.env.CONTAINER_NAME ?? "unknown";

const app = express();

/**
 * GET /health
 * Health check endpoint for the managed container.
 * @returns {object} 200 - { status: "ok", name: <CONTAINER_NAME> }
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", name: containerName });
});

/**
 * GET /name
 * Returns the configured container name.
 * @returns {object} 200 - { name: <CONTAINER_NAME> }
 */
app.get("/name", (_req: Request, res: Response) => {
  res.json({ name: containerName });
});

app.listen(PORT, () => {
  console.log(`Managed container "${containerName}" listening on port ${String(PORT)}`);
});
