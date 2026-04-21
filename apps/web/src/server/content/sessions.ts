import type { SupabaseClient } from "@supabase/supabase-js";
import {
  scheduleSessionSchema,
  markSessionAttendanceSchema,
  scheduleMakeupSchema,
  markMakeupAttendanceSchema,
  type ScheduleSessionInput,
  type MarkSessionAttendanceInput,
  type ScheduleMakeupInput,
  type MarkMakeupAttendanceInput,
} from "./schemas";

export class ContentSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentSessionError";
  }
}

export type ContentSessionRow = {
  id: string;
  match_day_id: string;
  player_id: string;
  scheduled_time: string;
  attended_bool: boolean;
  makeup_session_scheduled_at: string | null;
  makeup_attended_bool: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export async function scheduleSession(
  sb: SupabaseClient,
  raw: ScheduleSessionInput,
): Promise<ContentSessionRow> {
  const input = scheduleSessionSchema.parse(raw);
  const { data, error } = await sb
    .from("content_sessions")
    .insert({
      match_day_id: input.matchDayId,
      player_id: input.playerId,
      scheduled_time: input.scheduledTime,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new ContentSessionError(
      `scheduleSession: ${error?.message ?? "unknown"}`,
    );
  }
  return data as ContentSessionRow;
}

export async function markAttendance(
  sb: SupabaseClient,
  raw: MarkSessionAttendanceInput,
): Promise<ContentSessionRow> {
  const input = markSessionAttendanceSchema.parse(raw);
  const { data, error } = await sb
    .from("content_sessions")
    .update({
      attended_bool: input.attended,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId)
    .select("*")
    .single();
  if (error || !data) {
    throw new ContentSessionError(
      `markAttendance: ${error?.message ?? "unknown"}`,
    );
  }
  return data as ContentSessionRow;
}

/**
 * Schedule a makeup session. Only valid if the primary attendance is false —
 * server enforces this even though the DB CHECK will also reject.
 */
export async function scheduleMakeup(
  sb: SupabaseClient,
  raw: ScheduleMakeupInput,
): Promise<ContentSessionRow> {
  const input = scheduleMakeupSchema.parse(raw);

  const { data: cur, error: readErr } = await sb
    .from("content_sessions")
    .select("id, attended_bool")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (readErr) {
    throw new ContentSessionError(`scheduleMakeup read: ${readErr.message}`);
  }
  if (!cur) {
    throw new ContentSessionError(`session not found: ${input.sessionId}`);
  }
  const c = cur as { id: string; attended_bool: boolean };
  if (c.attended_bool) {
    throw new ContentSessionError(
      "cannot schedule makeup when primary session was attended",
    );
  }

  const { data, error } = await sb
    .from("content_sessions")
    .update({
      makeup_session_scheduled_at: input.makeupSessionScheduledAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId)
    .select("*")
    .single();
  if (error || !data) {
    throw new ContentSessionError(
      `scheduleMakeup: ${error?.message ?? "unknown"}`,
    );
  }
  return data as ContentSessionRow;
}

export async function markMakeupAttendance(
  sb: SupabaseClient,
  raw: MarkMakeupAttendanceInput,
): Promise<ContentSessionRow> {
  const input = markMakeupAttendanceSchema.parse(raw);
  const { data, error } = await sb
    .from("content_sessions")
    .update({
      makeup_attended_bool: input.attended,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId)
    .select("*")
    .single();
  if (error || !data) {
    throw new ContentSessionError(
      `markMakeupAttendance: ${error?.message ?? "unknown"}`,
    );
  }
  return data as ContentSessionRow;
}

export async function listByMatchDay(
  sb: SupabaseClient,
  matchDayId: string,
): Promise<ContentSessionRow[]> {
  const { data, error } = await sb
    .from("content_sessions")
    .select("*")
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .order("scheduled_time", { ascending: true });
  if (error) {
    throw new ContentSessionError(`listByMatchDay: ${error.message}`);
  }
  return (data ?? []) as ContentSessionRow[];
}
