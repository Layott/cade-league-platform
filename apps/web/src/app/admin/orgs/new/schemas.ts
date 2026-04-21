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
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  cacCertPath: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  contactRepUserId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .refine(
      (v) => !v || /^[0-9a-f-]{36}$/i.test(v),
      "contactRepUserId must be uuid",
    ),
});
export type CreateOrgForm = z.infer<typeof createOrgFormSchema>;

export function parseCreateOrgForm(fd: FormData): CreateOrgForm {
  return createOrgFormSchema.parse({
    name: fd.get("name"),
    cacNumber: fd.get("cacNumber"),
    cacCertPath: fd.get("cacCertPath"),
    contactRepUserId: fd.get("contactRepUserId"),
  });
}
