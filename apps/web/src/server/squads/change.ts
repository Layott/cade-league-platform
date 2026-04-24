import type { SupabaseClient } from "@supabase/supabase-js";
import { changeSchema, type ChangeInput } from "./schemas";
import { ConflictError, ValidationError, PermissionError } from "./errors";
import { isWithinFridayWindow } from "./week";
import { hasPermAsync } from "@/lib/perms-db";

/**
 * Plan 10 (extended 2026-04-24) — Friday 21:00-22:00 WAT change request.
 *
 * A single request row may express any combination of:
 *   1. Formation change (newFormation).
 *   2. Slot rearrangement (newSlotPlan — same 11 cards, different pitch positions).
 *   3. At most ONE card swap (playerOutItemId/playerOutName + playerIn).
 *
 * Guards (strict server-side):
 *   1. Zod (schema enforces at-least-one intent + mutual consistency).
 *   2. Submission exists + validation_status='approved'.
 *   3. now ∈ [openAt, closeAt) of the Friday window for that weekStart.
 *   4. No existing live squad_change_requests row for this submission.
 *   5. authorizedByRefUserId resolves to a user who currently has
 *      `squads.change_authorize` permission.
 *   6. If newSlotPlan is provided: every `existing` item id must belong
 *      to the submission's live starting XI (slot_index 0..10).
 *   7. At most ONE new card introduced (newSlotPlan may have 0 or 1
 *      kind='new' entries; that cardinality matches playerIn presence).
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

  // If a slot plan was submitted, verify every `existing` itemId is a
  // live starting-XI item on this submission. Catches: stale itemIds,
  // subs being promoted to XI (not allowed — a subs-to-XI swap requires
  // the single-swap path through playerIn), cross-submission forgery.
  if (v.newSlotPlan) {
    const existingIds = v.newSlotPlan
      .filter((e) => e.kind === "existing")
      .map((e) => (e as { kind: "existing"; itemId: string }).itemId);
    const { data: items, error: itemsErr } = await sb
      .from("squad_player_items")
      .select("id, slot_index")
      .eq("submission_id", v.submissionId)
      .is("deleted_at", null);
    if (itemsErr) {
      throw new Error(`failed to hydrate items: ${itemsErr.message}`);
    }
    const startingXI = new Set(
      (items ?? [])
        .filter((it: { slot_index: number }) => it.slot_index <= 10)
        .map((it: { id: string }) => it.id),
    );
    for (const id of existingIds) {
      if (!startingXI.has(id)) {
        throw new ValidationError(
          `newSlotPlan references item ${id} which is not in the starting XI of this submission`,
        );
      }
    }

    // If no swap is happening, the plan must contain the same starters
    // currently in the XI (just possibly reordered). An "existing" slot
    // plan that drops a player without adding one is invalid.
    const planExistingSet = new Set(existingIds);
    const currentXICount = startingXI.size;
    const expectedExisting = v.playerIn ? currentXICount - 1 : currentXICount;
    if (planExistingSet.size !== expectedExisting) {
      throw new ValidationError(
        `newSlotPlan references ${planExistingSet.size} distinct existing items; expected ${expectedExisting}`,
      );
    }
  }

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
      player_out_name: v.playerOutName ?? null,
      player_out_item_id: v.playerOutItemId ?? null,
      player_in_name: v.playerIn?.name ?? null,
      player_in_item_type: v.playerIn?.itemType ?? null,
      player_in_rating: v.playerIn?.rating ?? null,
      player_in_value: v.playerIn?.value ?? null,
      player_in_nationality_flag: v.playerIn?.nationalityFlag ?? null,
      new_formation: v.newFormation ?? null,
      new_slot_positions: v.newSlotPlan ?? null,
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
