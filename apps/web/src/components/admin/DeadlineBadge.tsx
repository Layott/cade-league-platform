"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "./StatusPill";
import { computeDeadlineTone, formatCountdown } from "./DeadlineBadge.helpers";

// Re-export helpers for any caller that imports from this module.
export { computeDeadlineTone, formatCountdown } from "./DeadlineBadge.helpers";
export type { DeadlineTone } from "./DeadlineBadge.helpers";

/**
 * Plan 13B — Deadline badge with server-rendered initial tone + 30s
 * client-side re-tick. Tone rules (spec §5.3):
 *   - status === 'expired' OR now >= deadline → red `EXPIRED`
 *   - < 24h remaining → red `<24h`
 *   - < 72h remaining → amber `<72h`
 *   - else           → chalk-2 mono countdown `NdHh`
 *
 * Pure helpers live in `./DeadlineBadge.helpers` so vitest can import
 * them without parsing the client-component JSX.
 */

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
  // Initialize to deadlineMs so SSR + first CSR render produce the
  // SAME computeDeadlineTone output (deterministic). Real Date.now() is
  // hydrated in the effect below, after which the 30s tick keeps pace.
  // Initializing with `Date.now()` here would cause React #418 because
  // server clock != client clock (hydration mismatch).
  const [nowMs, setNowMs] = useState<number>(deadlineMs);

  useEffect(() => {
    setNowMs(Date.now());
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
