import type { SupabaseClient } from "@supabase/supabase-js";
import { changeSchema, type ChangeInput } from "./schemas";
import { ConflictError, ValidationError, PermissionError } from "./errors";
import { isWithinFridayWindow } from "./week";
import { hasPermAsync } from "@/lib/perms-db";

/**
 * Plan 10 — Friday 21:00-22:00 WAT one-swap-per-week change request.
 *
 * Guards (strict server-side):
 *   1. Zod.
 *   2. Submission exists + validation_status='approved'.
 *   3. now ∈ [openAt, closeAt) of the Friday window for that weekStart.
 *   4. No existing live squad_change_requests row for this submission.
 *   5. authorizedByRefUserId resolves to a user who currently has
 *      `squads.change_authorize` permission.
 */
export async function requestChange(
  sb: SupabaseClient,
  input: ChangeInput,
  opts: { now?: Date } = {},
): Promise<{ id: string }> {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "invalid input");
  }
  const v = parsed.data;
  const now = opts.now ?? new Date();

  // Load submission + weekStart.
  const { data: sub, error: subErr } = await sb
    .from("squad_submissions")
    .select("id, week_start_date, validation_status")
    .eq("id", v.submissionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (subErr || !sub) throw new Error(`submission not found: ${v.submissionId}`);
  if (sub.validation_status !== "approved") {
    throw new ConflictError(
      `submission is ${sub.validation_status}, not approved`,
    );
  }

  if (!isWithinFridayWindow(now, sub.week_start_date)) {
    throw new ConflictError("window_closed");
  }

  // Ensure no live change request already exists for this submission.
  const { data: dup } = await sb
    .from("squad_change_requests")
    .select("id")
    .eq("submission_id", v.submissionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (dup) throw new ConflictError("swap_already_used");

  // Verify referee has the perm.
  const { data: refRoles } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", v.authorizedByRefUserId)
    .is("deleted_at", null);
  const actor = {
    userId: v.authorizedByRefUserId,
    roles: (refRoles ?? []).map((r: { role: string }) => r.role),
  };
  if (!(await hasPermAsync(sb, actor, "squads.change_authorize"))) {
    throw new PermissionError("authorizing user lacks squads.change_authorize");
  }

  const { data: inserted, error: insErr } = await sb
    .from("squad_change_requests")
    .insert({
      submission_id: v.submissionId,
      player_out_name: v.playerOutName,
      player_out_item_id: v.playerOutItemId ?? null,
      player_in_name: v.playerIn.name,
      player_in_item_type: v.playerIn.itemType,
      player_in_rating: v.playerIn.rating,
      player_in_value: v.playerIn.value,
      player_in_nationality_flag: v.playerIn.nationalityFlag ?? null,
      authorized_by_ref_user_id: v.authorizedByRefUserId,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    throw new Error(`failed to insert change: ${insErr?.message}`);
  }

  // Soft-deactivate the out item so /players/[id] reflects the swap.
  if (v.playerOutItemId) {
    await sb
      .from("squad_player_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", v.playerOutItemId);
  }

  return { id: inserted.id };
}
