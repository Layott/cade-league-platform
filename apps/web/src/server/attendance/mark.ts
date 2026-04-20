import type { SupabaseClient } from "@supabase/supabase-js";
import { openAutoCase, type AttendanceStatus } from "./penalty";

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
  status: AttendanceStatus
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
  const deltaSeconds = Math.round((markedAt.getTime() - scheduledCall.getTime()) / 1000);

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
      `player ${input.playerId} already marked for match_day ${input.matchDayId} — use editMark`
    );
  }

  // 3. Open penalty case for late/absent. Skip the call entirely for present so
  //    the code path never touches disciplinary_cases/disciplinary_actions tables.
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

  // 4. Insert the mark row.
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
