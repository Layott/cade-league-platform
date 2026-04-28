import { z } from "zod";

/**
 * Plan 31 — /admin/orgs/new form schema (CAC removed).
 * Split from `actions.ts` so the "use server" module only exports async
 * functions. `logoPath` is the storage path returned by the signed-upload
 * action (`requestOrgLogoUploadAction`); it's resolved into the public
 * URL by the action before persisting.
 */

// Plan 39 sanitize — `..` traversal in any storage path lets a poisoned
// upload escape the bucket sub-tree. Reject the parent-path token + any
// backslash (Windows separator).
const NO_TRAVERSAL = (v: string | undefined) =>
  !v || (!v.includes("..") && !v.includes("\\"));

export const createOrgFormSchema = z.object({
  name: z.string().trim().min(1, "name required").max(200),
  logoPath: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .refine(NO_TRAVERSAL, "logoPath must not contain '..' or backslashes"),
  contactRepUserId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .refine(
      (v) => !v || /^[0-9a-f-]{36}$/i.test(v),
      "contactRepUserId must be uuid",
    ),
});
export type CreateOrgForm = z.infer<typeof createOrgFormSchema>;

// FormData.get() returns string | File | null. Coerce to string | undefined
// so the zod schema can accept missing-optional fields without treating them
// as the wrong type.
function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (v == null) return undefined;
  return typeof v === "string" ? v : undefined;
}

export function parseCreateOrgForm(fd: FormData): CreateOrgForm {
  return createOrgFormSchema.parse({
    name: str(fd, "name"),
    logoPath: str(fd, "logoPath"),
    contactRepUserId: str(fd, "contactRepUserId"),
  });
}
