"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { gate } from "@/lib/server-actor";
import { createContract, activateContract } from "@/server/orgs";
import { createSignedUpload } from "@/server/storage/signed";
import {
  buildOrgContractPath,
  ORG_CONTRACTS_BUCKET,
} from "@/server/storage/paths";

export const createContractFormSchema = z
  .object({
    organizationId: z.string().uuid(),
    playerId: z.string().uuid("pick a player"),
    seasonId: z.string().uuid(),
    contractPath: z.string().trim().min(1, "contract file required"),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
    status: z.enum(["draft", "active"]).default("draft"),
  })
  .refine((d) => d.validUntil >= d.validFrom, {
    message: "validUntil must be >= validFrom",
    path: ["validUntil"],
  });
export type CreateContractForm = z.infer<typeof createContractFormSchema>;

export function parseCreateContractForm(fd: FormData): CreateContractForm {
  return createContractFormSchema.parse({
    organizationId: fd.get("organizationId"),
    playerId: fd.get("playerId"),
    seasonId: fd.get("seasonId"),
    contractPath: fd.get("contractPath"),
    validFrom: fd.get("validFrom"),
    validUntil: fd.get("validUntil"),
    status: (fd.get("status") as string) || "draft",
  });
}

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
