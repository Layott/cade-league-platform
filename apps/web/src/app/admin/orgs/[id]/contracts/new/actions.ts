"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { createContract, activateContract } from "@/server/orgs";
import { createSignedUpload } from "@/server/storage/signed";
import {
  buildOrgContractPath,
  ORG_CONTRACTS_BUCKET,
} from "@/server/storage/paths";
import { parseCreateContractForm } from "./schemas";

export async function requestContractUploadAction(input: {
  orgId: string;
  extension: string;
}): Promise<{ path: string; signedUrl: string; token?: string }> {
  const { sb } = await gate("orgs.edit");
  const contractId = randomUUID();
  const path = buildOrgContractPath(input.orgId, contractId, input.extension);
  return createSignedUpload(sb, ORG_CONTRACTS_BUCKET, path);
}

export async function createContractAction(formData: FormData): Promise<void> {
  const { sb } = await gate("orgs.edit");
  const input = parseCreateContractForm(formData);
  const row = await createContract(sb, {
    organizationId: input.organizationId,
    playerId: input.playerId,
    seasonId: input.seasonId,
    contractUrl: input.contractPath,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    status: "draft",
  });
  if (input.status === "active") {
    await activateContract(sb, row.id);
  }
  revalidatePath(`/admin/orgs/${input.organizationId}`);
  redirect(`/admin/orgs/${input.organizationId}#contracts`);
}
