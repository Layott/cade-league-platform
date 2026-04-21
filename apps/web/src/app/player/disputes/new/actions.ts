"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { submit as submitDispute } from "@/server/disputes";
import { createSignedUpload } from "@/server/storage/signed";
import {
  buildDisputeEvidencePath,
  DISPUTE_EVIDENCE_BUCKET,
} from "@/server/storage/paths";
import { parseSubmitDisputeForm } from "./schemas";

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
