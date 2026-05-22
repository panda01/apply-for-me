/**
 * Frontend API service for the application profiles backend.
 *
 * An application profile holds the user's personal info used to fill out
 * job-application forms. Profiles are created/edited from /profiles and
 * selected on the apply dashboard before kicking off an application.
 */
import { requestJson } from "./httpClient";

/**
 * Allowed values for ApplicationProfile.workAuthorization. Mirrors the
 * Prisma enum and the server-side TS type so the wire format round-trips.
 * US-only by design.
 */
export type WorkAuthorization =
  | "us_citizen"
  | "permanent_resident"
  | "authorized_no_sponsorship_needed"
  | "authorized_future_sponsorship_needed"
  | "sponsorship_required";

/**
 * Human-readable label for each WorkAuthorization value. Used by the profile
 * form Select and any read-only displays of the field.
 */
export const WORK_AUTHORIZATION_LABELS: Record<WorkAuthorization, string> = {
  us_citizen: "US Citizen",
  permanent_resident: "Permanent Resident (Green Card)",
  authorized_no_sponsorship_needed: "Authorized to work — no sponsorship needed",
  authorized_future_sponsorship_needed: "Authorized to work — future sponsorship required",
  sponsorship_required: "Sponsorship required",
};

/**
 * Server-side ApplicationProfile shape after JSON serialization. Dates are
 * ISO strings in transit even though the DB stores them as DateTime.
 */
export interface ApplicationProfileResponse {
  id: number;
  name: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string;
  phone: string;
  github: string | null;
  linkedin: string | null;
  website: string | null;
  resumeUrl: string | null;
  coverLetterUrl: string | null;
  workAuthorization: WorkAuthorization | null;
  desiredSalaryMin: number | null;
  created_date: string;
  updated_date: string;
}

/**
 * Shape of the JSON body sent to POST / PUT. Optional fields can be set to
 * null to clear them.
 */
export interface ApplicationProfileInput {
  name: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  email: string;
  phone: string;
  github?: string | null;
  linkedin?: string | null;
  website?: string | null;
  resumeUrl?: string | null;
  coverLetterUrl?: string | null;
  workAuthorization?: WorkAuthorization | null;
  desiredSalaryMin?: number | null;
}

/**
 * Fetches every application profile, newest first.
 * @returns {Promise<ApplicationProfileResponse[]>} Array of profile records
 * @throws {Error} If the API request fails
 */
export async function listApplicationProfiles(): Promise<ApplicationProfileResponse[]> {
  return requestJson<ApplicationProfileResponse[]>(
    "/api/application-profiles",
    undefined,
    "Failed to fetch application profiles"
  );
}

/**
 * Fetches a single application profile by id.
 * @param {number} id - The profile id
 * @returns {Promise<ApplicationProfileResponse>} The profile record
 * @throws {Error} If the API request fails or the profile is not found
 */
export async function getApplicationProfile(id: number): Promise<ApplicationProfileResponse> {
  return requestJson<ApplicationProfileResponse>(
    `/api/application-profiles/${String(id)}`,
    undefined,
    "Failed to fetch application profile"
  );
}

/**
 * Creates a new application profile.
 * @param {ApplicationProfileInput} input - The profile fields to create
 * @returns {Promise<ApplicationProfileResponse>} The created profile record
 * @throws {Error} If validation fails or the API request fails
 */
export async function createApplicationProfile(
  input: ApplicationProfileInput
): Promise<ApplicationProfileResponse> {
  return requestJson<ApplicationProfileResponse>(
    "/api/application-profiles",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    "Failed to create application profile"
  );
}

/**
 * Updates an existing application profile by id. The server treats this as a
 * full replacement — any optional field omitted from the input is cleared.
 * @param {number} id - The profile id to update
 * @param {ApplicationProfileInput} input - The complete profile body
 * @returns {Promise<ApplicationProfileResponse>} The updated profile record
 * @throws {Error} If validation fails or the API request fails
 */
export async function updateApplicationProfile(
  id: number,
  input: ApplicationProfileInput
): Promise<ApplicationProfileResponse> {
  return requestJson<ApplicationProfileResponse>(
    `/api/application-profiles/${String(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    "Failed to update application profile"
  );
}

/**
 * Deletes an application profile by id.
 * @param {number} id - The profile id to delete
 * @returns {Promise<ApplicationProfileResponse>} The deleted profile record
 * @throws {Error} If the API request fails
 */
export async function deleteApplicationProfile(id: number): Promise<ApplicationProfileResponse> {
  return requestJson<ApplicationProfileResponse>(
    `/api/application-profiles/${String(id)}`,
    { method: "DELETE" },
    "Failed to delete application profile"
  );
}
