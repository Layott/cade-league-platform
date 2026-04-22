"use client";

import { useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { REALTIME } from "@/server/overlays/registry";

/**
 * Plan 37 — useMatchClock.
 *
 * Subscribes to `clock.changed` on the per-session realtime channel and
 * exposes a 250 ms-throttled `displaySeconds` derived from the server
 * snapshot `(mode, secondsRemaining, setAt)`.
 *
 * Returns null when no clock has been set for this session.
 */

export type ClockMode = "countdown" | "countup" | "paused" | "stopped";

export type MatchClockState = {
  mode: ClockMode;
  displaySeconds: number;
  label: string | null;
  lastSetAt: string;
} | null;

type ClockSnapshot = {
  mode: ClockMode;
  secondsRemaining: number;
  setAt: string;
  label: string | null;
};

type ApiResponse = {
  mode: ClockMode;
  seconds_remaining: number;
  set_at: string;
  label: string | null;
} | null;

function computeDisplay(snap: ClockSnapshot, nowMs: number): number {
  const elapsed = Math.floor(
    (nowMs - new Date(snap.setAt).getTime()) / 1000,
  );
  if (snap.mode === "countdown") {
    return Math.max(0, snap.secondsRemaining - Math.max(0, elapsed));
  }
  if (snap.mode === "countup") {
    return Math.max(0, snap.secondsRemaining + Math.max(0, elapsed));
  }
  return snap.secondsRemaining;
}

export function useMatchClock(sessionId: string | null): MatchClockState {
  const [snap, setSnap] = useState<ClockSnapshot | null>(null);
  const [, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    fetch(
      `/api/broadcast/sessions/${encodeURIComponent(sessionId)}/clock`,
      { cache: "no-store" },
    )
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((row) => {
        if (cancelled || !row) return;
        setSnap({
          mode: row.mode,
          secondsRemaining: row.seconds_remaining,
          setAt: row.set_at,
          label: row.label,
        });
      })
      .catch(() => {
        // realtime push will hydrate
      });

    const sb = getBrowserSupabase();
    const channel = sb.channel(REALTIME.channel(sessionId), {
      config: { broadcast: { self: false } },
    });

    channel
      .on(
        "broadcast",
        { event: REALTIME.eventClockChanged },
        (msg: {
          payload: {
            mode: ClockMode;
            secondsRemaining: number;
            setAt: string;
            label: string | null;
          };
        }) => {
          const p = msg.payload;
          if (!p) return;
          setSnap({
            mode: p.mode,
            secondsRemaining: p.secondsRemaining,
            setAt: p.setAt,
            label: p.label ?? null,
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [sessionId]);

  // 250 ms rAF-throttled tick to refresh derived display.
  useEffect(() => {
    if (!snap) return;
    if (snap.mode !== "countdown" && snap.mode !== "countup") return;

    const loop = (ts: number) => {
      if (ts - lastTickRef.current >= 250) {
        lastTickRef.current = ts;
        setTick((t) => (t + 1) % 1_000_000);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [snap]);

  if (!snap) return null;
  return {
    mode: snap.mode,
    displaySeconds: computeDisplay(snap, Date.now()),
    label: snap.label,
    lastSetAt: snap.setAt,
  };
}

/** Format mm:ss (or h:mm:ss when ≥ 1 hour). */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
