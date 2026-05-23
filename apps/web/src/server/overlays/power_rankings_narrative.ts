/**
 * Auto-derived single-line stat blurbs for overlay 22-power-rankings.
 *
 * Each rank slot's `.blurb` element is populated from the player's
 * leaderboard row stats so the line ALWAYS reflects what's actually
 * true right now — when rank 1 swaps mid-stream from BAJI JNR to FARUK,
 * the blurb at slot 1 immediately switches to FARUK's standout stat
 * instead of staying pinned on the previous occupant's storyline.
 *
 * Rule cascade (first match wins). Each branch returns a ≤ 90 char line
 * with one verb-y storyline and at least one numeric stat. Deterministic
 * per (rank, p, w, d, l, gf, ga, gd, pts) tuple so the same standings
 * snapshot yields the same lines on every refresh.
 *
 * Companion to `apps/web/src/server/overlays/copy/ai_regenerate.ts` —
 * the AI-regen path overwrites `overlay_text_elements.content`, the
 * narrative path computes per-refresh and rides the leaderboard payload.
 * Overlay HTML's `update()` prefers `r.narrative` over the static seed.
 */

export type LeaderboardStatInput = {
  rank: number;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
};

function gfPerMatch(s: LeaderboardStatInput): number {
  return s.p > 0 ? s.gf / s.p : 0;
}
function gaPerMatch(s: LeaderboardStatInput): number {
  return s.p > 0 ? s.ga / s.p : 0;
}
function fmtSigned(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
function recordLabel(s: LeaderboardStatInput): string {
  return `${s.w}W-${s.d}D-${s.l}L`;
}

export function buildPowerRankingNarrative(s: LeaderboardStatInput): string {
  if (s.p === 0) {
    return s.rank === 1
      ? `Tipped to set the pace this season.`
      : `Awaiting opening fixture · MD-1 looms.`;
  }

  // Perfect record — every fixture won.
  if (s.l === 0 && s.d === 0 && s.w >= 3) {
    return `Flawless · ${s.w}-${s.w}-0 with GD ${fmtSigned(s.gd)}.`;
  }

  // Unbeaten run with some draws.
  if (s.l === 0 && s.p >= 3) {
    return `Unbeaten through ${s.p} · ${recordLabel(s)}, GD ${fmtSigned(s.gd)}.`;
  }

  // Goal flood — top-2 attack rate AND in the medal places.
  if (gfPerMatch(s) >= 3.0 && s.p >= 2 && s.rank <= 3) {
    return `Goal machine · ${s.gf} scored across ${s.p} (${gfPerMatch(s).toFixed(1)}/match).`;
  }

  // Defensive wall — sub-goal-per-game AND top-half.
  if (gaPerMatch(s) <= 0.8 && s.p >= 2 && s.rank <= 6) {
    return `Stingy defence · ${s.ga} conceded in ${s.p}, GD ${fmtSigned(s.gd)}.`;
  }

  // Hot streak — high win rate when in medal places.
  if (s.w >= 4 && s.l <= 1 && s.rank <= 3) {
    return `Form is electric · ${recordLabel(s)} with ${s.pts} pts banked.`;
  }

  // Climbing — middle of the pack, more wins than losses.
  if (s.rank >= 3 && s.rank <= 6 && s.w > s.l) {
    return `Climbing the table · ${recordLabel(s)} (${s.pts} pts).`;
  }

  // Goal-difference giant despite mid rank.
  if (s.gd >= 10 && s.rank >= 2) {
    return `Goal-difference monster · GD ${fmtSigned(s.gd)} despite the slip.`;
  }

  // Bad spell.
  if (s.l >= 3 && s.w <= 1) {
    return `Tough run · ${recordLabel(s)}, GD ${fmtSigned(s.gd)}.`;
  }

  // Negative GD trending wrong way.
  if (s.gd <= -5) {
    return `Need a response · GD ${fmtSigned(s.gd)} after ${s.p}.`;
  }

  // Gritty draws — mostly draws, few losses.
  if (s.d >= 3 && s.w <= 2 && s.l <= 2) {
    return `Stalemate king · ${s.d} draws so far · ${s.pts} pts ticking up.`;
  }

  // Generic top-of-table fallback.
  if (s.rank === 1) {
    return `Leading the pack · ${recordLabel(s)}, ${s.pts} pts (GD ${fmtSigned(s.gd)}).`;
  }

  // Generic fallback.
  return `${recordLabel(s)} · ${s.pts} pts, GD ${fmtSigned(s.gd)}.`;
}
