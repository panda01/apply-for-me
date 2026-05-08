import { Request, Response } from "express";
import prisma from "../prismaClient.js";

/**
 * Shared helpers for Express routes that work with id-keyed records.
 * Centralizes the parse-id-or-400 and find-by-id-or-404 patterns.
 */

/**
 * Parses the :id route param into a positive integer. Sends a 400 response
 * when the param is missing or not a number; otherwise returns the id.
 * @param {Request} req - The incoming request
 * @param {Response} res - The response (used to write 400 on error)
 * @returns {number | null} The parsed id, or null when 400 has been written
 */
export function parseIdParam(req: Request, res: Response): number | null {
  const rawId = req.params.id;
  const id = typeof rawId === "string" ? parseInt(rawId, 10) : NaN;
  const isInvalidId = isNaN(id);
  if (isInvalidId) {
    res.status(400).json({ error: "Invalid id parameter" });
    return null;
  }
  return id;
}

/**
 * Parses the :id param and looks up the job listing, writing 400/404 responses
 * for missing or invalid ids. Returns the record on success, or null on error.
 * @param {Request} req - The incoming request
 * @param {Response} res - The response (used to write 400/404 on error)
 * @returns {Promise<Awaited<ReturnType<typeof prisma.jobListing.findUnique>> | null>} The record or null
 */
export async function findJobListingOrSend404(
  req: Request,
  res: Response
): Promise<Awaited<ReturnType<typeof prisma.jobListing.findUnique>> | null> {
  const id = parseIdParam(req, res);
  if (id === null) {
    return null;
  }
  const jobListing = await prisma.jobListing.findUnique({ where: { id } });
  if (jobListing === null) {
    res.status(404).json({ error: "Job listing not found" });
    return null;
  }
  return jobListing;
}
