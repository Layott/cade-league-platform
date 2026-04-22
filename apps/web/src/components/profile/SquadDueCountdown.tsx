"use client";

import { useEffect, useState } from "react";

/**
 * Plan 41 — live-updating countdown used inside SquadDueCard + SquadDueBanner.
 * Pure presentation: parents pass the `deadlineIso`; this component re-renders
 * each second with HH:MM:SS remaining. Server re-checks at submit time.
 */
export function SquadDueCountdown({
  deadlineIso,
  className = "",
}: {
  deadlineIso: string;
  className?: string;
}) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const target = new Date(deadlineIso).getTime();
  const diff = Math.max(0, target - now);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <span
      data-testid="squad-due-countdown"
      className={"font-mono tabular-nums text-[var(--chalk-0)] " + className}
    >
      {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}
