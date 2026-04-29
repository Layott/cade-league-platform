"use client";

import { useEffect, useState } from "react";

/**
 * Plan 10 — display-only countdown to a target ISO instant. Never affects
 * server gating; the server re-checks the window on submit.
 */
export function CountdownBadge({
  targetIso,
  prefix = "Opens in",
  className = "",
}: {
  targetIso: string;
  prefix?: string;
  className?: string;
}) {
  // SSR/CSR clock skew → React #418 hydration mismatch. Initialize to
  // target time so initial render is deterministic; useEffect hydrates
  // real time after mount.
  const target = new Date(targetIso).getTime();
  const [now, setNow] = useState<number>(target);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, target - now);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <span
      data-testid="change-countdown"
      className={
        "inline-flex items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-2.5 py-1 font-mono text-[12px] tabular text-[var(--chalk-0)] " +
        className
      }
    >
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
        {prefix}
      </span>
      <span>
        {pad(h)}:{pad(m)}:{pad(s)}
      </span>
    </span>
  );
}
