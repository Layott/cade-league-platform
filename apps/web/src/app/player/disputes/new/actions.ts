"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { submit as submitDispute } from "@/server/disputes";
import { publishDisputeSubmitted } from "@/server/disputes/realtime";
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
  const created = await submitDispute(sb, {
    raisedByUserId: userId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    title: input.title,
    description: input.description,
    evidenceUrls: input.evidencePaths,
  });

  // Live-refresh (2026-04-24) — wake the admin queue + dashboard
  // counter so a newly-filed dispute is visible without reload.
  try {
    await publishDisputeSubmitted(sb, {
      disputeId: created.id,
      raisedByUserId: userId,
    });
  } catch {
    // best-effort
  }

  revalidatePath("/player/disputes");
  revalidatePath("/admin/disputes");
  revalidatePath("/admin");
  redirect("/player/disputes");
}
