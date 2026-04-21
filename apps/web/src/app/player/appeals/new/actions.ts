"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { gate } from "@/lib/server-actor";
import { submit as submitAppeal } from "@/server/appeals";
import { createSignedUpload } from "@/server/storage/signed";
import {
  buildAppealEvidencePath,
  APPEAL_EVIDENCE_BUCKET,
} from "@/server/storage/paths";

export const submitAppealFormSchema = z.object({
  caseId: z.string().uuid("caseId required"),
  grounds: z
    .string()
    .trim()
    .min(40, "grounds must be at least 40 characters")
    .max(4000),
  evidencePaths: z.array(z.string()).max(3).default([]),
});
export type SubmitAppealForm = z.infer<typeof submitAppealFormSchema>;

export function parseSubmitAppealForm(fd: FormData): SubmitAppealForm {
  const evidencePaths = (fd.getAll("evidencePaths[]") as string[]).filter(
    Boolean,
  );
  return submitAppealFormSchema.parse({
    caseId: fd.get("caseId"),
    grounds: fd.get("grounds"),
    evidencePaths,
  });
}

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
