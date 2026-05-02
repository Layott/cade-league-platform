import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Per-match-day admin overrides for the squad submission DEADLINE +
 * change-window times. Layered ON TOP of the hardcoded defaults
 * (Thursday 10:00 WAT submission deadline + Friday 21:00-22:00 WAT
 * change window).
 *
 * Orthogonal to `squad_match_day_overrides` — that table flips
 * force_open / force_close. THIS module shifts the default time
 * boundaries without flipping the force toggle. An admin can use both
 * (e.g. force_open + extend deadline) at the same time; the resolver
 * applies them independently.
 *
 * Each of the three time columns is nullable so admin can shift just
 * one boundary (e.g. push the Thursday deadline to 18:00 but leave the
 * Friday change window alone).
 *
 * Mutations require `squads.window.manage` (admin / loc / referee, same
 * gate as squad_match_day_overrides + squad_window_overrides).
 */

export type MatchDayScheduleOverride = {
  id: string;
  matchDayId: string;
  submissionDeadlineAt: string | null;
  changeWindowOpenAt: string | null;
  changeWindowCloseAt: string | null;
  notes: string | null;
  setBy: string | null;
  setAt: string;
};

export type MatchDayScheduleOverrideInput = {
  submissionDeadlineAt: string | null;
  changeWindowOpenAt: string | null;
  changeWindowCloseAt: string | null;
  notes: string | null;
};

type Row = {
  id: string;
  match_day_id: string;
  submission_deadline_at: string | null;
  change_window_open_at: string | null;
  change_window_close_at: string | null;
  notes: string | null;
  set_by: string | null;
  set_at: string;
};

const SELECT_COLS =
  "id, match_day_id, submission_deadline_at, change_window_open_at, change_window_close_at, notes, set_by, set_at";

function toOverride(r: Row): MatchDayScheduleOverride {
  return {
    id: r.id,
    matchDayId: r.match_day_id,
    submissionDeadlineAt: r.submission_deadline_at,
    changeWindowOpenAt: r.change_window_open_at,
    changeWindowCloseAt: r.change_window_close_at,
    notes: r.notes,
    setBy: r.set_by,
    setAt: r.set_at,
  };
}

export async function getMatchDayScheduleOverride(
  sb: SupabaseClient,
  matchDayId: string,
): Promise<MatchDayScheduleOverride | null> {
  const { data, error } = await sb
    .from("match_day_schedule_overrides")
    .select(SELECT_COLS)
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getMatchDayScheduleOverride: ${error.message}`);
  return data ? toOverride(data as Row) : null;
}

export async function setMatchDayScheduleOverride(
  sb: SupabaseClient,
  actor: Actor,
  matchDayId: string,
  input: MatchDayScheduleOverrideInput,
): Promise<MatchDayScheduleOverride> {
  await requirePermAsync(sb, actor, "squads.window.manage");
  if (!actor.userId)
    throw new Error("setMatchDayScheduleOverride: no actor.userId");

  // Reject all-null payloads — saving an override with no time boundaries
  // is meaningless; admin should clear() instead.
  const noneSet =
    input.submissionDeadlineAt == null &&
    input.changeWindowOpenAt == null &&
    input.changeWindowCloseAt == null;
  if (noneSet) {
    throw new Error(
      "setMatchDayScheduleOverride: at least one time boundary must be set",
    );
  }

  // Sanity-check window ordering. Open MUST precede close (>= would
  // collapse the window to zero seconds).
  if (input.changeWindowOpenAt && input.changeWindowCloseAt) {
    const openMs = new Date(input.changeWindowOpenAt).getTime();
    const closeMs = new Date(input.changeWindowCloseAt).getTime();
    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) {
      throw new Error(
        "setMatchDayScheduleOverride: change_window_open_at + close_at must be valid ISO timestamps",
      );
    }
    if (openMs >= closeMs) {
      throw new Error(
        "setMatchDayScheduleOverride: change_window_open_at must be earlier than change_window_close_at",
      );
    }
  }

  const nowIso = new Date().toISOString();
  const row = {
    match_day_id: matchDayId,
    submission_deadline_at: input.submissionDeadlineAt,
    change_window_open_at: input.changeWindowOpenAt,
    change_window_close_at: input.changeWindowCloseAt,
    notes: input.notes,
    set_by: actor.userId,
    set_at: nowIso,
    updated_at: nowIso,
    deleted_at: null,
  };

  // SELECT-then-INSERT-or-UPDATE pattern — Supabase JS .upsert()
  // throws PG 42P10 against partial unique indexes. Same workaround as
  // upsertTextElement (commit 7dac90a0) + upsertAnimation (b2dd661d).
  const { data: existing } = await sb
    .from("match_day_schedule_overrides")
    .select("id")
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    const { data, error } = await sb
      .from("match_day_schedule_overrides")
      .update(row)
      .eq("id", (existing as { id: string }).id)
      .select(SELECT_COLS)
      .single();
    if (error)
      throw new Error(`setMatchDayScheduleOverride (update): ${error.message}`);
    return toOverride(data as Row);
  } else {
    const { data, error } = await sb
      .from("match_day_schedule_overrides")
      .insert(row)
      .select(SELECT_COLS)
      .single();
    if (error)
      throw new Error(`setMatchDayScheduleOverride (insert): ${error.message}`);
    return toOverride(data as Row);
  }
}

export async function clearMatchDayScheduleOverride(
  sb: SupabaseClient,
  actor: Actor,
  matchDayId: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "squads.window.manage");
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("match_day_schedule_overrides")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null);
  if (error) throw new Error(`clearMatchDayScheduleOverride: ${error.message}`);
}
