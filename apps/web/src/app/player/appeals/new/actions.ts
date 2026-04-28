"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gate } from "@/lib/server-actor";
import { submit as submitAppeal } from "@/server/appeals";
import { publishAppealSubmitted } from "@/server/appeals/realtime";
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
  const created = await submitAppeal(sb, {
    disciplinaryCaseId: input.caseId,
    submittedByUserId: userId,
    grounds: input.grounds,
    evidenceUrls: input.evidencePaths,
  });

  // Live-refresh (2026-04-24) — wake the admin queue so a new
  // appeal row appears without reload. Fire-and-forget.
  try {
    await publishAppealSubmitted(sb, {
      appealId: created.id,
      submittedByUserId: userId,
    });
  } catch {
    // best-effort
  }

  // UI Audit Slice 2 (2026-04-28) — list view moved to
  // /player/cases?tab=appeals. Old /player/appeals 307s here, but we
  // redirect straight at the new path to avoid the hop. Still
  // revalidate the old path so any stale bookmark cache invalidates.
  revalidatePath("/player/cases");
  revalidatePath("/player/appeals");
  revalidatePath("/admin/discipline/appeals");
  redirect("/player/cases?tab=appeals");
}
