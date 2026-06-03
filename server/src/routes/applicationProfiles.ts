import { Router, Request, Response } from "express";
import { Prisma } from "../../prisma/generated/client/client.js";
import prisma from "../prismaClient.js";
import { parseIdParam } from "./_helpers.js";
import { runSinglePdfUpload, isPdfBuffer } from "./_pdfUpload.js";
import { extractProfileFromResume } from "../services/resumeProfileExtractorService.js";
import { deleteObject } from "../services/gcsStorageService.js";

const router = Router();

/**
 * Allowed values for ApplicationProfile.workAuthorization. Must stay
 * byte-identical to the Prisma enum in schema.prisma so request validation
 * and DB writes line up. We don't import the generated enum because the
 * generator only emits TypeScript types (not runtime values) for enums.
 */
const WORK_AUTHORIZATION_VALUES = [
  "us_citizen",
  "permanent_resident",
  "authorized_no_sponsorship_needed",
  "authorized_future_sponsorship_needed",
  "sponsorship_required",
] as const;

type WorkAuthorizationValue = (typeof WORK_AUTHORIZATION_VALUES)[number];

/**
 * Shape of the parsed and validated input for create/update. All optional
 * columns are represented as `string | null` so the caller can clear them by
 * passing null — handing `undefined` to Prisma update would leave the column
 * unchanged.
 */
interface ValidatedProfileInput {
  name: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string;
  phone: string;
  github: string | null;
  linkedin: string | null;
  website: string | null;
  workAuthorization: WorkAuthorizationValue | null;
  desiredSalaryMin: number | null;
}

/**
 * Validates a request body against the ApplicationProfile schema. Returns
 * a structured success or a list of human-readable error strings so the
 * route can respond with all problems at once rather than one at a time.
 *
 * @param {unknown} body - The raw JSON body received from the client
 * @returns {{ ok: true; data: ValidatedProfileInput } | { ok: false; errors: string[] }}
 *   Either the validated input or the list of validation failures
 */
function validateProfileBody(body: unknown): { ok: true; data: ValidatedProfileInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  // express.json() guarantees req.body is an object here — its strict-mode
  // default rejects primitive/null bodies upstream of this handler.
  const payload = body as Record<string, unknown>;

  const name = readNonEmptyString(payload, "name", errors);
  const firstName = readNonEmptyString(payload, "firstName", errors);
  const lastName = readNonEmptyString(payload, "lastName", errors);
  const email = readNonEmptyString(payload, "email", errors);
  const phone = readNonEmptyString(payload, "phone", errors);

  const hasEmail = typeof email === "string";
  const isInvalidEmailFormat = hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (isInvalidEmailFormat) {
    errors.push("email must be a valid email address");
  }

  const middleName = readOptionalString(payload, "middleName", errors);
  const github = readOptionalUrl(payload, "github", errors);
  const linkedin = readOptionalUrl(payload, "linkedin", errors);
  const website = readOptionalUrl(payload, "website", errors);

  const workAuthorization = readOptionalEnum(payload, "workAuthorization", WORK_AUTHORIZATION_VALUES, errors);
  const desiredSalaryMin = readOptionalPositiveInt(payload, "desiredSalaryMin", errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      name: name as string,
      firstName: firstName as string,
      middleName,
      lastName: lastName as string,
      email: email as string,
      phone: phone as string,
      github,
      linkedin,
      website,
      workAuthorization,
      desiredSalaryMin,
    },
  };
}

/**
 * Reads a required non-empty string field from the body. Pushes a descriptive
 * error into the errors array when missing or empty and returns null.
 * @param {Record<string, unknown>} payload - The parsed JSON body
 * @param {string} field - The field name to read
 * @param {string[]} errors - The mutable error list to push to on failure
 * @returns {string | null} The validated string, or null if validation failed
 */
function readNonEmptyString(
  payload: Record<string, unknown>,
  field: string,
  errors: string[]
): string | null {
  const value = payload[field];
  const isString = typeof value === "string";
  const hasContent = isString && value.trim().length > 0;
  if (!hasContent) {
    errors.push(`${field} is required and must be a non-empty string`);
    return null;
  }
  return value.trim();
}

/**
 * Reads an optional string field. Returns null when missing/null/empty.
 * Pushes an error and returns null when the field is present but not a string.
 * @param {Record<string, unknown>} payload - The parsed JSON body
 * @param {string} field - The field name to read
 * @param {string[]} errors - The mutable error list to push to on failure
 * @returns {string | null} The trimmed string, or null when omitted
 */
