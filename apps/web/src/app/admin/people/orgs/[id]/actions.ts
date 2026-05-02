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
import { getServiceRoleSupabase } from "@/lib/supabase/service";
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

  // SignedFileInput emits the storage PATH (e.g. `orgs/<uuid>/logo.png`).
  // The DB column `organizations.logo_url` is rendered directly as
  // `<img src>` on /admin/people/orgs and the 15-orgs broadcast overlay,
  // so we must resolve the path to a fully-qualified PUBLIC URL here.
  // Bucket is public so getPublicUrl is sufficient (no signed-read).
  let resolvedLogoUrl = input.logoPath;
  if (input.logoPath && !/^https?:\/\//i.test(input.logoPath) && !input.logoPath.startsWith("/")) {
    const svc = getServiceRoleSupabase();
    const { data } = svc.storage.from(ORG_LOGOS_BUCKET).getPublicUrl(input.logoPath);
    resolvedLogoUrl = data?.publicUrl || input.logoPath;
  }

  await updateOrg(sb, {
    id: input.id,
    name: input.name,
    logoUrl: resolvedLogoUrl,
    contactRepUserId: input.contactRepUserId,
    status: input.status,
  });
  revalidatePath(`/admin/people/orgs/${input.id}`);
  revalidatePath("/admin/people/orgs");
  revalidatePath("/admin/people/players");
  revalidatePath("/overlay/v2/15-orgs", "page");
  revalidatePath("/overlay/v2/16-coaches", "page");
  revalidatePath("/overlay/v2/04-h2h-2", "page");
  revalidatePath("/overlay/v2/05-h2h-3", "page");
  revalidatePath("/overlay/v2/06-h2h-5", "page");
}

export async function linkPlayerAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseLinkPlayerForm(formData);
  await linkPlayer(sb, input);
  revalidatePath(`/admin/people/orgs/${input.orgId}`);
  // Bug 12 fix (2026-05-01): a newly-linked player must surface in the
  // orgs/coaches overlays + h2h endpoints (which embed org logos when
  // the player has been linked). Revalidate broadly so the operator
  // sees the linkage everywhere.
  revalidatePath("/admin/people/orgs");
  revalidatePath("/admin/people/players");
  revalidatePath("/overlay/v2/15-orgs", "page");
  revalidatePath("/overlay/v2/16-coaches", "page");
  revalidatePath("/overlay/v2/04-h2h-2", "page");
  revalidatePath("/overlay/v2/05-h2h-3", "page");
  revalidatePath("/overlay/v2/06-h2h-5", "page");
}

export async function unlinkPlayerAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const orgId = String(formData.get("orgId") ?? "");
  const playerId = String(formData.get("playerId") ?? "");
  if (!orgId || !playerId) throw new Error("orgId + playerId required");
  await unlinkPlayer(sb, playerId);
  revalidatePath(`/admin/people/orgs/${orgId}`);
  revalidatePath("/admin/people/orgs");
  revalidatePath("/admin/people/players");
  revalidatePath("/overlay/v2/15-orgs", "page");
  revalidatePath("/overlay/v2/16-coaches", "page");
  revalidatePath("/overlay/v2/04-h2h-2", "page");
  revalidatePath("/overlay/v2/05-h2h-3", "page");
  revalidatePath("/overlay/v2/06-h2h-5", "page");
}

export async function linkCoachAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseLinkCoachForm(formData);
  await linkCoach(sb, input);
  revalidatePath(`/admin/people/orgs/${input.orgId}`);
}

export async function linkTeamManagerAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseLinkTeamManagerForm(formData);
  await linkTeamManager(sb, input);
  revalidatePath(`/admin/people/orgs/${input.orgId}`);
}

export async function softDeleteOrgAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("id required");
  await softDeleteOrg(sb, id);
  revalidatePath("/admin/people/orgs");
  redirect("/admin/people/orgs");
}
