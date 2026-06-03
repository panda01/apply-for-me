/**
 * Shared multipart/PDF-upload helpers for the application-profile file routes
 * (resume / cover-letter upload) and the stateless resume-extract route.
 *
 * Two layers of PDF enforcement:
 *   1. multer fileFilter rejects anything whose declared mimetype isn't
 *      application/pdf before the body is fully buffered (cheap early-out).
 *   2. isPdfBuffer() checks the actual file signature ("%PDF-") because a
 *      client can spoof the mimetype — the magic-byte check is the real gate.
 *
 * Uploads are held in memory (not written to disk) because every consumer
 * either streams the buffer straight to GCS or straight to Claude.
 */

import multer from "multer";
import type { Request, Response } from "express";

/** Maximum accepted upload size (10 MB). Resumes/cover letters are far smaller. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** The multipart form field name every upload route expects the file under. */
export const PDF_FORM_FIELD = "file";

/**
 * Configured multer instance: in-memory storage, 10 MB cap, and a fileFilter
 * that rejects non-PDF mimetypes up front. Use as route middleware via
 * `pdfUpload.single(PDF_FORM_FIELD)`.
 */
export const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter: (_req, file, callback) => {
    const isPdfMimetype = file.mimetype === "application/pdf";
    if (!isPdfMimetype) {
      callback(new Error("Only PDF files are allowed"));
      return;
    }
    callback(null, true);
  },
});

/**
 * Runs `pdfUpload.single(PDF_FORM_FIELD)` as a promise so route handlers can
 * `await` it without an Express error-middleware. On a multer error (wrong
 * mimetype, oversize file, malformed multipart) it writes a 400 JSON response
 * and resolves false; on success it resolves true with `req.file` populated.
 * @param {Request} req - The incoming request (mutated with req.file on success)
 * @param {Response} res - The response (used to write 400 on upload failure)
 * @returns {Promise<boolean>} True when a file was accepted; false when a 400 was already sent
 */
export function runSinglePdfUpload(req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = pdfUpload.single(PDF_FORM_FIELD);
    handler(req, res, (err: unknown) => {
      const hasError = err !== undefined && err !== null;
      if (hasError) {
        const isTooLarge = (err as { code?: string }).code === "LIMIT_FILE_SIZE";
        const message = isTooLarge
          ? `File exceeds the ${String(MAX_PDF_BYTES)}-byte (10 MB) limit`
          : err instanceof Error ? err.message : "File upload failed";
        res.status(400).json({ error: message });
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

/**
 * Verifies a buffer actually begins with the PDF file signature ("%PDF-").
 * The authoritative check — mimetype alone is client-controlled and spoofable.
 * @param {Buffer} buffer - The uploaded file bytes
 * @returns {boolean} True when the buffer starts with the PDF magic bytes
 */
export function isPdfBuffer(buffer: Buffer): boolean {
  const PDF_SIGNATURE = "%PDF-";
  const hasEnoughBytes = buffer.length >= PDF_SIGNATURE.length;
  if (!hasEnoughBytes) {
    return false;
  }
  return buffer.subarray(0, PDF_SIGNATURE.length).toString("latin1") === PDF_SIGNATURE;
}
