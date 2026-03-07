import { Router, Request, Response } from "express";
import prisma from "../prismaClient.js";

const router = Router();

/**
 * POST /api/job-listings
 * Creates a new job listing in the database.
 * @param {string} req.body.title - The job title
 * @param {string} req.body.url - The URL of the job posting
 * @param {string} req.body.description - The job description
 * @param {string} req.body.post_date - The date the job was posted (ISO 8601)
 * @returns {object} 201 - The created job listing
 * @returns {object} 400 - Missing required fields error
 */
router.post("/", async (req: Request, res: Response) => {
  const { title, url, description, post_date } = req.body;

  const isMissingRequiredFields = !title || !url || !description || !post_date;
  if (isMissingRequiredFields) {
    res.status(400).json({ error: "Missing required fields: title, url, description, and post_date are all required" });
    return;
  }

  const jobListing = await prisma.jobListing.create({
    data: {
      title,
      url,
      description,
      post_date: new Date(post_date),
    },
  });

  res.status(201).json(jobListing);
});

/**
 * GET /api/job-listings
 * Retrieves all job listings from the database, ordered by created_date descending.
 * @returns {object[]} 200 - Array of all job listings
 */
router.get("/", async (_req: Request, res: Response) => {
  const jobListings = await prisma.jobListing.findMany({
    orderBy: { created_date: "desc" },
  });

  res.json(jobListings);
});

/**
 * GET /api/job-listings/:id
 * Retrieves a single job listing by its ID.
 * @param {number} req.params.id - The ID of the job listing
 * @returns {object} 200 - The job listing
 * @returns {object} 404 - Job listing not found error
 */
router.get("/:id", async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const isArrayParam = Array.isArray(rawId);
  if (isArrayParam) {
    res.status(400).json({ error: "Invalid id parameter" });
    return;
  }

  const id = parseInt(rawId, 10);

  const isInvalidId = isNaN(id);
  if (isInvalidId) {
    res.status(400).json({ error: "Invalid id parameter" });
    return;
  }

  const jobListing = await prisma.jobListing.findUnique({
    where: { id },
  });

  const isNotFound = !jobListing;
  if (isNotFound) {
    res.status(404).json({ error: "Job listing not found" });
    return;
  }

  res.json(jobListing);
});

/**
 * DELETE /api/job-listings/:id
 * Deletes a job listing by its ID.
 * @param {number} req.params.id - The ID of the job listing to delete
 * @returns {object} 200 - The deleted job listing
 * @returns {object} 404 - Job listing not found error
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const isArrayParam = Array.isArray(rawId);
  if (isArrayParam) {
    res.status(400).json({ error: "Invalid id parameter" });
    return;
  }

  const id = parseInt(rawId, 10);

  const isInvalidId = isNaN(id);
  if (isInvalidId) {
    res.status(400).json({ error: "Invalid id parameter" });
    return;
  }

  const existingJobListing = await prisma.jobListing.findUnique({
    where: { id },
  });

  const isNotFound = !existingJobListing;
  if (isNotFound) {
    res.status(404).json({ error: "Job listing not found" });
    return;
  }

  const deletedJobListing = await prisma.jobListing.delete({
    where: { id },
  });

  res.json(deletedJobListing);
});

export { router as jobListingsRouter };
