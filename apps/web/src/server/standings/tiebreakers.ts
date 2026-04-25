/**
 * Plan 51 — configurable tiebreaker sort.
 *
 * Reads `seasons.tiebreaker_order` (a JSONB array of column-name keys) and
 * applies an in-memory stable sort across the supplied standings rows. The
 * canonical ladder remains `["totalPts", "gd", "gf", "name"]` if the season
 * row has no override.
 *
 * Higher-better keys: totalPts, gd, gf, wins, played.
 * Lower-better keys: losses.
 * Alphabetical ascending: name.
 *
 * Unknown keys raise a descriptive error so callers see a clear "ladder
 * misconfigured" instead of a silent miscast / NaN sort.
 */

export type StandingsRow = {
  playerId: string;
  pts: number;
  gd: number;
  gf: number;
  ga: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  name: string;
};

export const DEFAULT_TIEBREAKER_ORDER = ["totalPts", "gd", "gf", "name"] as const;
export const SUPPORTED_TIEBREAKER_KEYS = [
  "totalPts",
  "gd",
  "gf",
  "wins",
  "losses",
  "played",
  "name",
] as const;

export type TiebreakerKey = (typeof SUPPORTED_TIEBREAKER_KEYS)[number];

const HIGHER_BETTER = new Set<TiebreakerKey>([
  "totalPts",
  "gd",
  "gf",
  "wins",
  "played",
]);

function valueOf(row: StandingsRow, key: TiebreakerKey): number | string {
  switch (key) {
    case "totalPts":
      return row.pts;
    case "gd":
      return row.gd;
    case "gf":
      return row.gf;
    case "wins":
      return row.wins;
    case "played":
      return row.played;
    case "losses":
      return row.losses;
    case "name":
      return row.name.toLowerCase();
  }
}

function isSupportedKey(key: string): key is TiebreakerKey {
  return (SUPPORTED_TIEBREAKER_KEYS as readonly string[]).includes(key);
}

/**
 * Apply the configured tiebreaker order. Returns a NEW array — does not
 * mutate the input.
 *
 * If `order` is empty / undefined we fall back to the default ladder.
 */
export function applyTiebreakers(
  rows: StandingsRow[],
  order: string[] | null | undefined,
): StandingsRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const effective: TiebreakerKey[] = (
    order && order.length > 0 ? order : DEFAULT_TIEBREAKER_ORDER
  ).map((k) => {
    if (!isSupportedKey(k)) {
      throw new Error(
        `applyTiebreakers: unsupported tiebreaker key "${k}". Supported keys: ${SUPPORTED_TIEBREAKER_KEYS.join(",")}`,
      );
    }
    return k;
  });

  // Always anchor by name as the final fallback so equal rows still sort
  // deterministically across runs. Append `name` if the order doesn't end
  // with it (idempotent — adding it twice is harmless).
  if (effective[effective.length - 1] !== "name") {
    effective.push("name");
  }

  const sorted = [...rows].sort((a, b) => {
    for (const key of effective) {
      const av = valueOf(a, key);
      const bv = valueOf(b, key);
      const cmp = compareByKey(key, av, bv);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return sorted;
}

function compareByKey(
  key: TiebreakerKey,
  av: number | string,
  bv: number | string,
): number {
  if (key === "name") {
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  }
  // numeric — coerce so NaN slip-throughs don't silently reorder
  const an = typeof av === "number" ? av : Number(av);
  const bn = typeof bv === "number" ? bv : Number(bv);
  if (HIGHER_BETTER.has(key)) {
    // higher first -> b - a
    return bn - an;
  }
  // lower first -> a - b (currently only `losses`)
  return an - bn;
}
