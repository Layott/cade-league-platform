import { z } from "zod";

/**
 * Plan 40 (P40-B) — profile edit payload schemas.
 *
 * SYNC file — intentionally does NOT carry `"use server"`. Lives next to
 * `actions.ts` so the server action can import types + parsers while
 * respecting the Next.js rule that modules with `"use server"` export ONLY
 * async functions (see root CLAUDE.md §10).
 */

const displayNameSchema = z
  .string()
  .min(1, { message: "display name required" })
  .max(80);

const bioSchema = z
  .string()
  .max(500, { message: "bio must be 500 chars or less" })
  // Empty string in the form means "clear the bio".
  .transform((s) => s.trim());

// Basic sanity: accept http(s) or relative /... path. We do not attempt a
// full URL parse since Supabase signed URLs are long and admin-managed.
const photoUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (s) => s === "" || /^https?:\/\//i.test(s) || s.startsWith("/"),
    { message: "photo_url must be an http(s) URL or a site-relative path" },
  )
  .transform((s) => s.trim());

export const updateOwnProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  bio: bioSchema.optional(),
  photoUrl: photoUrlSchema.optional(),
});
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

export const updateOtherProfileSchema = z.object({
  userId: z.string().uuid(),
  displayName: displayNameSchema.optional(),
  bio: bioSchema.optional(),
  photoUrl: photoUrlSchema.optional(),
});
export type UpdateOtherProfileInput = z.infer<typeof updateOtherProfileSchema>;

/**
 * Extracts the three editable fields from a FormData. Empty string on a
 * photo_url means "leave unchanged"; explicit null is not supported via the
 * form (admin surface handles that separately). Bio empty string IS meaningful
 * ("clear the bio") so we pass it through.
 */
export function parseProfileFormData(
  formData: FormData,
): { displayName?: string; bio?: string; photoUrl?: string } {
  const out: { displayName?: string; bio?: string; photoUrl?: string } = {};
  const display = formData.get("display_name");
  if (typeof display === "string" && display.trim().length > 0) {
    out.displayName = display.trim();
  }
  const bio = formData.get("bio");
  if (typeof bio === "string") {
    out.bio = bio;
  }
  const photo = formData.get("photo_url");
  if (typeof photo === "string" && photo.trim().length > 0) {
    out.photoUrl = photo.trim();
  }
  return out;
}
