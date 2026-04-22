/**
 * Plan 30.1 — full FC26 chemistry calculation.
 *
 * Replaces Plan 30's simplified heuristic with production FC26 rules:
 *
 *   1. Per-slot chem is 0-3, summed from three tiered link contributions
 *      (club / league / nation) where each tier caps at 3, then the sum is
 *      capped at 3 per slot.
 *   2. Player must be in-position (card.position OR card.alt_positions
 *      matches the formation slot's position code) to earn ANY chem on that
 *      slot. Out-of-position cards still contribute to OTHER slots' link
 *      counts (so a misplaced winger still helps teammates).
 *   3. Icons count as ANY league for other slots' league tier (so every
 *      other card thinks the icon shares its league). In-position icon
 *      slots themselves get a flat 3 chem.
 *   4. Heroes contribute +2 to their league and +1 to their club for other
 *      slots. In-position hero slots themselves get a flat 3 chem.
 *   5. Squad total = sum of per-slot across 11 starters, max 33.
 *   6. Subs use the same per-card calculation but do NOT contribute to the
 *      starting-11 link pools — they sit on the bench. Subs chem is
 *      returned separately.
 *
 * Returns structured data (total, per-slot array, warnings) so the UI can
 * surface the breakdown + positional-gate warnings.
 */
import type { FCItemType } from "@/server/fcdb/types";
import type { FormationKey } from "@/components/squads/PitchLayout";
import { getFormationSlots } from "@/components/squads/PitchLayout";

export type ChemistryCard = {
  club: string | null;
  league: string | null;
  nation: string | null;
  position: string;
  positionsAlt: string[];
  itemType: FCItemType | string;
  // Optional name — only used for human-readable warnings.
  name?: string;
};

export type SlotFill = {
  card: ChemistryCard | null;
  positionInLineup: string;
};

export type ChemistryResult = {
  totalChem: number; // 0..33
  perSlot: number[]; // length === starting.length
  warnings: string[];
  subsTotalChem?: number;
  subsPerSlot?: number[];
};

/**
 * Tier thresholds per spec:
 *   Club:   ≥2 → 1, ≥4 → 2, ≥7 → 3
 *   League: ≥3 → 1, ≥5 → 2, ≥8 → 3
 *   Nation: ≥2 → 1, ≥5 → 2, ≥8 → 3
 */
export const TIER_THRESHOLDS = {
  club: [
    { min: 7, pts: 3 },
    { min: 4, pts: 2 },
    { min: 2, pts: 1 },
  ],
  league: [
    { min: 8, pts: 3 },
    { min: 5, pts: 2 },
    { min: 3, pts: 1 },
  ],
  nation: [
    { min: 8, pts: 3 },
    { min: 5, pts: 2 },
    { min: 2, pts: 1 },
  ],
} as const;

const SLOT_CHEM_CAP = 3;
const STARTING_SIZE = 11;

/**
 * Pure positional-gate check: does this card fit the given slot's position
 * code? Uppercased comparison against `card.position` + `card.alt_positions`.
 * Empty slotPos returns true (defensive — should not happen in practice).
 */
export function isInPosition(card: ChemistryCard, slotPos: string): boolean {
  if (!slotPos) return true;
  const target = slotPos.trim().toUpperCase();
  if (!target) return true;
  if ((card.position ?? "").trim().toUpperCase() === target) return true;
  for (const alt of card.positionsAlt ?? []) {
    if ((alt ?? "").trim().toUpperCase() === target) return true;
  }
  return false;
}

