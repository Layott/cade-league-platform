import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import { ConflictError } from "./errors";

/**
 * Plan 41 §3.5 — admin reopens a locked squad submission.
 *
 * Flips validation_status back to 'pending' so the player can resubmit,
 * clears validator/reason stamps, and fires an in-app notification to
 * the player. Audit row is emitted by the existing `attach_audit` trigger
 * on public.squad_submissions.
 *
 * Caller-supplied `sb` is used for the perm check + notification fan-out
 * (scoped to the admin's auth). For the squad_submissions UPDATE we accept
 * the same client — `role_permissions` + `audit_events` bookkeeping follows
 * the existing approve/reject pattern.
 */

export type ReopenResult = {
  submissionId: string;
  priorStatus: "approved" | "rejected";
  playerUserId: string;
};

export async function reopenSubmission(
  sb: SupabaseClient,
  actor: Actor,
  submissionId: string,
): Promise<ReopenResult> {
  await requirePermAsync(sb, actor, "squads.reopen");

  // Load current submission + resolve the player's user_id so the
  // notification lands on the right `users` row (notifications.user_id).
  const { data: current, error: loadErr } = await sb
    .from("squad_submissions")
    .select(
      "id, validation_status, week_start_date, player_id, player:players!squad_submissions_player_id_fkey(user_id)",
    )
    .eq("id", submissionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (loadErr) throw new Error(`reopen load failed: ${loadErr.message}`);
  if (!current) throw new Error(`submission not found: ${submissionId}`);

  const priorStatus = current.validation_status as "pending" | "approved" | "rejected";
  if (priorStatus !== "approved" && priorStatus !== "rejected") {
    throw new ConflictError(
      `submission is ${priorStatus}, only approved or rejected can be reopened`,
    );
  }

  const { error: updErr } = await sb
    .from("squad_submissions")
    .update({
      validation_status: "pending",
      validated_by: null,
      validated_at: null,
      rejection_reason: null,
    })
    .eq("id", submissionId);
  if (updErr) throw new Error(`reopen update failed: ${updErr.message}`);

  // Resolve player's user row so the notification lands correctly.
  // The FK shape returned by the embed is { user_id }.
  const playerRel = current.player as { user_id: string } | { user_id: string }[] | null;
  const playerUserId = Array.isArray(playerRel)
    ? playerRel[0]?.user_id
    : playerRel?.user_id;
  if (!playerUserId) {
    throw new Error(`reopen: could not resolve player user_id for ${submissionId}`);
  }

  // Resolve admin display name for the notification body.
  const { data: adminRow } = await sb
    .from("users")
    .select("display_name")
    .eq("id", actor.userId ?? "")
    .is("deleted_at", null)
    .maybeSingle();
  const adminName = adminRow?.display_name ?? "an admin";

  const weekLabel = current.week_start_date ?? "this week";
  const title = "Squad submission reopened";
  const body = `Your squad for week ${weekLabel} has been reopened by ${adminName}.`;

  const { error: notifErr } = await sb.from("notifications").insert({
    user_id: playerUserId,
    type: "squad_reopened",
    title,
    body,
    delivered_channels: ["in_app"],
    announcement_id: null,
  });
  if (notifErr) {
    throw new Error(`reopen notify failed: ${notifErr.message}`);
  }

  return {
    submissionId: current.id,
    priorStatus,
    playerUserId,
  };
}
