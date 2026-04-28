import { z } from "zod";

/**
 * Plan 13B + Plan 31 — /admin/orgs/[id] form schemas. Split from
 * `actions.ts` so the "use server" module only exports async functions.
 * CAC fields removed; `logoPath` added (storage path returned by the
 * org-logos signed upload).
 */

// Plan 39 sanitize — `..` / backslash guard on any storage path.
const NO_TRAVERSAL = (v: string | undefined) =>
  !v || (!v.includes("..") && !v.includes("\\"));

export const updateOrgFormSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  logoPath: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .refine(NO_TRAVERSAL, "logoPath must not contain '..' or backslashes"),
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
    logoPath: fd.get("logoPath"),
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

export const linkCoachFormSchema = z.object({
  orgId: z.string().uuid(),
  playerId: z.string().uuid(),
  coachUserId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine(
      (v) => v === null || /^[0-9a-f-]{36}$/i.test(v),
      "coachUserId must be uuid or empty",
    ),
});
export function parseLinkCoachForm(fd: FormData) {
  return linkCoachFormSchema.parse({
    orgId: fd.get("orgId"),
    playerId: fd.get("playerId"),
    coachUserId: fd.get("coachUserId"),
  });
}

export const linkTeamManagerFormSchema = z.object({
  orgId: z.string().uuid(),
  playerId: z.string().uuid(),
  teamManagerUserId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine(
      (v) => v === null || /^[0-9a-f-]{36}$/i.test(v),
      "teamManagerUserId must be uuid or empty",
    ),
});
export function parseLinkTeamManagerForm(fd: FormData) {
  return linkTeamManagerFormSchema.parse({
    orgId: fd.get("orgId"),
    playerId: fd.get("playerId"),
    teamManagerUserId: fd.get("teamManagerUserId"),
  });
}
