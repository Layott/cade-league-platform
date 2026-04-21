"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gate } from "@/lib/server-actor";
import {
  linkPlayer,
  unlinkPlayer,
  updateOrg,
  softDeleteOrg,
} from "@/server/orgs";
import { parseLinkPlayerForm, parseUpdateOrgForm } from "./schemas";

/**
 * Plan 13B — mutation actions for /admin/orgs/[id].
 *
 * Permission map (spec §8.1):
 *   - updateOrgAction       → orgs.edit
 *   - softDeleteOrgAction   → orgs.edit
 *   - linkPlayerAction      → orgs.edit
 *   - unlinkPlayerAction    → orgs.edit
 */

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
