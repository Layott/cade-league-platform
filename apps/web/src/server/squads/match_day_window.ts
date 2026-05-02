import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import { weekStartThursday } from "@/lib/time";
import { getSquadWindowOverride } from "./window_override";
import { getMatchDayScheduleOverride } from "./schedule_overrides";

/**
 * Per-match-day admin override for the squad submission window.
 *
 * Plan 10 keyed the squad window on `week_start_date` (Thursday anchor).
 * This module adds a parallel per-MATCH-DAY override so an admin can
 * reopen/close submissions for a specific match day independent of the
 * weekly cycle.
 *
 * Resolution order (strictest deny → strictest allow):
 *   1. Per-match-day override (if present + not soft-deleted) wins.
 *      - 'force_open'  → window open.
 *      - 'force_close' → window closed.
 *   2. Otherwise fall through to the weekly resolver in
 *      window_override.ts (default time-based + weekly admin override).
 *
 * Mutations require permission "squads.window.manage" (admin/loc/referee
 * — same seed as the weekly override, migration 20260514000100).
 */

export type SquadMatchDayWindow = {
  matchDayId: string;
  state: "force_open" | "force_close";
  note: string | null;
  setBy: string;
  setAt: string;
};

type Row = {
  match_day_id: string;
  state: "force_open" | "force_close";
  note: string | null;
  set_by: string;
  set_at: string;
};

function toWindow(r: Row): SquadMatchDayWindow {
  return {
    matchDayId: r.match_day_id,
    state: r.state,
    note: r.note,
    setBy: r.set_by,
    setAt: r.set_at,
  };
}

export async function getMatchDayWindow(
  sb: SupabaseClient,
  matchDayId: string,
): Promise<SquadMatchDayWindow | null> {
  const { data, error } = await sb
    .from("squad_match_day_overrides")
    .select("match_day_id, state, note, set_by, set_at")
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getMatchDayWindow: ${error.message}`);
  return data ? toWindow(data as Row) : null;
}

export async function setMatchDayWindow(
  sb: SupabaseClient,
  actor: Actor,
  matchDayId: string,
  state: "force_open" | "force_close",
  note?: string | null,
): Promise<SquadMatchDayWindow> {
  await requirePermAsync(sb, actor, "squads.window.manage");
  if (!actor.userId) throw new Error("setMatchDayWindow: no actor.userId");

  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("squad_match_day_overrides")
    .upsert(
      {
        match_day_id: matchDayId,
        state,
        note: note ?? null,
        set_by: actor.userId,
        set_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
      },
      { onConflict: "match_day_id" },
    )
    .select("match_day_id, state, note, set_by, set_at")
    .single();
  if (error) throw new Error(`setMatchDayWindow: ${error.message}`);
  return toWindow(data as Row);
}

export async function clearMatchDayWindow(
  sb: SupabaseClient,
  actor: Actor,
  matchDayId: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "squads.window.manage");
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("squad_match_day_overrides")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null);
  if (error) throw new Error(`clearMatchDayWindow: ${error.message}`);
}

/**
 * Result of resolving the squad submission window for a specific match day.
 *
 * `open` is the truthy answer the UI/submit-flow needs. `reason` is a
 * short machine-readable tag describing WHY (used for telemetry +
 * surfacing CTAs differently when the source is "match_day_force_open"
 * vs "weekly_default").
 *
 * `forceOpen` (2026-05-02 — bug "edit-always-when-window-open") flags
 * whether the open state was reached through an explicit admin force-
 * open (per-match-day OR per-week OR player-level), as opposed to the
 * ambient pre-deadline default. Callers that need to distinguish "admin
 * intent" from "still within Thursday window" — chiefly the re-submit
 * gate in `submit.ts` and the player-side picker CTA — read this flag
 * to decide whether to allow editing rejected/approved squads.
 */
export type SquadWindowResolution = {
  open: boolean;
  forceOpen: boolean;
  reason:
    | "match_day_force_open"
    | "match_day_force_close"
    | "weekly_force_open"
    | "weekly_force_close"
    | "weekly_default_open"
    | "weekly_default_closed";
};

/**
 * Resolve whether a player can submit a squad for the given match day.
 *
 * Precedence:
 *   1. Per-match-day override (force_open/force_close) wins outright.
 *   2. Else: look up the match day's date → derive Thursday anchor →
 *      apply the existing weekly resolver:
 *        a. weekly force_close → closed.
 *        b. weekly force_open  → open.
 *        c. else: open iff now < Thursday 10:00 WAT deadline.
 *
 * Pure function over Supabase reads — does NOT mutate. Callers gate the
 * actual submit through the existing `createSubmission` / `submitPickerSquad`
 * paths which still apply rule + rate-limit checks.
 */
export async function resolveSquadWindowForMatchDay(
  sb: SupabaseClient,
  matchDayId: string,
  opts: { now?: Date } = {},
): Promise<SquadWindowResolution> {
  const now = opts.now ?? new Date();

  // 1. Per-match-day override fast-path.
  const mdOverride = await getMatchDayWindow(sb, matchDayId);
  if (mdOverride?.state === "force_open") {
    return { open: true, forceOpen: true, reason: "match_day_force_open" };
  }
  if (mdOverride?.state === "force_close") {
    return { open: false, forceOpen: false, reason: "match_day_force_close" };
  }

  // 2. Fall through to weekly. Need the match day's date to derive the
  //    Thursday anchor. If the match day row is missing/deleted we treat
  //    the window as closed.
  const { data: md, error: mdErr } = await sb
    .from("match_days")
    .select("match_date")
    .eq("id", matchDayId)
    .is("deleted_at", null)
    .maybeSingle();
  if (mdErr || !md) {
    return { open: false, forceOpen: false, reason: "weekly_default_closed" };
  }
  const weekStart = weekStartThursday(md.match_date);
  const weekly = await getSquadWindowOverride(sb, weekStart);
  if (weekly?.state === "force_close") {
    return { open: false, forceOpen: false, reason: "weekly_force_close" };
  }
  if (weekly?.state === "force_open") {
    return { open: true, forceOpen: true, reason: "weekly_force_open" };
  }
  // Default time-based: open iff now < submission deadline. The default
  // is Thursday 10:00 WAT; admin can shift via match_day_schedule_overrides.
  const schedule = await getMatchDayScheduleOverride(sb, matchDayId);
  const deadline = schedule?.submissionDeadlineAt
    ? new Date(schedule.submissionDeadlineAt)
    : new Date(`${weekStart}T10:00:00+01:00`);
  if (now.getTime() < deadline.getTime()) {
    return { open: true, forceOpen: false, reason: "weekly_default_open" };
  }
  return { open: false, forceOpen: false, reason: "weekly_default_closed" };
}
