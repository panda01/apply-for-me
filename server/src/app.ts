import express, { Request, Response } from "express";
import { jobListingsRouter } from "./routes/jobListings.js";

const app = express();

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use("/api/job-listings", jobListingsRouter);

export { app };
