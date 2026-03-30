import express, { Request, Response } from "express";
import { jobListingsRouter } from "./routes/jobListings.js";
import { jobApplicationsRouter } from "./routes/jobApplications.js";

const app = express();

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use("/api/job-listings", jobListingsRouter);
app.use("/api/job-listings", jobApplicationsRouter);

export { app };
