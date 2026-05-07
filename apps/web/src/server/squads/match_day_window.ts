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
 *
 * `effectiveDeadlineAt` (2026-05-07 — fix for "10am Thursday is still
 * there") is the time-based deadline the resolver actually uses,
 * including any `match_day_schedule_overrides.submission_deadline_at`
 * shift. Surfaces in player UI copy so admins who push the deadline see
 * the new time rendered, not the hardcoded Thursday 10:00 default.
 *
 * `adminNote` carries the override row's note when the open/closed
 * decision came from an admin override (per-MD or weekly). Player UI
 * surfaces it in the closed-panel + force-open banner so the player
 * understands why the window flipped from default.
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
    | "weekly_default_closed"
    | "schedule_not_open_yet";
  effectiveDeadlineAt: string;
  // 2026-05-07 — admin-set OPEN time from match_day_schedule_overrides.
  // null = open from forever; non-null + now < openAt → reason
  // 'schedule_not_open_yet'. Player UI shows "Submissions open <X>"
  // until openAt elapses.
  effectiveOpenAt: string | null;
  adminNote: string | null;
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

  // 1. Pull every dependency up-front so the result can carry the effective
  //    deadline (including any schedule override) regardless of whether the
  //    force-toggle short-circuits the time check below. Player UI copy
  //    needs the deadline string in BOTH force-open + default paths.
  const [mdOverride, mdRow] = await Promise.all([
    getMatchDayWindow(sb, matchDayId),
    sb
      .from("match_days")
      .select("match_date")
      .eq("id", matchDayId)
      .is("deleted_at", null)
      .maybeSingle()
      .then((r) => r.data as { match_date: string } | null),
  ]);

  // Match-day row missing → treat as closed; we have no week anchor to
  // compute a deadline so use `now` as a sentinel. Callers that hit this
  // branch normally render a 404 — the deadline value is purely cosmetic.
  if (!mdRow) {
    return {
      open: false,
      forceOpen: false,
      reason: "weekly_default_closed",
      effectiveDeadlineAt: now.toISOString(),
      effectiveOpenAt: null,
      adminNote: null,
    };
  }

  const weekStart = weekStartThursday(mdRow.match_date);
  const schedule = await getMatchDayScheduleOverride(sb, matchDayId);
  const effectiveDeadline = schedule?.submissionDeadlineAt
    ? new Date(schedule.submissionDeadlineAt)
    : new Date(`${weekStart}T10:00:00+01:00`);
  const effectiveDeadlineAt = effectiveDeadline.toISOString();
  // 2026-05-07 — admin OPEN-AT gate. NULL preserves prior behaviour
  // (open from forever); non-null gates `now < openAt` as closed in
  // the time-based branch with reason `schedule_not_open_yet`.
  const effectiveOpenAt = schedule?.submissionOpenAt ?? null;

  // 2. Per-match-day force toggle wins outright. Carry the admin note
  //    + the resolved time-based deadline so the UI can still show
  //    "force-opened until <default deadline>".
  if (mdOverride?.state === "force_open") {
    return {
      open: true,
      forceOpen: true,
      reason: "match_day_force_open",
      effectiveDeadlineAt,
      effectiveOpenAt,
      adminNote: mdOverride.note,
    };
  }
  if (mdOverride?.state === "force_close") {
    return {
      open: false,
      forceOpen: false,
      reason: "match_day_force_close",
      effectiveDeadlineAt,
      effectiveOpenAt,
      adminNote: mdOverride.note,
    };
  }

  // 3. Weekly override is next.
  const weekly = await getSquadWindowOverride(sb, weekStart);
  if (weekly?.state === "force_close") {
    return {
      open: false,
      forceOpen: false,
      reason: "weekly_force_close",
      effectiveDeadlineAt,
      effectiveOpenAt,
      adminNote: weekly.note,
    };
  }
  if (weekly?.state === "force_open") {
    return {
      open: true,
      forceOpen: true,
      reason: "weekly_force_open",
      effectiveDeadlineAt,
      effectiveOpenAt,
      adminNote: weekly.note,
    };
  }

  // 4. Schedule-driven OPEN-AT gate. If admin set submission_open_at
  //    and we're before it, the window is closed for time-based reason
  //    'schedule_not_open_yet' (distinct from past-deadline closed).
  if (effectiveOpenAt && now.getTime() < new Date(effectiveOpenAt).getTime()) {
    return {
      open: false,
      forceOpen: false,
      reason: "schedule_not_open_yet",
      effectiveDeadlineAt,
      effectiveOpenAt,
      adminNote: schedule?.notes ?? null,
    };
  }

  // 5. Default time-based: open iff now < effective deadline.
  if (now.getTime() < effectiveDeadline.getTime()) {
    return {
      open: true,
      forceOpen: false,
      reason: "weekly_default_open",
      effectiveDeadlineAt,
      effectiveOpenAt,
      adminNote: null,
    };
  }
  return {
    open: false,
    forceOpen: false,
    reason: "weekly_default_closed",
    effectiveDeadlineAt,
    effectiveOpenAt,
    adminNote: null,
  };
}
