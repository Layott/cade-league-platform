"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { gate } from "@/lib/server-actor";
import {
  linkPlayer,
  unlinkPlayer,
  updateOrg,
  softDeleteOrg,
} from "@/server/orgs";

/**
 * Plan 13B — mutation actions for /admin/orgs/[id].
 *
 * Permission map (spec §8.1):
 *   - updateOrgAction       → orgs.edit
 *   - softDeleteOrgAction   → orgs.edit
 *   - linkPlayerAction      → orgs.edit
 *   - unlinkPlayerAction    → orgs.edit
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

export async function updateOrgAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseUpdateOrgForm(formData);
  await updateOrg(sb, {
    id: input.id,
    name: input.name,
    cacNumber: input.cacNumber,
    contactRepUserId: input.contactRepUserId,
    status: input.status,
  });
  revalidatePath(`/admin/orgs/${input.id}`);
  revalidatePath("/admin/orgs");
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

export async function linkPlayerAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseLinkPlayerForm(formData);
  await linkPlayer(sb, input);
  revalidatePath(`/admin/orgs/${input.orgId}`);
}

export async function unlinkPlayerAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const orgId = String(formData.get("orgId") ?? "");
  const playerId = String(formData.get("playerId") ?? "");
  if (!orgId || !playerId) throw new Error("orgId + playerId required");
  await unlinkPlayer(sb, playerId);
  revalidatePath(`/admin/orgs/${orgId}`);
}

export async function softDeleteOrgAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("id required");
  await softDeleteOrg(sb, id);
  revalidatePath("/admin/orgs");
  redirect("/admin/orgs");
}
