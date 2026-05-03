/**
 * FC26 squad chemistry — sourced from EA's published rules + Futbin's
 * squad-builder behaviour as of 2026-05-03 (deep research at
 * `tasks/research/futbin-chemistry-2026-05-03.md`):
 *
 *   1. Per-slot chem 0..3 from three tiered link contributions
 *      (club / league / nation) where each tier caps at 3, then sum
 *      capped at 3 per slot.
 *   2. Position rule: a starting-XI card must list the slot's position
 *      as its primary OR an alt to earn ANY chem. Out-of-position cards
 *      ALSO contribute zero to teammates' threshold counters (FC24 nerf
 *      vs FIFA 22 era).
 *   3. Special-card symbol contributions (per fut.gg + fifauteam.com):
 *        Icons → 0 club, +1 to EVERY league counter, 2 nation symbols,
 *                full chem in position.
 *        Heroes → 0 club, 2 league symbols, 1 nation symbol,
 *                 full chem in position.
 *        Cornerstones → 2 club symbols, 1 league, 1 nation.
 *        Squad Foundations → 1 club, 2 league, 1 nation.
 *        World Tour → 1 club, 1 league, 2 nation.
 *        Festival Captains → 1 club, 1 league, 3 nation.
 *        End of an Era → 0 club, +1 every league, 2 nation, full chem.
 *        Positional Excellence Evos → full chem in unlocked position.
 *      All other promos (TOTW/TOTS/TOTY/RTTF/Birthday/etc.) accrue as
 *      normal cards (1/1/1) with NO inherent auto-3.
 *   4. Manager bonus: +1 chem per starter whose nation OR league
 *      matches the manager's, capped INSIDE the 3-per-slot cap (not on
 *      top). Loyalty was removed in FC24 — not modelled.
 *   5. Squad total = sum of 11 starters, hard-cap 33.
 *   6. Subs: no chem in-game (FC24+); we still surface sub chem against
 *      the starter pool because Futbin's UI does the same — useful for
 *      previewing a swap before submission.
 *   7. League family map collapses men's + women's editions and seasonal
 *      sponsor rebrands of the same competition into a single family
 *      key (FC24+ rule). E.g. Premier League ↔ Barclays WSL,
 *      Serie A TIM ↔ Serie A Enilive, D1 Arkema ↔ Ligue 1.
 */
import type { FCItemType } from "@/server/fcdb/types";
// Bug fix 2026-05-02: import from non-`"use client"` formations module so
// server callers (broadcast endpoints, submit_picker) don't get client
// references at runtime. Importing from PitchLayout (which carries
// `"use client"`) makes the named exports unreachable from the server.
import type { FormationKey } from "@/components/squads/formations";
import { getFormationSlots } from "@/components/squads/formations";

/**
 * Optional per-card chem-bonus override. When set, replaces the
 * default-1-per-axis contribution this card makes to the link pool.
 * Heroes / Icons / Cornerstones / Squad-Foundations / World-Tour /
 * Festival-Captains / End-of-an-Era are auto-derived from `itemType` +
 * `variant` via `deriveChemBonus()` so callers usually don't need to
 * set this manually — but it's exposed so DB-driven overrides
 * (an admin tunes a one-off promo card) can land without code changes.
 */
export type ChemistryBonus = {
  /** Symbols this card contributes to its CLUB counter. Default 1.
   *  Icons + Heroes = 0 (no club affiliation). Cornerstones = 2. */
  clubSymbols?: number;
  /** Symbols this card contributes to its LEAGUE counter. Default 1.
   *  Heroes = 2. Squad Foundations = 2. */
  leagueSymbols?: number;
  /** When true, this card contributes +1 to EVERY league counter in
   *  the pool (Icons, End-of-an-Era). Stacks with the per-card
   *  `leagueSymbols` (Icons set leagueSymbols=0 + this true). */
  leagueSymbolsAllLeagues?: boolean;
  /** Symbols this card contributes to its NATION counter. Default 1.
   *  Icons = 2. World Tour = 2. End-of-an-Era = 2.
   *  Festival Captains = 3. */
  nationSymbols?: number;
  /** When true and the card is in-position, slot scores a flat 3
   *  regardless of link counts. Heroes / Icons / Positional-Excellence
   *  Evos / End-of-an-Era. */
  fullChemInPosition?: boolean;
};

export type ChemistryCard = {
  club: string | null;
  league: string | null;
  nation: string | null;
  position: string;
  positionsAlt: string[];
  itemType: FCItemType | string;
  /** Optional Futbin variant slug ("150-cornerstones", "72-heroes",
   *  "12-icon", "5-toty"). Used by `deriveChemBonus()` to recognize
   *  promo subclasses with non-default chem-symbol contributions. */
  variant?: string | null;
  /** Optional explicit override — wins over `deriveChemBonus()`. */
  chemBonus?: ChemistryBonus | null;
  // Optional name — only used for human-readable warnings.
  name?: string;
};

