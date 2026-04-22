"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gate } from "@/lib/server-actor";
import {
  linkPlayer,
  unlinkPlayer,
  linkCoach,
  linkTeamManager,
  updateOrg,
  softDeleteOrg,
} from "@/server/orgs";
import { createSignedUpload } from "@/server/storage/signed";
import { ORG_LOGOS_BUCKET, buildOrgLogoPath } from "@/server/storage/paths";
import {
  parseLinkPlayerForm,
  parseLinkCoachForm,
  parseLinkTeamManagerForm,
  parseUpdateOrgForm,
} from "./schemas";

/**
 * Plan 13B + Plan 31 — mutation actions for /admin/orgs/[id].
 *
 * Permission map (spec §8.1):
 *   - updateOrgAction              → orgs.edit
 *   - softDeleteOrgAction          → orgs.edit
 *   - linkPlayerAction             → orgs.edit
 *   - unlinkPlayerAction           → orgs.edit
 *   - linkCoachAction (Plan 31)    → orgs.edit
 *   - linkTeamManagerAction (P31)  → orgs.edit
 *   - requestOrgLogoUploadAction   → orgs.edit
 */

export async function requestOrgLogoUploadAction(input: {
  extension: string;
}): Promise<{ path: string; signedUrl: string; token?: string }> {
  const { sb } = await gate("orgs.edit");
  const placeholderId = randomUUID();
  const path = buildOrgLogoPath(placeholderId, input.extension);
  return createSignedUpload(sb, ORG_LOGOS_BUCKET, path);
}

export async function updateOrgAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseUpdateOrgForm(formData);
  await updateOrg(sb, {
    id: input.id,
    name: input.name,
    logoUrl: input.logoPath,
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

export async function linkCoachAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseLinkCoachForm(formData);
  await linkCoach(sb, input);
  revalidatePath(`/admin/orgs/${input.orgId}`);
}

export async function linkTeamManagerAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseLinkTeamManagerForm(formData);
  await linkTeamManager(sb, input);
  revalidatePath(`/admin/orgs/${input.orgId}`);
}

export async function softDeleteOrgAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("id required");
  await softDeleteOrg(sb, id);
  revalidatePath("/admin/orgs");
  redirect("/admin/orgs");
}
