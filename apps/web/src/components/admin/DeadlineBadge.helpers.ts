/**
 * Plan 13B — Pure helpers extracted from DeadlineBadge so vitest can
 * import them without parsing the client-component JSX (which trips a
 * vite:import-analysis parse error under tsconfig `jsx: preserve`).
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
