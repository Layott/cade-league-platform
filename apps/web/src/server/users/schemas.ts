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
  .min(8, { message: "password must be at least 8 chars" })
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

/**
 * Default placeholder password used when an admin creates a user without
 * supplying one. Dev-only convenience: in production a warning is logged
 * by the server action when this fallback is used. The user is expected
 * to reset on first login.
 */
export const DEFAULT_DEV_PASSWORD = "dev-temp-2026";
