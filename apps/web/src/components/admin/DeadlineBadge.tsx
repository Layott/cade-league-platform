"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "./StatusPill";

/**
 * Plan 13B — Deadline badge with server-rendered initial tone + 30s
 * client-side re-tick. Tone rules (spec §5.3):
 *   - status === 'expired' OR now >= deadline → red `EXPIRED`
 *   - < 24h remaining → red `<24h`
 *   - < 72h remaining → amber `<72h`
 *   - else           → chalk-2 mono countdown `NdHh`
 *
 * Countdown is computed off the `deadlineIso` prop (server-sent). Client
 * re-evaluates every 30 s — clock skew up to ~30 s is acceptable.
 */

export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "0h";
  const totalHours = Math.floor(msRemaining / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) return `${days}d${hours}h`;
  return `${hours}h`;
}

export type DeadlineTone = "expired" | "lt24" | "lt72" | "ok";

export function computeDeadlineTone(
  deadlineMs: number,
  nowMs: number,
  status?: string,
): { tone: DeadlineTone; remainingMs: number } {
  const remainingMs = deadlineMs - nowMs;
  if (status === "expired" || remainingMs <= 0) {
    return { tone: "expired", remainingMs: Math.max(0, remainingMs) };
  }
  const H24 = 24 * 60 * 60 * 1000;
  const H72 = 72 * 60 * 60 * 1000;
  if (remainingMs < H24) return { tone: "lt24", remainingMs };
  if (remainingMs < H72) return { tone: "lt72", remainingMs };
  return { tone: "ok", remainingMs };
}

export function DeadlineBadge({
  deadlineIso,
  status,
  "data-testid": testId,
}: {
  deadlineIso: string;
  status?: string;
  "data-testid"?: string;
}) {
  const deadlineMs = new Date(deadlineIso).getTime();
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { tone, remainingMs } = computeDeadlineTone(deadlineMs, nowMs, status);

  if (tone === "expired") {
    return (
      <StatusPill tone="crimson" data-testid={testId}>
        EXPIRED
      </StatusPill>
    );
  }
  if (tone === "lt24") {
    return (
      <StatusPill tone="crimson" data-testid={testId}>
        &lt;24h
      </StatusPill>
    );
  }
  if (tone === "lt72") {
    return (
      <StatusPill tone="amber" data-testid={testId}>
        &lt;72h
      </StatusPill>
    );
  }
  return (
    <span
      data-testid={testId}
      className="font-mono text-[11px] tabular text-[var(--chalk-2)]"
    >
      {formatCountdown(remainingMs)}
    </span>
  );
}
