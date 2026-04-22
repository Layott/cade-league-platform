import type { SupabaseClient } from "@supabase/supabase-js";
import { publish } from "@/server/broadcast/realtime";
import { REALTIME } from "./registry";

/**
 * Plan 37 — match_clock server module.
 *
 * Server-config row (one per session). Client computes display via
 * `seconds_remaining - (now - set_at)` for countdown / `+` for countup.
 * Realtime broadcast fires only on edits — no per-tick stream.
 */

export type ClockMode = "countdown" | "countup" | "paused" | "stopped";

export type ClockState = {
  streamSessionId: string;
  mode: ClockMode;
  secondsRemaining: number;
  setAt: string;
  setBy: string | null;
  label: string | null;
  updatedAt: string;
  // Cached "what mode were we in before pause" so resume can flip back.
  // Stored alongside `mode='paused'` via the label workaround? No —
  // we infer: pauseClock writes mode='paused', resumeClock writes
  // 'countdown' if seconds_remaining > 0, otherwise 'countup'.
};

type ClockRow = {
  stream_session_id: string;
  mode: string;
  seconds_remaining: number;
  set_at: string;
  set_by: string | null;
  label: string | null;
  updated_at: string;
};

function toState(r: ClockRow): ClockState {
  return {
    streamSessionId: r.stream_session_id,
    mode: r.mode as ClockMode,
    secondsRemaining: r.seconds_remaining,
    setAt: r.set_at,
    setBy: r.set_by,
    label: r.label,
    updatedAt: r.updated_at,
  };
}

export async function getClock(
  sb: SupabaseClient,
  sessionId: string,
): Promise<ClockState | null> {
  const { data, error } = await sb
    .from("match_clock")
    .select(
      "stream_session_id, mode, seconds_remaining, set_at, set_by, label, updated_at",
    )
    .eq("stream_session_id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getClock failed: ${error.message}`);
  return data ? toState(data as ClockRow) : null;
}

async function publishClock(
  sb: SupabaseClient,
  sessionId: string,
  state: ClockState,
): Promise<void> {
  try {
    await publish(sb, sessionId, REALTIME.eventClockChanged, {
      mode: state.mode,
      secondsRemaining: state.secondsRemaining,
      setAt: state.setAt,
      label: state.label,
    });
  } catch {
    // swallow
  }
}

async function upsertClock(
  sb: SupabaseClient,
  sessionId: string,
  patch: {
    mode: ClockMode;
    secondsRemaining: number;
    setAt: string;
    label?: string | null;
    userId: string;
  },
): Promise<ClockState> {
  const row = {
    stream_session_id: sessionId,
    mode: patch.mode,
    seconds_remaining: Math.max(0, Math.min(359999, Math.round(patch.secondsRemaining))),
    set_at: patch.setAt,
    set_by: patch.userId,
    label: patch.label === undefined ? null : patch.label,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from("match_clock")
    .upsert(row, { onConflict: "stream_session_id" })
    .select(
      "stream_session_id, mode, seconds_remaining, set_at, set_by, label, updated_at",
    )
    .single();
  if (error || !data) {
    throw new Error(`upsertClock failed: ${error?.message ?? "no row"}`);
  }
  const state = toState(data as ClockRow);
  await publishClock(sb, sessionId, state);
  return state;
}

export async function setClock(
  sb: SupabaseClient,
  sessionId: string,
  input: {
    mode: ClockMode;
    secondsRemaining: number;
    label?: string | null;
    userId: string;
  },
): Promise<ClockState> {
  return upsertClock(sb, sessionId, {
    mode: input.mode,
    secondsRemaining: input.secondsRemaining,
    setAt: new Date().toISOString(),
    label: input.label,
    userId: input.userId,
  });
}

export async function startClock(
  sb: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<ClockState> {
  const cur = await getClock(sb, sessionId);
  // Default to countdown if there's a remaining > 0, else countup from 0.
  const mode: ClockMode =
    cur && cur.secondsRemaining > 0 ? "countdown" : "countup";
  return upsertClock(sb, sessionId, {
    mode,
    secondsRemaining: cur?.secondsRemaining ?? 0,
    setAt: new Date().toISOString(),
    label: cur?.label ?? null,
    userId,
  });
}

function computeDisplay(state: ClockState, nowMs: number): number {
  const elapsedSec = Math.floor((nowMs - new Date(state.setAt).getTime()) / 1000);
  if (state.mode === "countdown") {
    return Math.max(0, state.secondsRemaining - Math.max(0, elapsedSec));
  }
  if (state.mode === "countup") {
    return Math.max(0, state.secondsRemaining + Math.max(0, elapsedSec));
  }
  // paused / stopped
  return state.secondsRemaining;
}

export async function pauseClock(
  sb: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<ClockState> {
  const cur = await getClock(sb, sessionId);
  if (!cur) throw new Error(`no clock for session: ${sessionId}`);
  const display = computeDisplay(cur, Date.now());
  return upsertClock(sb, sessionId, {
    mode: "paused",
    secondsRemaining: display,
    setAt: new Date().toISOString(),
    label: cur.label,
    userId,
  });
}

export async function resumeClock(
  sb: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<ClockState> {
  const cur = await getClock(sb, sessionId);
  if (!cur) throw new Error(`no clock for session: ${sessionId}`);
  // Resume into countdown if remaining > 0, else countup from current value.
  const mode: ClockMode = cur.secondsRemaining > 0 ? "countdown" : "countup";
  return upsertClock(sb, sessionId, {
    mode,
    secondsRemaining: cur.secondsRemaining,
    setAt: new Date().toISOString(),
    label: cur.label,
    userId,
  });
}

export async function adjustClock(
  sb: SupabaseClient,
  sessionId: string,
  deltaSeconds: number,
  userId: string,
): Promise<ClockState> {
  const cur = await getClock(sb, sessionId);
  if (!cur) throw new Error(`no clock for session: ${sessionId}`);
  const display = computeDisplay(cur, Date.now());
  const next = Math.max(0, display + deltaSeconds);
  return upsertClock(sb, sessionId, {
    mode: cur.mode,
    secondsRemaining: next,
    setAt: new Date().toISOString(),
    label: cur.label,
    userId,
  });
}

export async function resetClock(
  sb: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<ClockState> {
  return upsertClock(sb, sessionId, {
    mode: "stopped",
    secondsRemaining: 0,
    setAt: new Date().toISOString(),
    label: null,
    userId,
  });
}
