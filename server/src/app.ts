import express, { Request, Response } from "express";
import { jobListingsRouter } from "./routes/jobListings.js";
import { jobApplicationsRouter } from "./routes/jobApplications.js";
import { managedContainersRouter } from "./routes/managedContainers.js";
import { applicationProfilesRouter } from "./routes/applicationProfiles.js";
import { applicationProfileFilesRouter } from "./routes/applicationProfileFiles.js";
import { gmailRouter, gmailOAuthCallbackHandler } from "./routes/gmail.js";
import { inboxRouter } from "./routes/inbox.js";

const app = express();

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use("/api/job-listings", jobListingsRouter);
app.use("/api/job-listings", jobApplicationsRouter);
app.use("/api/managed-containers", managedContainersRouter);
app.use("/api/application-profiles", applicationProfilesRouter);
app.use("/api/application-profiles", applicationProfileFilesRouter);
app.use("/api/gmail", gmailRouter);
// The OAuth callback path is dictated by GMAIL_OAUTH_REDIRECT_URI / the
// Authorized redirect URI in GCP Console. Currently /api/oauth/gmail.
app.get("/api/oauth/gmail", gmailOAuthCallbackHandler);
app.use("/api/inbox", inboxRouter);

export { app };
