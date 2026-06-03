/**
 * Routes for uploading, downloading, and deleting an ApplicationProfile's
 * resume / cover-letter PDFs. Files are stored in Google Cloud Storage via
 * gcsStorageService; the profile row holds the object key + original filename.
 *
 * Mounted under /api/application-profiles (see app.ts), alongside the CRUD
 * router. Endpoints:
 *   - POST   /:id/files        (multipart: file=<pdf>, kind=resume|coverLetter)
 *   - DELETE /:id/files/:kind  (kind=resume|coverLetter)
 *   - GET    /:id/files/:kind  → { url } short-lived signed download URL
 */

import { Router, Request, Response } from "express";
import prisma from "../prismaClient.js";
import { parseIdParam } from "./_helpers.js";
import { runSinglePdfUpload, isPdfBuffer } from "./_pdfUpload.js";
import {
  buildResumeKey,
  buildCoverLetterKey,
  uploadPdf,
  getSignedReadUrl,
  deleteObject,
} from "../services/gcsStorageService.js";

const router = Router();

/**
 * The two kinds of document an ApplicationProfile can store. A "kind" string
 * arriving from a request (route param or multipart field) is validated against
 * these values before it is trusted to pick a column pair / key builder.
 */
const FILE_KIND_VALUES = ["resume", "coverLetter"] as const;

type FileKind = (typeof FILE_KIND_VALUES)[number];

/**
 * Describes how a given file kind maps onto the ApplicationProfile row: which
 * columns hold its stored object key and original filename, and which builder
 * produces a fresh collision-proof object key for it.
 */
interface FileKindConfig {
  /** Human-readable kind label, reused verbatim in error messages. */
  kind: FileKind;
  /** Column holding the GCS object key for this kind. */
  storageKeyColumn: "resumeStorageKey" | "coverLetterStorageKey";
  /** Column holding the original (display) filename for this kind. */
  fileNameColumn: "resumeFileName" | "coverLetterFileName";
  /**
   * Builds a fresh GCS object key for this kind given the owning profile id.
   * @param {number} profileId - The owning ApplicationProfile id
   * @returns {string} The new object key
   */
  buildObjectKey: (profileId: number) => string;
}

/**
 * Validates/normalizes a raw "kind" string and returns its column mapping and
 * key builder. Returns null for anything that is not a recognized file kind so
 * the caller can respond with a 400.
 * @param {unknown} rawKind - The kind value from a route param or form field
 * @returns {FileKindConfig | null} The resolved config, or null when invalid
 */
function resolveFileKind(rawKind: unknown): FileKindConfig | null {
  const isKnownKind = typeof rawKind === "string" && (FILE_KIND_VALUES as readonly string[]).includes(rawKind);
  if (!isKnownKind) {
    return null;
  }
  const kind = rawKind as FileKind;
  if (kind === "resume") {
    return {
      kind: "resume",
      storageKeyColumn: "resumeStorageKey",
      fileNameColumn: "resumeFileName",
      buildObjectKey: buildResumeKey,
    };
  }
  return {
    kind: "coverLetter",
    storageKeyColumn: "coverLetterStorageKey",
    fileNameColumn: "coverLetterFileName",
    buildObjectKey: buildCoverLetterKey,
  };
}

/**
 * Parses the :id param and looks up the profile, writing 400/404 responses for
 * missing or invalid ids. Returns the record on success, or null when a
 * response has already been written. Mirrors findApplicationProfileOrSend404 in
 * applicationProfiles.ts (kept local because that helper is not exported).
 * @param {Request} req - The incoming request
 * @param {Response} res - The response (used to write 400/404 on error)
 * @returns {Promise<Awaited<ReturnType<typeof prisma.applicationProfile.findUnique>> | null>} The profile or null
 */
async function findApplicationProfileOrSend404(
  req: Request,
  res: Response
): Promise<Awaited<ReturnType<typeof prisma.applicationProfile.findUnique>> | null> {
  const id = parseIdParam(req, res);
  if (id === null) {
    return null;
  }
  const profile = await prisma.applicationProfile.findUnique({ where: { id } });
  if (profile === null) {
    res.status(404).json({ error: "Application profile not found" });
    return null;
  }
  return profile;
}

/**
 * POST /api/application-profiles/:id/files
 * Uploads (or replaces) a profile's resume or cover-letter PDF. The PDF is
 * stored in GCS and the profile row is updated with the new object key and
 * original filename. Any previously stored file for that kind is best-effort
 * deleted so it is not orphaned.
 * @param {number} req.params.id - The owning profile id
 * @param {string} req.body.kind - Which document: "resume" or "coverLetter" (multipart text field)
 * @param {File} req.file - The uploaded PDF under the multipart field "file"
 * @returns {object} 200 - The full updated profile record
 * @returns {object} 400 - Upload failed, invalid id/kind, missing file, or non-PDF content
 * @returns {object} 404 - Profile not found
 */
