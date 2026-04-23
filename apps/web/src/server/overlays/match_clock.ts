import type { SupabaseClient } from "@supabase/supabase-js";
import { publish } from "@/server/broadcast/realtime";
import { REALTIME } from "./registry";

/**
 * Plan 37 — match_clock server module (per-session, single clock).
 * Plan 48.1 — instance-keyed: multiple clocks per session, addressed by
 * (sessionId, instanceKey). Default instanceKey = 'primary' so old
 * callers still work against the same row.
 */

export type ClockMode = "countdown" | "countup" | "paused" | "stopped";

export type ClockState = {
  streamSessionId: string;
  instanceKey: string;
  mode: ClockMode;
  secondsRemaining: number;
  setAt: string;
  setBy: string | null;
  label: string | null;
  updatedAt: string;
};

type ClockRow = {
  stream_session_id: string;
  instance_key: string;
  mode: string;
  seconds_remaining: number;
  set_at: string;
  set_by: string | null;
  label: string | null;
  updated_at: string;
};

const DEFAULT_KEY = "primary";
function norm(k: string | undefined | null): string {
  const v = (k ?? DEFAULT_KEY).trim();
  return v || DEFAULT_KEY;
}

function toState(r: ClockRow): ClockState {
  return {
    streamSessionId: r.stream_session_id,
    instanceKey: r.instance_key,
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
  instanceKey?: string,
): Promise<ClockState | null> {
  const key = norm(instanceKey);
  const { data, error } = await sb
    .from("match_clock")
    .select(
      "stream_session_id, instance_key, mode, seconds_remaining, set_at, set_by, label, updated_at",
    )
    .eq("stream_session_id", sessionId)
    .eq("instance_key", key)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getClock failed: ${error.message}`);
  return data ? toState(data as ClockRow) : null;
}

export async function listClocks(
  sb: SupabaseClient,
  sessionId: string,
): Promise<ClockState[]> {
  const { data, error } = await sb
    .from("match_clock")
    .select(
      "stream_session_id, instance_key, mode, seconds_remaining, set_at, set_by, label, updated_at",
    )
    .eq("stream_session_id", sessionId)
    .is("deleted_at", null)
    .order("instance_key", { ascending: true });
  if (error) throw new Error(`listClocks failed: ${error.message}`);
  return (data ?? []).map((r) => toState(r as ClockRow));
}

async function publishClock(
  sb: SupabaseClient,
  sessionId: string,
  state: ClockState,
): Promise<void> {
  try {
    await publish(sb, sessionId, REALTIME.eventClockChanged, {
      instanceKey: state.instanceKey,
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
  instanceKey: string,
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
    instance_key: instanceKey,
    mode: patch.mode,
    seconds_remaining: Math.max(0, Math.min(359999, Math.round(patch.secondsRemaining))),
    set_at: patch.setAt,
    set_by: patch.userId,
    label: patch.label === undefined ? null : patch.label,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from("match_clock")
    .upsert(row, { onConflict: "stream_session_id,instance_key" })
    .select(
      "stream_session_id, instance_key, mode, seconds_remaining, set_at, set_by, label, updated_at",
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
    instanceKey?: string;
  },
): Promise<ClockState> {
  return upsertClock(sb, sessionId, norm(input.instanceKey), {
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
  instanceKey?: string,
): Promise<ClockState> {
  const key = norm(instanceKey);
  const cur = await getClock(sb, sessionId, key);
  const mode: ClockMode =
    cur && cur.secondsRemaining > 0 ? "countdown" : "countup";
  return upsertClock(sb, sessionId, key, {
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
  return state.secondsRemaining;
}

export async function pauseClock(
  sb: SupabaseClient,
  sessionId: string,
  userId: string,
  instanceKey?: string,
): Promise<ClockState> {
  const key = norm(instanceKey);
  const cur = await getClock(sb, sessionId, key);
  if (!cur) throw new Error(`no clock for session ${sessionId}/${key}`);
  const display = computeDisplay(cur, Date.now());
  return upsertClock(sb, sessionId, key, {
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
  instanceKey?: string,
): Promise<ClockState> {
  const key = norm(instanceKey);
  const cur = await getClock(sb, sessionId, key);
  if (!cur) throw new Error(`no clock for session ${sessionId}/${key}`);
  const mode: ClockMode = cur.secondsRemaining > 0 ? "countdown" : "countup";
  return upsertClock(sb, sessionId, key, {
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
  instanceKey?: string,
): Promise<ClockState> {
  const key = norm(instanceKey);
  const cur = await getClock(sb, sessionId, key);
  const display = cur ? computeDisplay(cur, Date.now()) : 0;
  const mode: ClockMode = cur?.mode ?? "stopped";
  const label = cur?.label ?? null;
  const next = Math.max(0, display + deltaSeconds);
  return upsertClock(sb, sessionId, key, {
    mode,
    secondsRemaining: next,
    setAt: new Date().toISOString(),
    label,
    userId,
  });
}

export async function resetClock(
  sb: SupabaseClient,
  sessionId: string,
  userId: string,
  instanceKey?: string,
): Promise<ClockState> {
  const key = norm(instanceKey);
  return upsertClock(sb, sessionId, key, {
    mode: "stopped",
    secondsRemaining: 0,
    setAt: new Date().toISOString(),
    label: null,
    userId,
  });
}