function readOptionalString(
  payload: Record<string, unknown>,
  field: string,
  errors: string[]
): string | null {
  const isOmitted = !(field in payload) || payload[field] === null || payload[field] === undefined;
  if (isOmitted) {
    return null;
  }
  const value = payload[field];
  const isString = typeof value === "string";
  if (!isString) {
    errors.push(`${field} must be a string when provided`);
    return null;
  }
  const trimmed = value.trim();
  const isEmpty = trimmed.length === 0;
  if (isEmpty) {
    return null;
  }
  return trimmed;
}

/**
 * Reads an optional URL field. Behaves like readOptionalString but also
 * verifies the string parses as a valid http(s) URL when present.
 * @param {Record<string, unknown>} payload - The parsed JSON body
 * @param {string} field - The field name to read
 * @param {string[]} errors - The mutable error list to push to on failure
 * @returns {string | null} The validated URL string, or null when omitted/invalid
 */
function readOptionalUrl(
  payload: Record<string, unknown>,
  field: string,
  errors: string[]
): string | null {
  const value = readOptionalString(payload, field, errors);
  if (value === null) {
    return null;
  }
  const isHttpUrl = /^https?:\/\//i.test(value) && URL.canParse(value);
  if (!isHttpUrl) {
    errors.push(`${field} must be a valid http(s) URL when provided`);
    return null;
  }
  return value;
}

/**
 * Reads an optional enum field. Validates the value against the supplied
 * list of allowed strings.
 * @param {Record<string, unknown>} payload - The parsed JSON body
 * @param {string} field - The field name to read
 * @param {readonly T[]} allowed - The allowed enum values
 * @param {string[]} errors - The mutable error list to push to on failure
 * @returns {T | null} The validated enum value, or null when omitted/invalid
 */
function readOptionalEnum<T extends string>(
  payload: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  errors: string[]
): T | null {
  const isOmitted = !(field in payload) || payload[field] === null || payload[field] === undefined;
  if (isOmitted) {
    return null;
  }
  const value = payload[field];
  const isString = typeof value === "string";
  const isAllowed = isString && (allowed as readonly string[]).includes(value);
  if (!isAllowed) {
    errors.push(`${field} must be one of: ${allowed.join(", ")}`);
    return null;
  }
  return value as T;
}

/**
 * Reads an optional positive integer field. Accepts numbers only (no string
 * coercion). Pushes an error when present but not a positive whole number.
 * @param {Record<string, unknown>} payload - The parsed JSON body
 * @param {string} field - The field name to read
 * @param {string[]} errors - The mutable error list to push to on failure
 * @returns {number | null} The validated integer, or null when omitted/invalid
 */
function readOptionalPositiveInt(
  payload: Record<string, unknown>,
  field: string,
  errors: string[]
): number | null {
  const isOmitted = !(field in payload) || payload[field] === null || payload[field] === undefined;
  if (isOmitted) {
    return null;
  }
  const value = payload[field];
  const isNumber = typeof value === "number" && Number.isFinite(value);
  const isPositiveInteger = isNumber && Number.isInteger(value) && value > 0;
  if (!isPositiveInteger) {
    errors.push(`${field} must be a positive integer when provided`);
    return null;
  }
  return value;
}

/**
 * GET /api/application-profiles
 * Lists every application profile, newest-first by created_date.
 * @returns {object[]} 200 - Array of application profile records
 */
router.get("/", async (_req: Request, res: Response) => {
  const profiles = await prisma.applicationProfile.findMany({
    orderBy: { created_date: "desc" },
  });
  res.json(profiles);
});

/**
 * GET /api/application-profiles/:id
 * Retrieves a single application profile by id.
 * @param {number} req.params.id - The profile id
 * @returns {object} 200 - The profile record
 * @returns {object} 400 - Invalid id parameter
 * @returns {object} 404 - Profile not found
 */
router.get("/:id", async (req: Request, res: Response) => {
  const profile = await findApplicationProfileOrSend404(req, res);
  if (profile === null) {
    return;
  }
  res.json(profile);
});

/**
 * POST /api/application-profiles
 * Creates a new application profile.
 * @param {string} req.body.name - Required user-facing label (must be unique)
 * @param {string} req.body.firstName - Required first name
 * @param {string} [req.body.middleName] - Optional middle name
 * @param {string} req.body.lastName - Required last name
 * @param {string} req.body.email - Required email
 * @param {string} req.body.phone - Required phone
 * @param {string} [req.body.github] - Optional GitHub URL
 * @param {string} [req.body.linkedin] - Optional LinkedIn URL
 * @param {string} [req.body.website] - Optional website URL
 * @param {string} [req.body.workAuthorization] - Optional WorkAuthorization enum value
 * @param {number} [req.body.desiredSalaryMin] - Optional minimum desired salary (USD whole dollars)
 * @returns {object} 201 - The created profile record
 * @returns {object} 400 - Validation failed (includes errors array)
 * @returns {object} 409 - A profile with that name already exists
 */
