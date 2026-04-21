"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { submit as submitAppeal } from "@/server/appeals";
import { createSignedUpload } from "@/server/storage/signed";
import {
  buildAppealEvidencePath,
  APPEAL_EVIDENCE_BUCKET,
} from "@/server/storage/paths";
import { parseSubmitAppealForm } from "./schemas";

export async function requestAppealEvidenceUploadAction(input: {
  extension: string;
}): Promise<{ path: string; signedUrl: string; token?: string }> {
  const { sb } = await gate("appeals.submit");
  const appealId = randomUUID();
  const fileId = randomUUID();
  const path = buildAppealEvidencePath(appealId, fileId, input.extension);
  return createSignedUpload(sb, APPEAL_EVIDENCE_BUCKET, path);
}

export async function submitAppealAction(formData: FormData): Promise<void> {
  const { sb, userId } = await gate("appeals.submit");
  const input = parseSubmitAppealForm(formData);
  await submitAppeal(sb, {
    disciplinaryCaseId: input.caseId,
    submittedByUserId: userId,
    grounds: input.grounds,
    evidenceUrls: input.evidencePaths,
  });
  revalidatePath("/player/appeals");
  redirect("/player/appeals");
}