function norm(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = s.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function pickTier(
  count: number,
  table: readonly { min: number; pts: number }[],
): number {
  for (const row of table) {
    if (count >= row.min) return row.pts;
  }
  return 0;
}

type LinkContributions = {
  // clubKey → effective count contributed by OTHER cards toward this card
  clubs: Map<string, number>;
  leagues: Map<string, number>;
  nations: Map<string, number>;
  // Icons count as any league for EVERY slot — track count separately.
  iconCount: number;
};

/**
 * Build the link-contribution maps from a pool of cards. Each card's
 * contribution is added to the map regardless of whether it is in-position
 * (the positional gate is only applied when scoring a slot, not when
 * computing teammate contributions).
 *
 * Icon/Hero special cases:
 *   - Icon: adds +1 to its own club/nation, but for league counts as any
 *     league. We track icons as `iconCount` — when we score a slot, we add
 *     `iconCount` to that slot's league-tier count.
 *   - Hero: adds its +1 club, +1 nation, +2 league (so it "looks like 2
 *     players of its league" to teammates).
 */
function buildContributions(cards: ChemistryCard[]): LinkContributions {
  const clubs = new Map<string, number>();
  const leagues = new Map<string, number>();
  const nations = new Map<string, number>();
  let iconCount = 0;

  for (const c of cards) {
    const itemType = (c.itemType ?? "").toLowerCase();
    const isIcon = itemType === "icon";
    const isHero = itemType === "hero";

    const clubKey = norm(c.club);
    const leagueKey = norm(c.league);
    const nationKey = norm(c.nation);

    // Icons: +1 club/nation, league = "any" (tracked as iconCount below).
    if (isIcon) {
      if (clubKey) clubs.set(clubKey, (clubs.get(clubKey) ?? 0) + 1);
      if (nationKey) nations.set(nationKey, (nations.get(nationKey) ?? 0) + 1);
      iconCount += 1;
      continue;
    }

    // Heroes: +1 club, +1 nation, +2 league (per spec §3).
    if (isHero) {
      if (clubKey) clubs.set(clubKey, (clubs.get(clubKey) ?? 0) + 1);
      if (nationKey) nations.set(nationKey, (nations.get(nationKey) ?? 0) + 1);
      if (leagueKey) leagues.set(leagueKey, (leagues.get(leagueKey) ?? 0) + 2);
      continue;
    }

    // Regular/totw/evolution/special/other: +1 each axis.
    if (clubKey) clubs.set(clubKey, (clubs.get(clubKey) ?? 0) + 1);
    if (leagueKey) leagues.set(leagueKey, (leagues.get(leagueKey) ?? 0) + 1);
    if (nationKey) nations.set(nationKey, (nations.get(nationKey) ?? 0) + 1);
  }

  return { clubs, leagues, nations, iconCount };
}

/**
 * Score a single slot given the link-contribution pool. Applies positional
 * gate first — out-of-position → 0 regardless of links. Icons + Heroes in
 * position get a flat 3.
 */
function scoreSlot(
  fill: SlotFill,
  pool: LinkContributions,
): { chem: number; warning?: string } {
  if (!fill.card) return { chem: 0 };

  const card = fill.card;
  const inPos = isInPosition(card, fill.positionInLineup);

  if (!inPos) {
    const who = card.name ?? "Unknown card";
    return {
      chem: 0,
      warning: `${who} out of position at ${fill.positionInLineup}`,
    };
  }

  const itemType = (card.itemType ?? "").toLowerCase();
  // Icons + Heroes in-position = flat 3 (per spec §3).
  if (itemType === "icon" || itemType === "hero") {
    return { chem: SLOT_CHEM_CAP };
  }

  const clubKey = norm(card.club);
  const leagueKey = norm(card.league);
  const nationKey = norm(card.nation);

  const clubCount = clubKey ? (pool.clubs.get(clubKey) ?? 0) : 0;
  // League count includes iconCount (icons count as "any league").
  const leagueCount = leagueKey
    ? (pool.leagues.get(leagueKey) ?? 0) + pool.iconCount
    : 0;
  const nationCount = nationKey ? (pool.nations.get(nationKey) ?? 0) : 0;

  const clubPts = pickTier(clubCount, TIER_THRESHOLDS.club);
  const leaguePts = pickTier(leagueCount, TIER_THRESHOLDS.league);
  const nationPts = pickTier(nationCount, TIER_THRESHOLDS.nation);

  const sum = clubPts + leaguePts + nationPts;
  return { chem: Math.min(SLOT_CHEM_CAP, sum) };
}

/**
 * Compute full FC26 chemistry for a starting lineup (optionally subs).
 *
 * `starting` must have length === 11 (the formation's starting slots). Any
 * entry may be `{ card: null, positionInLineup }` for an empty slot. Empty
 * slots score 0 and do not contribute to link pools.
 *
 * `subs` are scored independently: each sub is evaluated against the
 * STARTING-11 pool only (subs do not contribute to their own chem pool —
 * they sit on the bench in-game). If a sub is in position it gets tier
 * chem; out-of-position → 0.
 */
export function computeChemistry(
  starting: SlotFill[],
  _formation?: FormationKey,
  subs?: SlotFill[],
): ChemistryResult {
  // Build starting-11 link pool from ONLY filled slots (regardless of
  // positional status — misplaced cards still help teammates).
  const startingCards = starting
    .map((f) => f.card)
    .filter((c): c is ChemistryCard => !!c);

  const pool = buildContributions(startingCards);

  const perSlot: number[] = [];
  const warnings: string[] = [];
  let total = 0;
  for (const fill of starting) {
    const { chem, warning } = scoreSlot(fill, pool);
    perSlot.push(chem);
    total += chem;
    if (warning) warnings.push(warning);
  }

  // Cap total at STARTING_SIZE * 3 = 33 (defensive — perSlot is already capped).
  total = Math.min(STARTING_SIZE * SLOT_CHEM_CAP, total);

  const result: ChemistryResult = {
    totalChem: total,
    perSlot,
    warnings,
  };

  // Subs: scored against the starting-11 pool. Still gated on position.
  if (subs && subs.length > 0) {
    const subsPerSlot: number[] = [];
    let subsTotal = 0;
    for (const fill of subs) {
      const { chem, warning } = scoreSlot(fill, pool);
      subsPerSlot.push(chem);
      subsTotal += chem;
      if (warning) warnings.push(warning);
    }
    result.subsPerSlot = subsPerSlot;
    result.subsTotalChem = subsTotal;
  }

  return result;
}

/**
 * Convenience helper — map a positional slot map (as SquadPickerBuilder
 * owns it) to a starting SlotFill[] in slotIndex order, using the given
 * formation's per-slot labels as the in-lineup position code.
 */
export function slotsToSlotFills(
  formation: FormationKey,
  slots: Record<number, ChemistryCard | null>,
): SlotFill[] {
  const defs = getFormationSlots(formation);
  return defs.map((d) => ({
    card: slots[d.slotIndex] ?? null,
    positionInLineup: d.label,
  }));
}

// ─── Back-compat shim ─────────────────────────────────────────────────────
// Plan 30's `LiveTotalsBar` used `calculateChemistry(slots: ChemistryCard[])`
// returning a 0-100 number. Keep a thin wrapper so callers that haven't
// migrated to `computeChemistry` still compile. Internally this uses the
// old simplified heuristic — the UI is migrated to the new API in the same
// commit so this path is effectively unreachable after Plan 30.1.
export type LegacyChemistryCard = {
  club: string | null;
  league: string | null;
  nation: string | null;
};

export function calculateChemistry(slots: LegacyChemistryCard[]): number {
  const filled = slots.filter((c): c is LegacyChemistryCard => !!c);
  if (filled.length < 2) return 0;

  function countAxis(key: "club" | "league" | "nation") {
    const m = new Map<string, number>();
    for (const c of filled) {
      const k = norm(c[key]);
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }

  const clubC = countAxis("club");
  const leagueC = countAxis("league");
  const nationC = countAxis("nation");

  let total = 0;
  for (const card of filled) {
    const clubK = norm(card.club);
    const leagueK = norm(card.league);
    const nationK = norm(card.nation);
    if (clubK && (clubC.get(clubK) ?? 0) >= 3) total += 1;
    if (leagueK && (leagueC.get(leagueK) ?? 0) >= 3) total += 1;
    if (nationK && (nationC.get(nationK) ?? 0) >= 3) total += 1;
  }

  const scaled = Math.round((total / (filled.length * 3)) * 100);
  return Math.min(100, Math.max(0, scaled));
}
