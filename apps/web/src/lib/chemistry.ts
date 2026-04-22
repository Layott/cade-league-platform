/**
 * Plan 30 — simplified squad chemistry calculation.
 *
 * Real FC26 chemistry depends on formation, position, loyalty, and links.
 * Plan 30 uses a heuristic sufficient for a "is this squad cohesive?" gut
 * check (spec §3.4):
 *
 *   Each filled slot earns 1 point for each of { club, league, nation }
 *   that matches ≥ 2 other filled slots. Total capped at 100.
 *
 * The picker surfaces a banner: "Chemistry is indicative; final verdict is
 * the ref's." Plan 31 can refine toward spec-accurate FC26 rules.
 */

export type ChemistryCard = {
  club: string | null;
  league: string | null;
  nation: string | null;
};

const CHEM_CAP = 100;

function countOccurrences(
  cards: ChemistryCard[],
  key: "club" | "league" | "nation",
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of cards) {
    const raw = c[key];
    if (!raw) continue;
    const norm = raw.trim().toLowerCase();
    if (!norm) continue;
    counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  return counts;
}

/**
 * Compute a simplified chemistry score in [0, 100]. `slots` should be the
 * live filled slots only — pass nulls-filtered. Returns 0 for fewer than 2
 * cards (no link can form).
 */
export function calculateChemistry(slots: ChemistryCard[]): number {
  const filled = slots.filter((c): c is ChemistryCard => !!c);
  if (filled.length < 2) return 0;

  const clubCounts = countOccurrences(filled, "club");
  const leagueCounts = countOccurrences(filled, "league");
  const nationCounts = countOccurrences(filled, "nation");

  let total = 0;
  for (const card of filled) {
    if (card.club) {
      const n = clubCounts.get(card.club.trim().toLowerCase()) ?? 0;
      if (n >= 3) total += 1; // "≥ 2 others" means self + 2 others = 3
    }
    if (card.league) {
      const n = leagueCounts.get(card.league.trim().toLowerCase()) ?? 0;
      if (n >= 3) total += 1;
    }
    if (card.nation) {
      const n = nationCounts.get(card.nation.trim().toLowerCase()) ?? 0;
      if (n >= 3) total += 1;
    }
  }

  // Scale: max possible is 3 points per card (all three axes match). 11 cards
  // × 3 = 33 max raw score. Multiply by ~3.03 to reach 100, capped.
  const scaled = Math.round((total / (filled.length * 3)) * 100);
  return Math.min(CHEM_CAP, Math.max(0, scaled));
}
