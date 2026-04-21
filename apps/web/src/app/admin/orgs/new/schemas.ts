import { z } from "zod";

/**
 * Plan 13B — /admin/orgs/new form schema. Split from `actions.ts` so the
 * "use server" module only exports async functions.
 */

export const createOrgFormSchema = z.object({
  name: z.string().trim().min(1, "name required").max(200),
  cacNumber: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  cacCertPath: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
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
    cacNumber: str(fd, "cacNumber"),
    cacCertPath: str(fd, "cacCertPath"),
    contactRepUserId: str(fd, "contactRepUserId"),
  });
}
