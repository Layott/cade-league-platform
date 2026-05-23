/**
 * Shared cross-season data used by 25-did-you-know + 28-punditry
 * variant generators. Last-season standings are producer-supplied
 * verified figures from the previous Elite league's final fixtures
 * (screenshot 2026-05-23).
 *
 * STRICT RULE: only update from verified sources. Do not invent
 * historical figures.
 */

export type LastSeasonRow = {
  slug: string;
  displayName: string;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
};

export const LAST_SEASON_STANDINGS: ReadonlyArray<LastSeasonRow> = [
  { slug: "faruk", displayName: "FARUK", rank: 1, played: 15, wins: 14, draws: 1, losses: 0, goalsFor: 103, goalsAgainst: 35, goalDiff: 68, points: 43 },
  { slug: "killer_freak", displayName: "KILLER FREAK", rank: 2, played: 15, wins: 13, draws: 1, losses: 1, goalsFor: 87, goalsAgainst: 31, goalDiff: 56, points: 40 },
  { slug: "baji_jnr", displayName: "BAJI JNR", rank: 4, played: 15, wins: 10, draws: 2, losses: 3, goalsFor: 76, goalsAgainst: 54, goalDiff: 22, points: 32 },
  { slug: "adefola", displayName: "ADEFOLA", rank: 7, played: 15, wins: 8, draws: 0, losses: 7, goalsFor: 68, goalsAgainst: 46, goalDiff: 22, points: 24 },
  { slug: "mitch", displayName: "MITCH", rank: 8, played: 15, wins: 7, draws: 3, losses: 5, goalsFor: 79, goalsAgainst: 63, goalDiff: 16, points: 24 },
  { slug: "mr_oga", displayName: "MR OGA", rank: 10, played: 15, wins: 4, draws: 4, losses: 7, goalsFor: 58, goalsAgainst: 65, goalDiff: -7, points: 16 },
  { slug: "anife", displayName: "ANIFE", rank: 13, played: 15, wins: 4, draws: 2, losses: 9, goalsFor: 54, goalsAgainst: 88, goalDiff: -34, points: 14 },
];

export const RETURNER_SLUGS: ReadonlyArray<string> = LAST_SEASON_STANDINGS.map(
  (r) => r.slug,
);

export const NEW_ARRIVAL_SLUGS: ReadonlyArray<string> = [
  "dadaboi",
  "guru",
  "kaykay",
  "kingnonex",
  "tactical",
  "wolevation",
];

export type CurrentPlayerStat = {
  slug: string;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  played: number;
};

export function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export function pacedDiff(curr: number, prev: number, prevPlayed: number, currPlayed: number): string {
  const expected = Math.round(prev * (currPlayed / prevPlayed));
  const d = curr - expected;
  if (d === 0) return "matching last season's pace exactly";
  if (d > 0) return `${d} ahead of last season's pace`;
  return `${Math.abs(d)} behind last season's pace`;
}
