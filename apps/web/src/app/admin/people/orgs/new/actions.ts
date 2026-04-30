"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { createOrg } from "@/server/orgs";
import { createSignedUpload } from "@/server/storage/signed";
import { ORG_LOGOS_BUCKET, buildOrgLogoPath } from "@/server/storage/paths";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { parseCreateOrgForm } from "./schemas";

/**
 * Plan 31 — actions for /admin/orgs/new. CAC fields removed; the new
 * `requestOrgLogoUploadAction` mints a signed PUT URL for the public
 * `org-logos` bucket. Same randomUUID-seeded path pattern as Plan 13B's
 * CAC uploader so a stable path is known before the org row exists.
 */

export async function requestOrgLogoUploadAction(input: {
  extension: string;
}): Promise<{ path: string; signedUrl: string; token?: string }> {
  const { sb } = await gate("orgs.edit");
  const placeholderId = randomUUID();
  const path = buildOrgLogoPath(placeholderId, input.extension);
  return createSignedUpload(sb, ORG_LOGOS_BUCKET, path);
}

export async function createOrgAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseCreateOrgForm(formData);

  // Resolve storage path → public URL (see updateOrgAction for rationale).
  let resolvedLogoUrl: string | null = input.logoPath ?? null;
  if (
    resolvedLogoUrl &&
    !/^https?:\/\//i.test(resolvedLogoUrl) &&
    !resolvedLogoUrl.startsWith("/")
  ) {
    const svc = getServiceRoleSupabase();
    const { data } = svc.storage.from(ORG_LOGOS_BUCKET).getPublicUrl(resolvedLogoUrl);
    resolvedLogoUrl = data?.publicUrl || resolvedLogoUrl;
  }

  const row = await createOrg(sb, {
    name: input.name,
    logoUrl: resolvedLogoUrl,
    contactRepUserId: input.contactRepUserId ?? null,
    status: "active",
  });
  revalidatePath("/admin/people/orgs");
  redirect(`/admin/people/orgs/${row.id}`);
}
