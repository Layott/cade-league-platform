import { businessDaysBetween } from "@/lib/businessDays";

/**
 * Plan 41 (§5) — appeal-window predicate.
 *
 * A player may submit an appeal against a disciplinary action iff the number
 * of full business days elapsed since `issuedAt` is in the inclusive range
 * [1, 5] AND the sanction type is not an `auto_forfeit` (those are
 * non-appealable by design — they're auto-issued by the penalty engine, not
 * by a referee ruling, so there's no referee decision to contest).
 *
 * Day-0 window is closed (intentional cooling-off). Day-6+ is closed (the
 * ruling stands). Weekends are NOT business days and do not count toward the
 * window (see `lib/businessDays.ts`).
 *
 * This helper is pure and deterministic — no DB, no IO — so the component
 * layer can call it with `new Date()` for UX and the server action can
 * re-validate with the same logic at submit time to reject late submits
 * even if a client clock is stale.
 */
export type SanctionType = string;

export function isAppealWindowOpen(
  issuedAt: Date,
  now: Date,
  sanctionType: SanctionType,
): boolean {
  if (sanctionType === "auto_forfeit") return false;
  const elapsed = businessDaysBetween(issuedAt, now);
  return elapsed >= 1 && elapsed <= 5;
}
