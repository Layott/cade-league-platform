import { z } from "zod";
import { ROLE_NAMES } from "@/perms";

/**
 * Zod schemas for the admin user CRUD surface (Plan 34).
 *
 * The UI passes raw `FormData` strings; these schemas coerce + validate
 * before the server module touches Supabase.
 */

const emailSchema = z
  .string()
  .min(3)
  .max(254)
  .email({ message: "must be a valid email" });

const displayNameSchema = z
  .string()
  .min(1, { message: "display name required" })
  .max(80);

const gamerTagSchema = z.string().min(1).max(40);
const jerseyNumberSchema = z
  .number()
  .int()
  .min(1, { message: "jersey 1–99" })
  .max(99, { message: "jersey 1–99" });

const passwordSchema = z
  .string()
  .min(12, { message: "password must be at least 12 chars" })
  .max(128);

const roleSchema = z.enum(ROLE_NAMES);

export const createUserSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  gamerTag: gamerTagSchema.optional(),
  jerseyNumber: jerseyNumberSchema.optional(),
  password: passwordSchema.optional(),
  roles: z.array(roleSchema).max(12).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  id: z.string().uuid(),
  displayName: displayNameSchema.optional(),
  gamerTag: gamerTagSchema.optional(),
  jerseyNumber: jerseyNumberSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetUserPasswordSchema = z.object({
  id: z.string().uuid(),
  newPassword: passwordSchema,
});
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;

export const softDeleteUserSchema = z.object({
  id: z.string().uuid(),
});
export type SoftDeleteUserInput = z.infer<typeof softDeleteUserSchema>;

export const restoreUserSchema = z.object({
  id: z.string().uuid(),
});
export type RestoreUserInput = z.infer<typeof restoreUserSchema>;

// Plan 39: DEFAULT_DEV_PASSWORD removed (security audit C1, CVSS-Critical).
// Server now generates a cryptographically random password when admin omits
// the field; the generated value is surfaced to the admin ONCE in the
// success-flash UI (never logged, never persisted).
//
// Helper kept here so the schema layer owns password generation rules
// (Node-only — never import from a client component).
export function generateOneTimePassword(): string {
  // 16 bytes → 22 url-safe base64 chars; comfortably > min(12) bound below.
  // Using sync API; this runs only inside the createUser server path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(16).toString("base64url");
}
