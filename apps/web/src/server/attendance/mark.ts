import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { openAutoCase, type AttendanceStatus } from "./penalty";
import { applyForfeitMatchResult } from "@/server/punishments";

// Plan 39 sanitize — alnum/hyphen/underscore guard for `.or()` filter
// interpolation. See server/profile/h2h.ts for rationale.
const safeIdRegex = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "id contains forbidden characters");

export type MarkInput = {
  matchDayId: string;
  playerId: string;
  actorUserId: string;
};

export type MarkResult = { id: string; status: AttendanceStatus };

export class ConflictError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ConflictError";
  }
}

async function doMark(
  sb: SupabaseClient,
  input: MarkInput,
  status: AttendanceStatus,
): Promise<MarkResult> {
  // 1. Look up match_day for scheduled_call_time context.
  const { data: md, error: mdErr } = await sb
    .from("match_days")
    .select("match_date, match_start_time, arrival_cutoff_time")
    .eq("id", input.matchDayId)
    .single();
  if (mdErr || !md) throw new Error(`match_day not found: ${input.matchDayId}`);

  // scheduled_call_time = match_date @ arrival_cutoff_time (WAT). Store as ISO UTC.
  // Africa/Lagos is UTC+1 year-round (no DST), so we can form the timestamptz directly.
  const scheduledCall = new Date(`${md.match_date}T${md.arrival_cutoff_time}+01:00`);
  const markedAt = new Date();
  // Clamp delta to 32-bit int range. Plan 5 stores delta_seconds as int; values
  // outside that range only happen for test-fixture dates far in the future/past
  // but we defensively cap to avoid any possible overflow.
  const INT32_MAX = 2_147_483_647;
  const rawDelta = Math.round((markedAt.getTime() - scheduledCall.getTime()) / 1000);
  const deltaSeconds = Math.max(-INT32_MAX, Math.min(INT32_MAX, rawDelta));

  // 2. Refuse if already marked — caller must use editMark.
  const { data: existing } = await sb
    .from("attendance_marks")
    .select("id")
    .eq("match_day_id", input.matchDayId)
    .eq("player_id", input.playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) {
    throw new ConflictError(
      `player ${input.playerId} already marked for match_day ${input.matchDayId} — use editMark`,
    );
  }

  // 3. Open penalty case for late/absent via the Rule 5.4 ladder. Skip the
  //    call entirely for 'present' so the code path never touches
  //    disciplinary tables.
  const auto =
    status === "present"
      ? null
      : await openAutoCase(sb, {
          playerId: input.playerId,
          status,
          matchDayId: input.matchDayId,
          actorUserId: input.actorUserId,
          effectiveDate: md.match_date,
        });

  // 3a. Apply auto-forfeit if the ladder demands it (absence). Find the
  //     player's scheduled match on this match day; if found, apply 3-0.
  if (auto?.outcome.autoForfeit) {
    // Plan 39 sanitize — alnum/hyphen/underscore-only validate before
    // composing into a `.or()` filter. PostgREST punctuation (comma,
    // dot, paren, equals) is rejected so the playerId can't break out
    // of the filter expression.
    const safePlayerId = safeIdRegex.parse(input.playerId);
    const { data: match } = await sb
      .from("matches")
      .select("id")
      .eq("match_day_id", input.matchDayId)
      .or(`home_player_id.eq.${safePlayerId},away_player_id.eq.${safePlayerId}`)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (match?.id) {
      await applyForfeitMatchResult(
        sb,
        match.id as string,
        input.playerId,
        input.actorUserId,
      );
    }
  }

  // 4. Insert the mark row. auto_case_id / auto_action_id reference the
  //    ladder-created case and "dominant" action (point_deduction first,
  //    then gd_deduction, then ban). Additional actions from the same
  //    ladder event are discoverable via disciplinary_cases.id.
  const { data: inserted, error: insErr } = await sb
    .from("attendance_marks")
    .insert({
      match_day_id: input.matchDayId,
      player_id: input.playerId,
      status,
      marked_at: markedAt.toISOString(),
      marked_by: input.actorUserId,
      scheduled_call_time: scheduledCall.toISOString(),
      delta_seconds: deltaSeconds,
      auto_case_id: auto?.caseId ?? null,
      auto_action_id: auto?.actionId ?? null,
    })
    .select("id")
    .single();
  if (insErr || !inserted) throw new Error(`failed to insert mark: ${insErr?.message}`);

  return { id: inserted.id, status };
}

export async function markPresent(sb: SupabaseClient, input: MarkInput): Promise<MarkResult> {
  return doMark(sb, input, "present");
}

export async function markLate(sb: SupabaseClient, input: MarkInput): Promise<MarkResult> {
  return doMark(sb, input, "late");
}

export async function markAbsent(sb: SupabaseClient, input: MarkInput): Promise<MarkResult> {
  return doMark(sb, input, "absent");
}
