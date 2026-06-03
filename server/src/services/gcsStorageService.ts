/**
 * Google Cloud Storage service for resume / cover-letter PDFs.
 *
 * All uploaded application documents live in a single bucket
 * (GCS_BUCKET_NAME, currently "apply-for-me-storage" in project "kushiriki",
 * region us-east1) under two object-name prefixes:
 *   - resume/         — uploaded resumes
 *   - cover-letters/   — uploaded cover letters
 *
 * Files are renamed on upload to "<prefix>/<profileId>-<uuid>.pdf" so the
 * stored key never collides and never leaks the user's original filename into
 * the object path. The original filename is persisted separately on the
 * ApplicationProfile row for display/download.
 *
 * Auth: the @google-cloud/storage SDK reads the service-account key from the
 * GOOGLE_APPLICATION_CREDENTIALS env var automatically; this module only needs
 * the bucket name. A plain Google API key does NOT work for GCS authorized
 * operations — a service-account key is required.
 *
 * Read access for the Browser-Use cloud agent and the download endpoint is
 * granted via short-lived V4 signed URLs generated on demand — URLs are never
 * stored, so a leaked DB row cannot be used to fetch a document.
 */

import { Storage, type Bucket } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";

/** Object-name prefix ("folder") for uploaded resumes. */
export const RESUME_PREFIX = "resume";

/** Object-name prefix ("folder") for uploaded cover letters. */
export const COVER_LETTER_PREFIX = "cover-letters";

/** Default TTL for download signed URLs (15 minutes). */
export const DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000;

/**
 * TTL for signed URLs handed to the Browser-Use apply agent. Generous because a
 * single application run can take many minutes and the agent fetches the file
 * partway through. V4 signed URLs cap at 7 days; 24h comfortably covers a run.
 */
export const APPLY_URL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Lazily-constructed Storage + Bucket singleton. Construction is deferred so
 * importing this module never throws at load time when GCS isn't configured
 * (e.g. unit tests that mock this module entirely).
 */
let cachedBucket: Bucket | null = null;

/**
 * Returns the configured GCS bucket, constructing the client on first use.
 * @returns {Bucket} The bucket handle for GCS_BUCKET_NAME
 * @throws {Error} If GCS_BUCKET_NAME is not set in the environment
 */
function getBucket(): Bucket {
  if (cachedBucket !== null) {
    return cachedBucket;
  }
  const bucketName = process.env["GCS_BUCKET_NAME"];
  const isMissingBucket = bucketName === undefined || bucketName.length === 0;
  if (isMissingBucket) {
    throw new Error("GCS_BUCKET_NAME env var is not set. Add it to .env to enable resume/cover-letter uploads.");
  }
  // new Storage() picks up GOOGLE_APPLICATION_CREDENTIALS (service-account key)
  // and the project id from that key file automatically.
  const storage = new Storage();
  cachedBucket = storage.bucket(bucketName);
  return cachedBucket;
}

/**
 * Builds the GCS object key for a profile's resume. Renames the upload to a
 * collision-proof "resume/<profileId>-<uuid>.pdf".
 * @param {number} profileId - The owning ApplicationProfile id
 * @returns {string} The object key to store the resume under
 */
export function buildResumeKey(profileId: number): string {
  return `${RESUME_PREFIX}/${String(profileId)}-${randomUUID()}.pdf`;
}

/**
 * Builds the GCS object key for a profile's cover letter. Renames the upload to
 * a collision-proof "cover-letters/<profileId>-<uuid>.pdf".
 * @param {number} profileId - The owning ApplicationProfile id
 * @returns {string} The object key to store the cover letter under
 */
export function buildCoverLetterKey(profileId: number): string {
  return `${COVER_LETTER_PREFIX}/${String(profileId)}-${randomUUID()}.pdf`;
}

/**
 * Uploads a PDF buffer to GCS at the given object key, overwriting any existing
 * object with that key. Always sets the application/pdf content type.
 * @param {string} objectKey - The destination object key (from buildResumeKey/buildCoverLetterKey)
 * @param {Buffer} buffer - The PDF bytes to store
 * @returns {Promise<void>} Resolves when the upload completes
 */
export async function uploadPdf(objectKey: string, buffer: Buffer): Promise<void> {
  await getBucket().file(objectKey).save(buffer, {
    contentType: "application/pdf",
    resumable: false,
  });
}

/**
 * Downloads an object's bytes from GCS. Used by the resume extractor to read a
 * stored PDF back for LLM analysis.
 * @param {string} objectKey - The object key to download
 * @returns {Promise<Buffer>} The object's bytes
 * @throws {Error} If the object does not exist or the download fails
 */
export async function downloadObject(objectKey: string): Promise<Buffer> {
  const [contents] = await getBucket().file(objectKey).download();
  return contents;
}

/**
 * Generates a time-limited V4 signed read URL for an object. Used both for the
 * user-facing download endpoint and for handing the file to the Browser-Use
 * apply agent. URLs are never persisted.
 * @param {string} objectKey - The object key to sign
 * @param {number} [ttlMs=DOWNLOAD_URL_TTL_MS] - How long the URL stays valid, in milliseconds
 * @returns {Promise<string>} An https URL that grants temporary read access
 */
export async function getSignedReadUrl(
  objectKey: string,
  ttlMs: number = DOWNLOAD_URL_TTL_MS
): Promise<string> {
  const [url] = await getBucket().file(objectKey).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + ttlMs,
  });
  return url;
}

/**
 * Deletes an object from GCS. Safe to call for an object that no longer exists
 * (ignoreNotFound) so replace/clear flows don't fail on a missing prior file.
 * @param {string} objectKey - The object key to delete
 * @returns {Promise<void>} Resolves when the delete completes (or the object was already gone)
 */
export async function deleteObject(objectKey: string): Promise<void> {
  await getBucket().file(objectKey).delete({ ignoreNotFound: true });
}
