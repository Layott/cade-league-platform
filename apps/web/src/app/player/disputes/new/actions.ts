"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { gate } from "@/lib/server-actor";
import { submit as submitDispute } from "@/server/disputes";
import { createSignedUpload } from "@/server/storage/signed";
import {
  buildDisputeEvidencePath,
  DISPUTE_EVIDENCE_BUCKET,
} from "@/server/storage/paths";

export const submitDisputeFormSchema = z.object({
  subjectType: z.enum(["match", "sanction", "registration", "other"]),
  subjectId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .refine((v) => !v || /^[0-9a-f-]{36}$/i.test(v), "must be uuid"),
  description: z
    .string()
    .trim()
    .min(20, "description must be at least 20 characters")
    .max(4000),
  evidencePaths: z.array(z.string()).max(3).default([]),
});
export type SubmitDisputeForm = z.infer<typeof submitDisputeFormSchema>;

export function parseSubmitDisputeForm(fd: FormData): SubmitDisputeForm {
  const evidencePaths = (fd.getAll("evidencePaths[]") as string[]).filter(
    Boolean,
  );
  return submitDisputeFormSchema.parse({
    subjectType: fd.get("subjectType"),
    subjectId: fd.get("subjectId"),
    description: fd.get("description"),
    evidencePaths,
  });
}

export async function requestEvidenceUploadAction(input: {
  extension: string;
}): Promise<{ path: string; signedUrl: string; token?: string }> {
  // Player must have disputes.submit to upload evidence.
  const { sb } = await gate("disputes.submit");
  const disputeId = randomUUID(); // placeholder; evidence lives at disputes/<synth>/…
  const fileId = randomUUID();
  const path = buildDisputeEvidencePath(disputeId, fileId, input.extension);
  return createSignedUpload(sb, DISPUTE_EVIDENCE_BUCKET, path);
}

export async function submitDisputeAction(formData: FormData): Promise<void> {
  const { sb, userId } = await gate("disputes.submit");
  const input = parseSubmitDisputeForm(formData);
  await submitDispute(sb, {
    raisedByUserId: userId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    description: input.description,
    evidenceUrls: input.evidencePaths,
  });
  revalidatePath("/player/disputes");
  redirect("/player/disputes");
}
