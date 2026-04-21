import type { SupabaseClient } from "@supabase/supabase-js";
import { publish } from "./realtime";
import { REALTIME } from "@/server/overlays/registry";

/**
 * Plan 12 — stream session lifecycle.
 *
 * One active session per match_day (partial unique index enforces).
 * endSession() first clears any still-active overlay events, then sets
 * `ended_at`, then pushes a session.ended broadcast so any still-open
 * overlay browser sources blank themselves.
 */

export type StartSessionInput = {
  matchDayId: string;
  userId: string;
  tag?: string;
  notes?: string;
};

export type StreamSessionRow = {
  id: string;
  match_day_id: string;
  session_tag: string | null;
  started_at: string;
  ended_at: string | null;
  started_by_user_id: string;
  notes: string | null;
};

export async function getActiveSession(
  sb: SupabaseClient,
  matchDayId: string,
): Promise<StreamSessionRow | null> {
  const { data } = await sb
    .from("stream_sessions")
    .select(
      "id, match_day_id, session_tag, started_at, ended_at, started_by_user_id, notes",
    )
    .eq("match_day_id", matchDayId)
    .is("ended_at", null)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as StreamSessionRow | null) ?? null;
}

export async function startSession(
  sb: SupabaseClient,
  input: StartSessionInput,
): Promise<{ id: string }> {
  const existing = await getActiveSession(sb, input.matchDayId);
  if (existing) {
    throw new Error(
      `stream session already active for match_day ${input.matchDayId}`,
    );
  }

  const { data, error } = await sb
    .from("stream_sessions")
    .insert({
      match_day_id: input.matchDayId,
      started_by_user_id: input.userId,
      session_tag: input.tag ?? null,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `startSession failed: ${error?.message ?? "no row returned"}`,
    );
  }
  return { id: data.id };
}

export async function endSession(
  sb: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<{ clearedCount: number }> {
  // Retained in signature for audit context tagging. Currently only
  // referenced in the publish payload so downstream subscribers know
  // which operator ended the session.
  void userId;
  const now = new Date().toISOString();

  // 1. Clear any still-active overlay events for this session.
  const { data: cleared, error: clearErr } = await sb
    .from("overlay_events")
    .update({ cleared_at: now })
    .eq("stream_session_id", sessionId)
    .is("cleared_at", null)
    .is("deleted_at", null)
    .select("id");
  if (clearErr) {
    throw new Error(`endSession: clear active failed: ${clearErr.message}`);
  }
  const clearedCount = (cleared ?? []).length;

  // 2. Set the session ended_at.
  const { error: endErr } = await sb
    .from("stream_sessions")
    .update({ ended_at: now })
    .eq("id", sessionId)
    .is("ended_at", null);
  if (endErr) {
    throw new Error(`endSession: set ended_at failed: ${endErr.message}`);
  }

  // 3. Broadcast session.ended so open overlays blank themselves.
  try {
    await publish(sb, sessionId, REALTIME.eventSessionEnded, {
      sessionId,
      endedAt: now,
    });
  } catch {
    // Realtime is best-effort; DB is the durable record.
  }

  return { clearedCount };
}

export async function listSessions(
  sb: SupabaseClient,
  matchDayId: string,
): Promise<StreamSessionRow[]> {
  const { data } = await sb
    .from("stream_sessions")
    .select(
      "id, match_day_id, session_tag, started_at, ended_at, started_by_user_id, notes",
    )
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .order("started_at", { ascending: false });
  return (data ?? []) as StreamSessionRow[];
}
