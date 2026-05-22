import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import prisma from "../prismaClient.js";

/**
 * Shape of the legacy user_info.json template file. Only the firstName,
 * lastName, email, and phone fields are required by the ApplicationProfile
 * model; the rest map to optional columns.
 */
interface UserInfoJsonTemplate {
  firstName: string;
  middleName?: string;
  lastName: string;
  email: string;
  phone: string;
  github?: string;
  linkedin?: string;
  website?: string;
  resumeUrl?: string;
}

/**
 * On first startup after the ApplicationProfile migration, the
 * application_profiles table is empty. To keep the existing single-user
 * workflow alive, this seeds a row named "Default" from
 * server/src/scripts/user_info.json when (and only when) the table has no
 * rows. After the user creates their own profiles this becomes a no-op.
 *
 * Silently logs and continues on any error — seeding is best-effort, not a
 * required startup step. The CRUD UI is the canonical way to add profiles.
 */
export async function seedDefaultProfileIfEmpty(): Promise<void> {
  const profileCount = await prisma.applicationProfile.count();
  const hasExistingProfiles = profileCount > 0;
  if (hasExistingProfiles) {
    return;
  }

  const userInfoPath = resolve(__dirname, "../scripts/user_info.json");
  let templateJson: string;
  try {
    templateJson = await readFile(userInfoPath, "utf-8");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(`[profileSeed] No user_info.json found at ${userInfoPath} — skipping seed (${errorMessage})`);
    return;
  }

  let template: UserInfoJsonTemplate;
  try {
    template = JSON.parse(templateJson) as UserInfoJsonTemplate;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[profileSeed] Failed to parse user_info.json: ${errorMessage}`);
    return;
  }

  await prisma.applicationProfile.create({
    data: {
      name: "Default",
      firstName: template.firstName,
      middleName: template.middleName ?? null,
      lastName: template.lastName,
      email: template.email,
      phone: template.phone,
      github: template.github ?? null,
      linkedin: template.linkedin ?? null,
      website: template.website ?? null,
      resumeUrl: template.resumeUrl ?? null,
    },
  });

  console.log("[profileSeed] Seeded 'Default' ApplicationProfile from user_info.json");
}
