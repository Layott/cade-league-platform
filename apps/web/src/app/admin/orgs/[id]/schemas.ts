import { z } from "zod";

/**
 * Plan 13B — /admin/orgs/[id] form schemas. Split from `actions.ts` so
 * the "use server" module only exports async functions.
 */

export const updateOrgFormSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  cacNumber: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  contactRepUserId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .refine((v) => !v || /^[0-9a-f-]{36}$/i.test(v), "must be uuid"),
  status: z.enum(["active", "suspended", "dissolved"]).optional(),
});
export type UpdateOrgForm = z.infer<typeof updateOrgFormSchema>;

export function parseUpdateOrgForm(fd: FormData): UpdateOrgForm {
  return updateOrgFormSchema.parse({
    id: fd.get("id"),
    name: fd.get("name") || undefined,
    cacNumber: fd.get("cacNumber"),
    contactRepUserId: fd.get("contactRepUserId"),
    status: (fd.get("status") as string) || undefined,
  });
}

export const linkPlayerFormSchema = z.object({
  orgId: z.string().uuid(),
  playerId: z.string().uuid(),
});
export function parseLinkPlayerForm(fd: FormData) {
  return linkPlayerFormSchema.parse({
    orgId: fd.get("orgId"),
    playerId: fd.get("playerId"),
  });
}
