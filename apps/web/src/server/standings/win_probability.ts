/**
 * Plan 51 — win-probability calculator.
 *
 * Mirrors the xlsx Strength formula from the Excel scout sheet: each player
 * gets a strength score from (a) season points-per-game, (b) goals-for
 * average, and (c) recent-form share (last-5 results normalised to a 0-1
 * scale where each W counts 3, D counts 1, L counts 0; sum/15 = 1.0 max).
 *
 * The two strength scores feed a logistic delta -> head-to-head probability,
 * with a baseline draw share of 25% that contracts as the strength delta
 * grows. When the caller supplies an h2h record, we blend it in with weight
 * 0.4 (h2h) + 0.4 (season) + 0.2 (form). Without h2h the season+form blend
 * collapses to 0.6 (season) + 0.4 (form). Output always sums to 1.0 within
 * floating-point rounding.
 */

export type PlayerSeasonStats = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  /**
   * Last five results, each entry encoded as 3 (W) / 1 (D) / 0 (L). When
   * fewer than five matches have been played the array can be shorter; the
   * formula divides by a constant 15 (5*3) so a partial array still maps
   * onto the same 0-1 form scale.
   */
  last5Form: number[];
};

export type H2HRecord = {
  totalMatches: number;
  aWins: number;
  bWins: number;
  draws: number;
};

export type WinProbability = {
  pA: number;
  pB: number;
  pDraw: number;
};

/**
 * Compute the season-strength contribution for one player. Higher PPG +
 * higher goals-per-game = higher strength. Result lives roughly in [0, 1.5].
 */
export function seasonStrength(stats: PlayerSeasonStats): number {
  const played = Math.max(0, stats.played);
  if (played === 0) return 0.5; // neutral when nothing has been played yet
  const ppg = stats.points / played; // 0..3
  const gfPerGame = stats.gf / played; // typical 0..6
  // Normalise: PPG/3 lives in 0..1, GF/4 lives roughly in 0..1.
  const ppgNorm = clamp01(ppg / 3);
  const gfNorm = clamp01(gfPerGame / 4);
  return 0.7 * ppgNorm + 0.3 * gfNorm;
}

/**
 * Compute the form-only strength contribution. Sum-of-last-5 / 15 puts the
 * value in 0..1.
 */
export function formStrength(stats: PlayerSeasonStats): number {
  const arr = stats.last5Form ?? [];
  if (arr.length === 0) return 0.5;
  // 2026-05-10 — divisor = arr.length * 3 (max points per match) so the
  // result is a 0-1 ratio regardless of window size. Pre-fix used a
  // hardcoded 15 (= 5 matches × 3 points), which broke when the form
  // window was expanded to 10 — sum could reach 30, dividing by 15
  // exceeded 1.0 and clamped, washing out the gradient.
  const sum = arr.reduce((acc, v) => acc + clampForm(v), 0);
  return clamp01(sum / (arr.length * 3));
}

/**
 * Compute the h2h-only strength contribution from A's perspective. With no
 * h2h history the value is 0.5 (neutral). A's win-share contributes 1.0,
 * draws contribute 0.5, losses contribute 0.0.
 */
export function h2hStrength(h2h: H2HRecord): number {
  if (h2h.totalMatches <= 0) return 0.5;
  const score = h2h.aWins * 1 + h2h.draws * 0.5 + h2h.bWins * 0;
  return clamp01(score / h2h.totalMatches);
}

/**
 * Combined player strength score.
 *
 * Without h2h: 60% season + 40% form.
 * With h2h:    40% h2h    + 40% season + 20% form.
 *
 * For player B, h2h flips (1 - aPerspective) so the same call gives B's view.
 */
function combinedStrengthA(
  a: PlayerSeasonStats,
  h2h: H2HRecord | undefined,
): number {
  const sA = seasonStrength(a);
  const fA = formStrength(a);
  if (!h2h || h2h.totalMatches <= 0) {
    return 0.6 * sA + 0.4 * fA;
  }
  const hA = h2hStrength(h2h);
  return 0.4 * hA + 0.4 * sA + 0.2 * fA;
}

function combinedStrengthB(
  b: PlayerSeasonStats,
  h2h: H2HRecord | undefined,
): number {
  const sB = seasonStrength(b);
  const fB = formStrength(b);
  if (!h2h || h2h.totalMatches <= 0) {
    return 0.6 * sB + 0.4 * fB;
  }
  const hA = h2hStrength(h2h);
  // Flip A's perspective for B.
  const hB = 1 - hA;
  return 0.4 * hB + 0.4 * sB + 0.2 * fB;
}

/**
 * Logistic mapping of strength delta to probability of A beating B
 * (excluding draw share). Slope chosen so a 0.4 delta maps to roughly 80/20.
 */
function logisticP(delta: number): number {
  const k = 5; // slope
  return 1 / (1 + Math.exp(-k * delta));
}

/**
 * Public API. Returns probabilities normalised to sum to 1.
 */
export function computeWinProbability(
  playerA: PlayerSeasonStats,
  playerB: PlayerSeasonStats,
  h2h?: H2HRecord,
): WinProbability {
  // Guard: when both players have zero matches played AND no H2H history,
  // there is no signal to bias the result. Disciplinary point/GD adjustments
  // (which can leave `points` < 0 with `played === 0`) must NOT drive a
  // pre-season favourite. Return the neutral split. Form arrays are also
  // empty in this case, so the regular formula would land near 50/50 — but
  // we short-circuit defensively to make the contract explicit.
  const noH2H = !h2h || h2h.totalMatches <= 0;
  if (noH2H && playerA.played === 0 && playerB.played === 0) {
    return { pA: 0.375, pB: 0.375, pDraw: 0.25 };
  }
  const strA = combinedStrengthA(playerA, h2h);
  const strB = combinedStrengthB(playerB, h2h);
  const delta = strA - strB;

  // Draw share: baseline 25%, contracts as |delta| grows. At delta=0.5 it
  // collapses to ~15%, the floor. At delta=0 it stays at 25%.
  const drawBaseline = 0.25;
  const drawFloor = 0.15;
  const drawCeiling = 0.4;
  const contraction = Math.min(1, Math.abs(delta) * 1.5);
  let pDraw = drawBaseline - (drawBaseline - drawFloor) * contraction;
  // Equally-weak players (both flat zeros) — give a slight nudge toward the
  // top of the draw range so we stay in spec [0.15, 0.40].
  if (Math.abs(delta) < 1e-6 && Math.abs(strA - 0.5) < 1e-6) {
    pDraw = drawBaseline;
  }
  pDraw = clamp(pDraw, drawFloor, drawCeiling);

  const remaining = 1 - pDraw;
  const pA_logistic = logisticP(delta);
  const pA = remaining * pA_logistic;
  const pB = remaining * (1 - pA_logistic);

  return normalise({ pA, pB, pDraw });
}

// ---------------- helpers ----------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Clamp form entries to known values (3, 1, 0). */
function clampForm(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v >= 3) return 3;
  if (v >= 1) return 1;
  return 0;
}

function normalise(p: WinProbability): WinProbability {
  const sum = p.pA + p.pB + p.pDraw;
  if (sum <= 0) {
    return { pA: 0.375, pB: 0.375, pDraw: 0.25 };
  }
  return {
    pA: p.pA / sum,
    pB: p.pB / sum,
    pDraw: p.pDraw / sum,
  };
}
