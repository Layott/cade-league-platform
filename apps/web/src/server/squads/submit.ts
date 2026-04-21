import type { SupabaseClient } from "@supabase/supabase-js";
import { createSubmissionSchema, type CreateSubmissionInput } from "./schemas";
import { ConflictError, ValidationError } from "./errors";
import { weekStartThursday } from "./week";

/**
 * Plan 10 — createSubmission writes one squad_submissions row + N
 * squad_player_items rows. Returns the submission id on success.
 *
 * Guards:
 *   1. Input validates against Zod (schema-level).
 *   2. weekStartDate must equal the current Thursday anchor.
 *   3. No non-deleted submission may exist for (player_id, week_start_date).
 *   4. Permission check is the caller's responsibility (route handler) — by
 *      the time we reach this module we assume actor has `squads.submit.own`
 *      and owns the target player, OR has `squads.validate`.
 */

export type CreateSubmissionResult = { id: string };

export async function createSubmission(
  sb: SupabaseClient,
  input: CreateSubmissionInput,
  opts: { now?: Date } = {},
): Promise<CreateSubmissionResult> {
  const parsed = createSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "invalid input");
  }
  const v = parsed.data;

  const now = opts.now ?? new Date();
  const expectedWeek = weekStartThursday(now);
  if (v.weekStartDate !== expectedWeek) {
    throw new ValidationError(
      `weekStartDate ${v.weekStartDate} does not match current week anchor ${expectedWeek}`,
    );
  }

  // Refuse duplicate live submission.
  const { data: existing } = await sb
    .from("squad_submissions")
    .select("id")
    .eq("player_id", v.playerId)
    .eq("week_start_date", v.weekStartDate)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) {
    throw new ConflictError(
      `submission already exists for player ${v.playerId} week ${v.weekStartDate}`,
    );
  }

  const { data: inserted, error: insErr } = await sb
    .from("squad_submissions")
    .insert({
      season_id: v.seasonId,
      player_id: v.playerId,
      week_start_date: v.weekStartDate,
      futbin_screenshot_path: v.futbinScreenshotPath,
      validation_status: "pending",
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    throw new Error(`failed to insert submission: ${insErr?.message ?? "no data"}`);
  }

  const rows = v.items.map((it) => ({
    submission_id: inserted.id,
    name: it.name,
    rating: it.rating,
    position: it.position,
    value: it.value,
    item_type: it.itemType,
    nationality_flag: it.nationalityFlag ?? null,
    slot_index: it.slotIndex,
  }));

  const { error: itemsErr } = await sb.from("squad_player_items").insert(rows);
  if (itemsErr) {
    // Clean up the submission row so we don't leak orphaned submissions.
    await sb.from("squad_submissions").delete().eq("id", inserted.id);
    throw new Error(`failed to insert items: ${itemsErr.message}`);
  }

  return { id: inserted.id };
}

/**
 * Lock a submission to `pending`→`pending` (no-op) — kept as a shape-holder
 * for a future Plan 1C "lock" status if we split submit vs. final. Today the
 * insert itself is the lock (unique partial index enforces one live row).
 */
export async function lockSubmission(
  _sb: SupabaseClient,
  _submissionId: string,
): Promise<void> {
  // Intentionally a no-op in Phase 1B. See plan §4.4 note.
}
