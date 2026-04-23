import type { SupabaseClient } from "@supabase/supabase-js";
import { createSubmissionSchema, type CreateSubmissionInput } from "./schemas";
import { ConflictError, ValidationError } from "./errors";
import { thursdayDeadline, weekStartThursday } from "./week";
import { getSquadWindowOverride } from "./window_override";
import { getPlayerSquadOverride } from "./player_override";
import { getRuleForSeason } from "./rules";
import { evaluateRules, type ItemForValidation } from "./validate";

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

  // Resolve the current squad-window state for this player + week. Order of
  // precedence (strictest deny → strictest allow):
  //   1. Player ban              → deny outright.
  //   2. League force_close      → deny.
  //   3. Player force_open       → allow regardless of time.
  //   4. League force_open       → allow regardless of time.
  //   5. Default: allow iff now < Thursday 10:00 WAT deadline.
  const [leagueOverride, playerOverride] = await Promise.all([
    getSquadWindowOverride(sb, v.weekStartDate),
    getPlayerSquadOverride(sb, v.playerId, v.weekStartDate),
  ]);
  const deadline = thursdayDeadline(v.weekStartDate);
  const beforeDeadline = now.getTime() < deadline.getTime();

  if (playerOverride?.state === "ban") {
    throw new ConflictError(
      `player ${v.playerId} is banned from submitting for week ${v.weekStartDate}`,
    );
  }
  if (leagueOverride?.state === "force_close" && playerOverride?.state !== "force_open") {
    throw new ConflictError(
      `squad window is closed for week ${v.weekStartDate}`,
    );
  }
  const windowOpen =
    playerOverride?.state === "force_open" ||
    leagueOverride?.state === "force_open" ||
    beforeDeadline;

  // Check for an existing live submission.
  const { data: existing } = await sb
    .from("squad_submissions")
    .select("id, validation_status")
    .eq("player_id", v.playerId)
    .eq("week_start_date", v.weekStartDate)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    // Pre-deadline (or force-open) re-submissions: soft-delete the old
    // submission + its items, then insert a fresh one below. Only allowed
    // when the submission is still pending — approved/rejected go through
    // the admin reopen path (Plan 41).
    const canReplace = windowOpen && existing.validation_status === "pending";
    if (!canReplace) {
      throw new ConflictError(
        `submission already exists for player ${v.playerId} week ${v.weekStartDate} (status=${existing.validation_status})`,
      );
    }
    const nowIso = new Date().toISOString();
    await sb
      .from("squad_player_items")
      .update({ deleted_at: nowIso })
      .eq("submission_id", existing.id)
      .is("deleted_at", null);
    await sb
      .from("squad_submissions")
      .update({ deleted_at: nowIso })
      .eq("id", existing.id);
  } else if (!windowOpen) {
    // No existing submission + past the deadline + no override → deny.
    throw new ConflictError(
      `squad submission window has closed for week ${v.weekStartDate}`,
    );
  }

  // Rule enforcement: load the season's active validation rules and run
  // evaluateRules(). Any violation refuses the submission. Without this
  // guard the UI's "over budget" / "short Nigerian" / "banned type" warnings
  // are advisory only — a player with JS disabled or a tampered request
  // could land an invalid squad as pending.
  const rule = await getRuleForSeason(sb, v.seasonId);
  if (rule) {
    const itemsForRules: ItemForValidation[] = v.items.map((it) => ({
      name: it.name,
      rating: it.rating,
      position: it.position,
      value: it.value,
      itemType: it.itemType,
      nationalityFlag: it.nationalityFlag ?? null,
      slotIndex: it.slotIndex,
    }));
    const result = evaluateRules(itemsForRules, {
      maxBudgetCoins: rule.max_budget_coins,
      minNigerianItems: rule.min_nigerian_items,
      bannedItemTypes: rule.banned_item_types,
    });
    if (!result.ok) {
      const first = result.violations[0];
      const summary =
        first.code === "budget_exceeded"
          ? `budget exceeded: ${first.totalValue.toLocaleString()} > ${first.maxBudgetCoins.toLocaleString()}`
          : first.code === "missing_nigerian_items"
            ? `not enough Nigerian items: ${first.actualCount} of ${first.required} in starting XI`
            : first.code === "banned_item_type"
              ? `banned item type '${first.itemType}' in slot ${first.slotIndex} (${first.itemName})`
              : `starting XI incomplete: ${first.filledSlots}/${first.required}`;
      throw new ValidationError(
        `squad violates league rules — ${summary}${result.violations.length > 1 ? ` (+${result.violations.length - 1} more)` : ""}`,
      );
    }
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
  sb: SupabaseClient,
  submissionId: string,
): Promise<void> {
  // Intentionally a no-op in Phase 1B. See plan §4.4 note.
  void sb;
  void submissionId;
}