export type SlotFill = {
  card: ChemistryCard | null;
  positionInLineup: string;
};

export type ManagerLink = {
  /** Nation NAME (e.g. "France") — matched against card.nation
   *  case-insensitive after `norm()`. NULL skips nation matching. */
  nation: string | null;
  /** League NAME (e.g. "Ligue 1 McDonald's") — matched via
   *  `getLeagueFamily()` so men's/women's collapse. NULL skips. */
  league: string | null;
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

/**
 * EA FC 26 league-family map — collapses men's + women's editions of the
 * same competition (and seasonal rebrands) into a single family key for
 * tier-link counting. Verified 2026-05-02 against Futbin chemistry totals
 * (Adefola squad audit: -5 delta vs Futbin closed when Premier League ↔
 * Barclays WSL and Ligue 1 ↔ D1 Arkema were grouped).
 *
 * Sources:
 *   - operationsports.com FC 26 chemistry guide
 *   - fifauteam.com FC 26 chemistry rules
 *   - empirical Futbin squad-builder totals
 *   - Wikipedia / FFF.fr for sponsor-rebrand confirmations
 *     (Serie A TIM → Serie A Enilive 2024; D1 Arkema → Arkema Première
 *     Ligue 2024; Liga F → Liga F Moeve 2024)
 *
 * Keys are LOWERCASED league strings (matching `norm()`); values are the
 * canonical family slug. League names not in the map default to themselves
 * (each unmapped league is its own family — handled in `getLeagueFamily`).
 */
export const LEAGUE_FAMILIES: Record<string, string> = {
  // ─── England ────────────────────────────────────────────────────────────
  "premier league": "fam-eng-top",
  "barclays wsl": "fam-eng-top",
  // ─── Italy ──────────────────────────────────────────────────────────────
  // Serie A TIM (legacy sponsor) ≡ Serie A Enilive (current). Same league.
  "serie a tim": "fam-ita-top",
  "serie a enilive": "fam-ita-top",
  // Italian women's top flight.
  "calcio a femminile": "fam-ita-top",
  // ─── France ─────────────────────────────────────────────────────────────
  "ligue 1 mcdonald's": "fam-fra-top",
  // D1 Arkema → Arkema Première Ligue (rebrand 2024). Both DB strings live.
  "d1 arkema": "fam-fra-top",
  "arkema pl": "fam-fra-top",
  // ─── Germany ────────────────────────────────────────────────────────────
  // Bundesliga + Frauen-Bundesliga (no Frauen entry in current FCDB; kept
  // as singleton family for forward-compat).
  bundesliga: "fam-ger-top",
  // ─── Spain ──────────────────────────────────────────────────────────────
  "laliga ea sports": "fam-esp-top",
  // Liga F → Liga F Moeve (sponsor rebrand 2024). Same league.
  "liga f": "fam-esp-top",
  "liga f moeve": "fam-esp-top",
  // ─── Netherlands ────────────────────────────────────────────────────────
  eredivisie: "fam-ned-top",
  "nederland vrouwen liga": "fam-ned-top",
  // ─── Portugal ───────────────────────────────────────────────────────────
  "liga portugal": "fam-por-top",
  "liga portugal feminino": "fam-por-top",
  // ─── Switzerland ────────────────────────────────────────────────────────
  // Brack Super League ≡ Swiss Super League (sponsor rebrand). Plus women's.
  "swiss super league": "fam-sui-top",
  "brack super league": "fam-sui-top",
  "schweizer damen liga": "fam-sui-top",
  // ─── Czech Republic ─────────────────────────────────────────────────────
  "česká liga": "fam-cze-top",
  "ceska liga žen": "fam-cze-top",
  // ─── Scotland ───────────────────────────────────────────────────────────
  // "Scottish Prem" + "Scottish Premiership" appear as separate strings in
  // the FCDB DISTINCT list — same competition, scrape-pass naming variance.
  "scottish prem": "fam-sco-top",
  "scottish premiership": "fam-sco-top",
  "scottish women's league": "fam-sco-top",
  // ─── Sweden ─────────────────────────────────────────────────────────────
  // Allsvenskan (men) ≡ Sverige Liga (FCDB string variant).
  allsvenskan: "fam-swe-top",
  "sverige liga": "fam-swe-top",
};

/**
 * Resolve a league string to its chemistry family key. Unknown leagues
 * default to their own normalized name (each unmapped league is its own
 * family). NULL / empty input returns NULL.
 */
export function getLeagueFamily(league: string | null | undefined): string | null {
  const key = norm(league);
  if (!key) return null;
  return LEAGUE_FAMILIES[key] ?? key;
}

/**
 * Derive the chem-bonus shape from a card's `itemType` + Futbin variant
 * slug. Pure function — no DB I/O. Used by callers that build a
 * `ChemistryCard` from a `fc26_players` row to auto-fill `chemBonus`
 * without touching the schema.
 *
 * Returns null when no override applies (the chem calc then uses default
 * 1-per-axis contribution).
 *
 * Promo recognition is regex-on-variant-slug. Variant strings come from
 * Futbin's CDN card-art path (`/cards/tiny/<id>_<slug>.png`) and look
 * like `150-cornerstones`, `28-festival-of-football-captains`,
 * `72-heroes`, `12-icon`, `155-toty-icon`, `49-winter-wildcards-hero`
 * etc. The regex catches both the bare slug ("cornerstones") AND
 * compound variants ("xyz-icon", "abc-hero").
 */
export function deriveChemBonus(
  itemType: string | null | undefined,
  variant: string | null | undefined,
): ChemistryBonus | null {
  const v = (variant ?? "").toLowerCase();
  const t = (itemType ?? "").toLowerCase();

  // Icons (incl. all *-icon variants: TOTY Icon, FUT Birthday Icon,
  // Trophy Titans Icon, Champion Icon, etc.).
  if (t === "icon" || /\bicon\b/.test(v)) {
    return {
      clubSymbols: 0,
      leagueSymbols: 0,
      leagueSymbolsAllLeagues: true,
      nationSymbols: 2,
      fullChemInPosition: true,
    };
  }

  // Heroes (incl. all *-hero(es) variants: Winter Wildcards Hero, Joga
  // Bonito Hero, FUT Birthday Hero, Fantasy FC Hero, Trophy Titans Hero,
  // Ultimate Scream Hero, Thunderstruck Hero, etc.).
  if (t === "hero" || /\bhero(es)?\b/.test(v)) {
    return {
      clubSymbols: 0,
      leagueSymbols: 2,
      nationSymbols: 1,
      fullChemInPosition: true,
    };
  }

  // End of an Era — Icon-like contribution but NOT itemType='icon'.
  if (/\bend-of-an-era\b/.test(v)) {
    return {
      clubSymbols: 0,
      leagueSymbols: 0,
      leagueSymbolsAllLeagues: true,
      nationSymbols: 2,
      fullChemInPosition: true,
    };
  }

  // Cornerstones — +1 club symbol (so 2 total). Live in DB as
  // `150-cornerstones`.
  if (/\bcornerstones?\b/.test(v)) {
    return { clubSymbols: 2 };
  }

  // Squad Foundations — +1 league symbol (so 2 total).
  if (/\bsquad-foundations?\b/.test(v)) {
    return { leagueSymbols: 2 };
  }

  // World Tour — +1 nation symbol (so 2 total).
  if (/\bworld-tour\b/.test(v)) {
    return { nationSymbols: 2 };
  }

  // Festival of Football Captains — +2 nation symbols (so 3 total). Live
  // in DB as `28-festival-of-football-captains`.
  if (/\bfestival-of-football-captains?\b|\bfof-captains?\b/.test(v)) {
    return { nationSymbols: 3 };
  }

  // Positional Excellence Evos — full chem when in unlocked position.
  // Caller must pre-ensure the card's `position` / `positionsAlt`
  // already reflect the unlocked slot from the Evo path.
  if (/\bpositional-excellence\b/.test(v)) {
    return { fullChemInPosition: true };
  }

  return null;
}

/**
 * Resolve the effective chem-bonus for a card: explicit override wins;
 * otherwise derive from itemType + variant. Returns null when card has
 * no special bonus (regular contribution rules apply).
 */
function resolveBonus(card: ChemistryCard): ChemistryBonus | null {
  if (card.chemBonus !== undefined && card.chemBonus !== null) {
    return card.chemBonus;
  }
  return deriveChemBonus(card.itemType, card.variant);
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
  // family/club key → effective count contributed by all cards toward
  // this counter
  clubs: Map<string, number>;
  leagues: Map<string, number>;
  nations: Map<string, number>;
  // Cards that contribute +1 to EVERY league counter (Icons,
  // End-of-an-Era). Counted once + applied at score time so ALL
  // teammates see the bump — including teammates whose league is
  // otherwise unmatched.
  iconCount: number;
};

/**
 * Build the link-contribution maps from a pool of cards. Each card's
 * contribution is added to the map regardless of whether it is in-position
 * (the positional gate is only applied when scoring a slot, not when
 * computing teammate contributions).
 */
function buildContributions(cards: ChemistryCard[]): LinkContributions {
  const clubs = new Map<string, number>();
  const leagues = new Map<string, number>();
  const nations = new Map<string, number>();
  let iconCount = 0;

  for (const c of cards) {
    const bonus = resolveBonus(c);
    const clubSymbols = bonus?.clubSymbols ?? 1;
    const leagueSymbols = bonus?.leagueSymbols ?? 1;
    const nationSymbols = bonus?.nationSymbols ?? 1;
    const allLeagues = bonus?.leagueSymbolsAllLeagues ?? false;

    const clubKey = norm(c.club);
    const leagueKey = getLeagueFamily(c.league);
    const nationKey = norm(c.nation);

    if (clubKey && clubSymbols > 0) {
      clubs.set(clubKey, (clubs.get(clubKey) ?? 0) + clubSymbols);
    }
    if (leagueKey && leagueSymbols > 0) {
      leagues.set(leagueKey, (leagues.get(leagueKey) ?? 0) + leagueSymbols);
    }
    if (nationKey && nationSymbols > 0) {
      nations.set(nationKey, (nations.get(nationKey) ?? 0) + nationSymbols);
    }
    if (allLeagues) iconCount += 1;
  }

  return { clubs, leagues, nations, iconCount };
}

/**
 * Score a single slot given the link-contribution pool. Applies positional
 * gate first — out-of-position → 0 regardless of links. Cards with
 * `fullChemInPosition` (Heroes / Icons / End-of-an-Era / Positional
 * Excellence) get a flat 3 when in position.
 */
function scoreSlot(
  fill: SlotFill,
  pool: LinkContributions,
  manager?: ManagerLink | null,
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

  const bonus = resolveBonus(card);
  if (bonus?.fullChemInPosition) {
    return { chem: SLOT_CHEM_CAP };
  }

  const clubKey = norm(card.club);
  const leagueKey = getLeagueFamily(card.league);
  const nationKey = norm(card.nation);

  const clubCount = clubKey ? (pool.clubs.get(clubKey) ?? 0) : 0;
  // League count includes iconCount (icons + end-of-an-era count as
  // "any league"). Cards with no league (NULL leagueKey) get 0 — the
  // all-leagues bonus only applies to a league that's already populated
  // by the card itself.
  const leagueCount = leagueKey
    ? (pool.leagues.get(leagueKey) ?? 0) + pool.iconCount
    : 0;
  const nationCount = nationKey ? (pool.nations.get(nationKey) ?? 0) : 0;

  const clubPts = pickTier(clubCount, TIER_THRESHOLDS.club);
  const leaguePts = pickTier(leagueCount, TIER_THRESHOLDS.league);
  const nationPts = pickTier(nationCount, TIER_THRESHOLDS.nation);

  let sum = clubPts + leaguePts + nationPts;

  // Manager bonus: +1 if nation OR league matches (capped at +1 per
  // card even when both match). Applied INSIDE the 3-per-slot cap.
  if (manager) {
    const mgrNation = norm(manager.nation);
    const mgrLeague = getLeagueFamily(manager.league);
    if (
      (mgrNation && mgrNation === nationKey) ||
      (mgrLeague && mgrLeague === leagueKey)
    ) {
      sum += 1;
    }
  }

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
 *
 * `manager` is optional — when provided, each in-position starter (and
 * sub) earns +1 chem if their nation OR league matches the manager's,
 * capped within the 3-per-slot cap. Pass null/undefined to skip (current
 * default since the platform does not yet track a manager item).
 */
export function computeChemistry(
  starting: SlotFill[],
  _formation?: FormationKey,
  subs?: SlotFill[],
  manager?: ManagerLink | null,
): ChemistryResult {
  // Build starting-11 link pool from ONLY filled slots (regardless of
  // positional status — misplaced cards still help teammates in this
  // pool-build step; the position gate is applied per-slot in scoreSlot).
  const startingCards = starting
    .map((f) => f.card)
    .filter((c): c is ChemistryCard => !!c);

  const pool = buildContributions(startingCards);

  const perSlot: number[] = [];
  const warnings: string[] = [];
  let total = 0;
  for (const fill of starting) {
    const { chem, warning } = scoreSlot(fill, pool, manager);
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

  // Subs: scored against the starting-11 pool. Still gated on position +
  // manager bonus applies.
  if (subs && subs.length > 0) {
    const subsPerSlot: number[] = [];
    let subsTotal = 0;
    for (const fill of subs) {
      const { chem, warning } = scoreSlot(fill, pool, manager);
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
