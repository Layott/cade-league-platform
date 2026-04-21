import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import { ConflictError, ValidationError } from "./errors";

/**
 * Plan 10 — referee-side actions: approve or reject a submission.
 *
 * Both flip validation_status on the submission row. Approve stamps
 * validated_by + validated_at. Reject additionally stores rejection_reason.
 * Caller (route handler) is expected to pass `actor` loaded from session;
 * this module enforces the perm check inline so business rules and the
 * permission decision live in the same place.
 */

export async function approveSubmission(
  sb: SupabaseClient,
  actor: Actor,
  submissionId: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "squads.validate");

  const { data: current } = await sb
    .from("squad_submissions")
    .select("id, validation_status")
    .eq("id", submissionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!current) throw new Error(`submission not found: ${submissionId}`);
  if (current.validation_status !== "pending") {
    throw new ConflictError(
      `submission is ${current.validation_status}, not pending`,
    );
  }

  const { error } = await sb
    .from("squad_submissions")
    .update({
      validation_status: "approved",
      validated_by: actor.userId,
      validated_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq("id", submissionId);
  if (error) throw new Error(`approve failed: ${error.message}`);
}

export async function rejectSubmission(
  sb: SupabaseClient,
  actor: Actor,
  submissionId: string,
  reason: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "squads.validate");
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("rejection_reason required");
  }

  const { data: current } = await sb
    .from("squad_submissions")
    .select("id, validation_status")
    .eq("id", submissionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!current) throw new Error(`submission not found: ${submissionId}`);
  if (current.validation_status !== "pending") {
    throw new ConflictError(
      `submission is ${current.validation_status}, not pending`,
    );
  }

  const { error } = await sb
    .from("squad_submissions")
    .update({
      validation_status: "rejected",
      validated_by: actor.userId,
      validated_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq("id", submissionId);
  if (error) throw new Error(`reject failed: ${error.message}`);
}