router.post("/", async (req: Request, res: Response) => {
  const validation = validateProfileBody(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: "Validation failed", errors: validation.errors });
    return;
  }

  try {
    const created = await prisma.applicationProfile.create({
      data: validation.data,
    });
    res.status(201).json(created);
  } catch (err) {
    const isUniqueViolation = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (isUniqueViolation) {
      res.status(409).json({ error: `A profile with name "${validation.data.name}" already exists` });
      return;
    }
    throw err;
  }
});

/**
 * POST /api/application-profiles/extract-resume
 * Stateless helper: accepts a resume PDF upload and returns the identity,
 * contact, and profile-link fields Claude extracts from it, so the client can
 * pre-fill a profile form. Does not persist anything. Expects a multipart
 * upload with the PDF under the "file" field.
 * @param {Express.Multer.File} req.file - The uploaded resume PDF (multipart "file" field)
 * @returns {object} 200 - { fields } where fields is the ResumeProfileFields object
 * @returns {object} 400 - No file provided, upload rejected, or file is not a valid PDF
 * @returns {object} 502 - The Claude extraction call failed
 */
router.post("/extract-resume", async (req: Request, res: Response) => {
  const ok = await runSinglePdfUpload(req, res);
  if (!ok) {
    // runSinglePdfUpload already wrote a 400 response on failure.
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "A PDF file is required" });
    return;
  }

  const fileBuffer = req.file.buffer;
  const isValidPdf = isPdfBuffer(fileBuffer);
  if (!isValidPdf) {
    res.status(400).json({ error: "Uploaded file is not a valid PDF" });
    return;
  }

  try {
    const fields = await extractProfileFromResume(fileBuffer);
    res.status(200).json({ fields });
  } catch (err) {
    console.error("Resume profile extraction failed:", err);
    const message = err instanceof Error ? err.message : "Resume profile extraction failed";
    res.status(502).json({ error: message });
  }
});

/**
 * PUT /api/application-profiles/:id
 * Replaces every field on an existing profile with the validated request body.
 * Optional fields not present in the body are cleared to null — pass the full
 * object you want to persist.
 * @param {number} req.params.id - The profile id
 * @param {object} req.body - The full profile body (see POST documentation)
 * @returns {object} 200 - The updated profile record
 * @returns {object} 400 - Validation failed (includes errors array)
 * @returns {object} 404 - Profile not found
 * @returns {object} 409 - A different profile already uses that name
 */
router.put("/:id", async (req: Request, res: Response) => {
  const existing = await findApplicationProfileOrSend404(req, res);
  if (existing === null) {
    return;
  }

  const validation = validateProfileBody(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: "Validation failed", errors: validation.errors });
    return;
  }

  try {
    const updated = await prisma.applicationProfile.update({
      where: { id: existing.id },
      data: validation.data,
    });
    res.json(updated);
  } catch (err) {
    const isUniqueViolation = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (isUniqueViolation) {
      res.status(409).json({ error: `A profile with name "${validation.data.name}" already exists` });
      return;
    }
    throw err;
  }
});

/**
 * DELETE /api/application-profiles/:id
 * Deletes an application profile by id. Any resume / cover-letter PDFs the
 * profile had stored in GCS are best-effort deleted first so they are not
 * orphaned in the bucket once their owning row is gone.
 * @param {number} req.params.id - The profile id
 * @returns {object} 200 - The deleted profile record
 * @returns {object} 400 - Invalid id parameter
 * @returns {object} 404 - Profile not found
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const existing = await findApplicationProfileOrSend404(req, res);
  if (existing === null) {
    return;
  }
  // Best-effort GCS cleanup before the row disappears. deleteObject is safe
  // even when the object is already gone, so a missing file never blocks the
  // profile delete.
  const storedObjectKeys = [existing.resumeStorageKey, existing.coverLetterStorageKey]
    .filter((key): key is string => key !== null);
  for (const objectKey of storedObjectKeys) {
    await deleteObject(objectKey);
  }
  const deleted = await prisma.applicationProfile.delete({ where: { id: existing.id } });
  res.json(deleted);
});

/**
 * Parses the :id param and looks up the profile, writing 400/404 responses
 * for missing or invalid ids. Returns the record on success, or null when a
 * response has already been written.
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

export { router as applicationProfilesRouter };
