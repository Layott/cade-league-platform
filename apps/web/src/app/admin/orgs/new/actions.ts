"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { createOrg } from "@/server/orgs";
import { createSignedUpload } from "@/server/storage/signed";
import { buildOrgCacPath, ORG_CAC_BUCKET } from "@/server/storage/paths";
import { parseCreateOrgForm } from "./schemas";

/**
 * Plan 13B — actions for /admin/orgs/new. Create-org double-gates via
 * `orgs.edit`. Upload URL minted by `requestCacUploadAction` using a
 * randomUUID-seeded orgId so the eventual path is stable (we persist it
 * in the form hidden field and pass it straight to createOrg).
 */

/**
 * Request a signed upload URL for the CAC cert. The client calls this
 * from the file input change handler; the returned path is echoed into a
 * hidden form field for the subsequent createOrgAction call.
 */
export async function requestCacUploadAction(input: {
  extension: string;
}): Promise<{ path: string; signedUrl: string; token?: string }> {
  const { sb } = await gate("orgs.edit");
  // Synthetic orgId — we don't know the real id yet. Stable per upload.
  const placeholderId = randomUUID();
  const path = buildOrgCacPath(placeholderId, input.extension);
  return createSignedUpload(sb, ORG_CAC_BUCKET, path);
}

export async function createOrgAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseCreateOrgForm(formData);
  const row = await createOrg(sb, {
    name: input.name,
    cacNumber: input.cacNumber ?? null,
    cacCertUrl: input.cacCertPath ?? null,
    contactRepUserId: input.contactRepUserId ?? null,
    status: "active",
  });
  revalidatePath("/admin/orgs");
  redirect(`/admin/orgs/${row.id}`);
}