router.post("/:id/files", async (req: Request, res: Response) => {
  // Run multer first: it parses the multipart body so req.body.kind and
  // req.file become available. On failure it has already sent a 400.
  const uploadSucceeded = await runSinglePdfUpload(req, res);
  if (!uploadSucceeded) {
    return;
  }

  const fileKindConfig = resolveFileKind(req.body.kind);
  const isInvalidKind = fileKindConfig === null;
  if (isInvalidKind) {
    res.status(400).json({ error: `kind must be one of: ${FILE_KIND_VALUES.join(", ")}` });
    return;
  }

  const profile = await findApplicationProfileOrSend404(req, res);
  if (profile === null) {
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "A PDF file is required" });
    return;
  }

  const hasValidPdfSignature = isPdfBuffer(req.file.buffer);
  if (!hasValidPdfSignature) {
    res.status(400).json({ error: "Uploaded file is not a valid PDF" });
    return;
  }

  const newObjectKey = fileKindConfig.buildObjectKey(profile.id);
  await uploadPdf(newObjectKey, req.file.buffer);

  // Best-effort cleanup of the prior file for this kind so we don't orphan it.
  // deleteObject is safe even if the prior object is already gone.
  const previousObjectKey = profile[fileKindConfig.storageKeyColumn];
  const hasPreviousFile = previousObjectKey !== null && previousObjectKey !== undefined;
  if (hasPreviousFile) {
    await deleteObject(previousObjectKey);
  }

  const updatedProfile = await prisma.applicationProfile.update({
    where: { id: profile.id },
    data: {
      [fileKindConfig.storageKeyColumn]: newObjectKey,
      [fileKindConfig.fileNameColumn]: req.file.originalname,
    },
  });
  res.json(updatedProfile);
});

/**
 * DELETE /api/application-profiles/:id/files/:kind
 * Removes a profile's stored resume or cover-letter. Deletes the GCS object (if
 * present) and clears both the storage-key and filename columns for that kind.
 * @param {number} req.params.id - The owning profile id
 * @param {string} req.params.kind - Which document: "resume" or "coverLetter"
 * @returns {object} 200 - The updated profile record
 * @returns {object} 400 - Invalid id or kind
 * @returns {object} 404 - Profile not found
 */
router.delete("/:id/files/:kind", async (req: Request, res: Response) => {
  const fileKindConfig = resolveFileKind(req.params.kind);
  const isInvalidKind = fileKindConfig === null;
  if (isInvalidKind) {
    res.status(400).json({ error: `kind must be one of: ${FILE_KIND_VALUES.join(", ")}` });
    return;
  }

  const profile = await findApplicationProfileOrSend404(req, res);
  if (profile === null) {
    return;
  }

  const storedObjectKey = profile[fileKindConfig.storageKeyColumn];
  const hasStoredFile = storedObjectKey !== null && storedObjectKey !== undefined;
  if (hasStoredFile) {
    await deleteObject(storedObjectKey);
  }

  const updatedProfile = await prisma.applicationProfile.update({
    where: { id: profile.id },
    data: {
      [fileKindConfig.storageKeyColumn]: null,
      [fileKindConfig.fileNameColumn]: null,
    },
  });
  res.json(updatedProfile);
});

/**
 * GET /api/application-profiles/:id/files/:kind
 * Returns a short-lived V4 signed download URL for a profile's stored resume or
 * cover-letter. The URL is generated on demand and never persisted.
 * @param {number} req.params.id - The owning profile id
 * @param {string} req.params.kind - Which document: "resume" or "coverLetter"
 * @returns {object} 200 - { url } a short-lived signed read URL
 * @returns {object} 400 - Invalid id or kind
 * @returns {object} 404 - Profile not found, or no file of that kind uploaded
 */
router.get("/:id/files/:kind", async (req: Request, res: Response) => {
  const fileKindConfig = resolveFileKind(req.params.kind);
  const isInvalidKind = fileKindConfig === null;
  if (isInvalidKind) {
    res.status(400).json({ error: `kind must be one of: ${FILE_KIND_VALUES.join(", ")}` });
    return;
  }

  const profile = await findApplicationProfileOrSend404(req, res);
  if (profile === null) {
    return;
  }

  const storedObjectKey = profile[fileKindConfig.storageKeyColumn];
  const hasStoredFile = storedObjectKey !== null && storedObjectKey !== undefined;
  if (!hasStoredFile) {
    res.status(404).json({ error: `No ${fileKindConfig.kind} file uploaded for this profile` });
    return;
  }

  const url = await getSignedReadUrl(storedObjectKey);
  res.json({ url });
});

export { router as applicationProfileFilesRouter };
