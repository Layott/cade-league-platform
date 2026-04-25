"use client";

import { useCallback, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Plan 51 — Timer control (lower-third countdown).
 *
 * Two input modes:
 *  - duration  (min:sec)
 *  - clock     (HH:MM 24h WAT — overlay computes secondsRemaining itself)
 *
 * The control sends an immediate postMessage into the preview iframe so
 * the operator sees the countdown before committing the trigger. ENTER
 * persists the row by computing an `expiresAt` ISO string from the
 * current input values and embedding it in the trigger payload (the
 * `layout_timer` schema at server/overlays/schemas.ts requires
 * `expiresAt: ISO datetime`).
 */
export function TimerControl({ sessionId, viewToken }: SimpleControlProps) {
  const [minutes, setMinutes] = useState<number>(3);
  const [seconds, setSeconds] = useState<number>(0);
  const [endClock, setEndClock] = useState<string>("");
  const [mode, setMode] = useState<"duration" | "clock">("duration");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const previewUpdate = useCallback(() => {
    if (mode === "duration") {
      postToFrame(iframeRef.current, {
        type: "update",
        data: { minutes, seconds },
      });
    } else if (endClock) {
      postToFrame(iframeRef.current, {
        type: "update",
        data: { mode: "clock", endClock },
      });
    }
  }, [mode, minutes, seconds, endClock]);

  /** Compute the expiresAt ISO string the persistent payload needs. */
  const computeExpiresAt = (): string => {
    if (mode === "duration") {
      const total = Math.max(0, minutes * 60 + seconds);
      return new Date(Date.now() + total * 1000).toISOString();
    }
    // clock mode — assume same day in UTC; the overlay re-derives WAT
    // locally. End time is HH:MM today; if that's already past, target
    // tomorrow.
    if (!endClock) return new Date(Date.now() + 60_000).toISOString();
    const [hh, mm] = endClock.split(":").map((s) => Number(s));
    const target = new Date();
    target.setHours(hh, mm, 0, 0);
    if (target.getTime() < Date.now()) {
      target.setDate(target.getDate() + 1);
    }
    return target.toISOString();
  };

  const expiresAt = computeExpiresAt();
  const payloadJson = JSON.stringify({ expiresAt, label: null });

  return (
    <ControlCard
      overlayKey="02-timer"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      editPanel={
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Minutes
              <input
                type="number"
                min={0}
                max={999}
                value={minutes}
                onChange={(e) => {
                  setMinutes(Number(e.target.value) || 0);
                  setMode("duration");
                }}
                onBlur={previewUpdate}
                data-testid="v2-timer-minutes"
                className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[12px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Seconds
              <input
                type="number"
                min={0}
                max={59}
                value={seconds}
                onChange={(e) => {
                  setSeconds(Number(e.target.value) || 0);
                  setMode("duration");
                }}
                onBlur={previewUpdate}
                data-testid="v2-timer-seconds"
                className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[12px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Or end clock (HH:MM, 24h WAT)
            <input
              type="time"
              value={endClock}
              onChange={(e) => {
                setEndClock(e.target.value);
                setMode("clock");
              }}
              onBlur={previewUpdate}
              data-testid="v2-timer-endclock"
              className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[12px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
            />
          </label>
          <p className="text-[9px] uppercase tracking-[0.16em] text-[var(--chalk-3)]">
            Mode: <span className="text-[var(--signal)]">{mode}</span>
          </p>
        </div>
      }
      triggerSlot={
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey="02-timer"
            sessionId={sessionId}
            payloadFields={
              <input type="hidden" name="payload" value={payloadJson} />
            }
          />
          <TriggerOffForm overlayKey="02-timer" sessionId={sessionId} />
        </div>
      }
    />
  );
}
