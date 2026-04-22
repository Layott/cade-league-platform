/**
 * Plan 26 — fixture search filter helpers.
 *
 * Pure, dependency-free functions used by both the public /fixtures page
 * and the admin /admin/match-days page. Search is a case-insensitive
 * substring match against either side's gamer_tag OR display name. We do
 * the filter in JS (data is already loaded) so the URL ?q= param is the
 * single source of truth and pages stay statically renderable.
 */

export type FixtureSearchableMatch = {
  home_name: string;
  home_tag: string;
  away_name: string;
  away_tag: string;
};

export function matchesQuery(
  m: FixtureSearchableMatch,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (q.length === 0) return true;
  const haystack = [m.home_tag, m.home_name, m.away_tag, m.away_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function filterFixtures<
  M extends FixtureSearchableMatch,
  G extends { fixtures: M[] },
>(groups: G[], rawQuery: string): G[] {
  const q = rawQuery.trim();
  if (q.length === 0) return groups;
  return groups
    .map((g) => ({ ...g, fixtures: g.fixtures.filter((m) => matchesQuery(m, q)) }))
    .filter((g) => g.fixtures.length > 0);
}

/**
 * Plan 26 — seed-validator helper. Used by unit tests against the static
 * fixture list embedded in supabase/seed/plan26_real_fixtures.sql to
 * guarantee every player ends with exactly 12 matches and the season has
 * exactly 78 fixtures.
 */
export type FixturePair = readonly [string, string];

export function summarizeRoundRobin(pairs: readonly FixturePair[]): {
  total: number;
  perPlayer: Record<string, number>;
  duplicates: string[];
} {
  const perPlayer: Record<string, number> = {};
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const [a, b] of pairs) {
    perPlayer[a] = (perPlayer[a] ?? 0) + 1;
    perPlayer[b] = (perPlayer[b] ?? 0) + 1;
    const key = [a, b].slice().sort().join("|");
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  return { total: pairs.length, perPlayer, duplicates };
}
