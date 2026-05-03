import { describe, it, expect } from "vitest";
import {
  calculateChemistry,
  computeChemistry,
  deriveChemBonus,
  getLeagueFamily,
  isInPosition,
  LEAGUE_FAMILIES,
  slotsToSlotFills,
  TIER_THRESHOLDS,
  type ChemistryCard,
  type ManagerLink,
  type SlotFill,
  type LegacyChemistryCard,
} from "./chemistry";

// ─── Card + slot helpers ──────────────────────────────────────────────────

function mk(over: Partial<ChemistryCard> = {}): ChemistryCard {
  return {
    club: over.club ?? null,
    league: over.league ?? null,
    nation: over.nation ?? null,
    position: over.position ?? "ST",
    positionsAlt: over.positionsAlt ?? [],
    itemType: over.itemType ?? "normal",
    variant: over.variant ?? null,
    chemBonus: over.chemBonus ?? null,
    name: over.name,
  };
}

// 4-3-3 starting labels (from PitchLayout) — stable order GK, LB, CB, CB, RB,
// CM, CM, CM, LW, ST, RW. We use this for tests because it matches the
// default formation the picker opens with.
const LINEUP_433: string[] = [
  "GK",
  "LB",
  "CB",
  "CB",
  "RB",
  "CM",
  "CM",
  "CM",
  "LW",
  "ST",
  "RW",
];

function startingFromCards(
  cards: Array<ChemistryCard | null>,
  labels: string[] = LINEUP_433,
): SlotFill[] {
  return labels.map((label, i) => ({
    card: cards[i] ?? null,
    positionInLineup: label,
  }));
}

// ─── Legacy calculateChemistry (kept as a back-compat shim) ───────────────

describe("calculateChemistry (legacy back-compat)", () => {
  function mkLegacy(over: Partial<LegacyChemistryCard> = {}): LegacyChemistryCard {
    return {
      club: over.club ?? null,
      league: over.league ?? null,
      nation: over.nation ?? null,
    };
  }

  it("returns 0 for a single card (no link possible)", () => {
    expect(calculateChemistry([mkLegacy({ club: "Real Madrid" })])).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(calculateChemistry([])).toBe(0);
  });

  it("returns 100 when all 11 cards share club + league + nation", () => {
    const eleven = Array.from({ length: 11 }, () =>
      mkLegacy({ club: "Real Madrid", league: "La Liga", nation: "Spain" }),
    );
    expect(calculateChemistry(eleven)).toBe(100);
  });

  it("caps at 100", () => {
    const many = Array.from({ length: 23 }, () =>
      mkLegacy({ club: "A", league: "A", nation: "A" }),
    );
    expect(calculateChemistry(many)).toBeLessThanOrEqual(100);
  });
});

// ─── isInPosition unit tests ──────────────────────────────────────────────

describe("isInPosition", () => {
  it("matches primary position case-insensitively", () => {
    const c = mk({ position: "ST", positionsAlt: [] });
    expect(isInPosition(c, "ST")).toBe(true);
    expect(isInPosition(c, "st")).toBe(true);
  });

  it("matches any alt position", () => {
    const c = mk({ position: "CM", positionsAlt: ["CAM", "CDM"] });
    expect(isInPosition(c, "CAM")).toBe(true);
    expect(isInPosition(c, "CDM")).toBe(true);
  });

  it("returns false for unrelated position", () => {
    const c = mk({ position: "ST", positionsAlt: ["CF"] });
    expect(isInPosition(c, "GK")).toBe(false);
    expect(isInPosition(c, "CB")).toBe(false);
  });
});

// ─── Tier thresholds exported for visibility ──────────────────────────────

describe("TIER_THRESHOLDS", () => {
  it("encodes spec tier boundaries", () => {
    // Club: ≥2 → 1, ≥4 → 2, ≥7 → 3
    expect(TIER_THRESHOLDS.club.some((r) => r.min === 2 && r.pts === 1)).toBe(
      true,
    );
    expect(TIER_THRESHOLDS.club.some((r) => r.min === 4 && r.pts === 2)).toBe(
      true,
    );
    expect(TIER_THRESHOLDS.club.some((r) => r.min === 7 && r.pts === 3)).toBe(
      true,
    );
    // League: ≥3 → 1, ≥5 → 2, ≥8 → 3
    expect(TIER_THRESHOLDS.league.some((r) => r.min === 3 && r.pts === 1)).toBe(
      true,
    );
    expect(TIER_THRESHOLDS.league.some((r) => r.min === 5 && r.pts === 2)).toBe(
      true,
    );
    expect(TIER_THRESHOLDS.league.some((r) => r.min === 8 && r.pts === 3)).toBe(
      true,
    );
    // Nation: ≥2 → 1, ≥5 → 2, ≥8 → 3
    expect(TIER_THRESHOLDS.nation.some((r) => r.min === 2 && r.pts === 1)).toBe(
      true,
    );
    expect(TIER_THRESHOLDS.nation.some((r) => r.min === 5 && r.pts === 2)).toBe(
      true,
    );
    expect(TIER_THRESHOLDS.nation.some((r) => r.min === 8 && r.pts === 3)).toBe(
      true,
    );
  });
});

// ─── computeChemistry behaviour ───────────────────────────────────────────

describe("computeChemistry", () => {
  it("returns 0 totalChem when all 11 starting slots empty", () => {
    const starting: SlotFill[] = LINEUP_433.map((label) => ({
      card: null,
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);
    expect(r.totalChem).toBe(0);
    expect(r.perSlot).toHaveLength(11);
    expect(r.perSlot.every((p) => p === 0)).toBe(true);
  });

  it("returns 0 for single player with no teammates (no links formed)", () => {
    const cards: Array<ChemistryCard | null> = [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      mk({
        club: "PSG",
        league: "Ligue 1",
        nation: "France",
        position: "ST",
      }),
      null,
    ];
    const starting = startingFromCards(cards);
    const r = computeChemistry(starting);
    expect(r.totalChem).toBe(0);
  });

  it("all 11 same club → each in-pos slot ≥ 3 (capped at 3 per slot), total 33", () => {
    // Use the 4-3-3 labels. Give every card the MATCHING primary position
    // for its slot so in-position is true everywhere.
    const starting: SlotFill[] = LINEUP_433.map((label) => ({
      card: mk({
        club: "Real Madrid",
        league: "La Liga",
        nation: "Spain",
        position: label,
      }),
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);
    // Every slot should be capped at 3 (club ≥ 7 → 3 alone, plus league+nation).
    expect(r.perSlot.every((p) => p === 3)).toBe(true);
    expect(r.totalChem).toBe(33);
    expect(r.warnings).toHaveLength(0);
  });

  it("three nationalities spread (6/4/1) tier correctly", () => {
    // 6 Spain, 4 France, 1 Brazil. Spain: ≥5 → 2 nation pts. France: ≥2
    // but <5 → 1 nation pt. Brazil alone → 0.
    // All same league to isolate nation contribution (League share → large).
    const spain = (label: string) =>
      mk({
        nation: "Spain",
        league: "La Liga",
        club: "Real Madrid",
        position: label,
      });
    const france = (label: string) =>
      mk({
        nation: "France",
        league: "La Liga",
        club: "PSG",
        position: label,
      });
    const brazil = (label: string) =>
      mk({
        nation: "Brazil",
        league: "La Liga",
        club: "Santos",
        position: label,
      });

    const labels = LINEUP_433;
    const cards: ChemistryCard[] = [
      spain(labels[0]),
      spain(labels[1]),
      spain(labels[2]),
      spain(labels[3]),
      spain(labels[4]),
      spain(labels[5]),
      france(labels[6]),
      france(labels[7]),
      france(labels[8]),
      france(labels[9]),
      brazil(labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // Spain players: league (all 11 same) ≥8 → 3 league, but cap slot to 3.
    // So all slots hit the 3 cap via league alone. That makes it hard to
    // verify nation tiers from the total. Run an isolated calculation on
    // a single Spain card vs French card vs Brazil via perSlot sanity:
    // every slot caps at 3 because league count is 11.
    expect(r.perSlot.every((p) => p === 3)).toBe(true);
    expect(r.totalChem).toBe(33);
  });

  it("isolated nation tiering — distinct leagues/clubs show nation pts alone", () => {
    // Build a squad with ALL DISTINCT clubs + leagues but mixed nations so
    // nation is the only link. 6 Spain (→2 pts), 4 France (→1 pt), 1 Brazil (→0).
    const uniqueLeague = (i: number) => `L${i}`;
    const uniqueClub = (i: number) => `C${i}`;

    const labels = LINEUP_433;
    const cards: ChemistryCard[] = [];
    for (let i = 0; i < 11; i++) {
      const nation = i < 6 ? "Spain" : i < 10 ? "France" : "Brazil";
      cards.push(
        mk({
          nation,
          league: uniqueLeague(i),
          club: uniqueClub(i),
          position: labels[i],
        }),
      );
    }
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // Spain (6 players): nation ≥5 → 2 pts; no league/club links → slot chem = 2.
    // France (4 players): nation ≥2 but <5 → 1 pt; slot chem = 1.
    // Brazil alone: nation < 2 → 0 pts.
    const spainPts = r.perSlot.slice(0, 6);
    const francePts = r.perSlot.slice(6, 10);
    const brazilPts = r.perSlot[10];

    expect(spainPts.every((p) => p === 2)).toBe(true);
    expect(francePts.every((p) => p === 1)).toBe(true);
    expect(brazilPts).toBe(0);
    expect(r.totalChem).toBe(6 * 2 + 4 * 1 + 0);
  });

  it("out-of-position card earns 0 chem on its own slot but still helps teammates", () => {
    // 11 Real Madrid / La Liga / Spain players. 10 are in-position. Slot 9
    // is a "ST" card dumped at "GK" — out-of-position → chem 0. But the
    // card's links still contribute to the other 10 slots' counts.
    const labels = LINEUP_433;
    const starting: SlotFill[] = labels.map((label, i) => {
      // For slot 0 (GK), put an ST card — out of position.
      if (i === 0) {
        return {
          card: mk({
            club: "Real Madrid",
            league: "La Liga",
            nation: "Spain",
            position: "ST", // wrong for GK
            positionsAlt: [],
            name: "Out-Of-Pos Guy",
          }),
          positionInLineup: label,
        };
      }
      return {
        card: mk({
          club: "Real Madrid",
          league: "La Liga",
          nation: "Spain",
          position: label,
        }),
        positionInLineup: label,
      };
    });

    const r = computeChemistry(starting);
    // Slot 0 is out-of-position → 0.
    expect(r.perSlot[0]).toBe(0);
    // Warnings list surfaces the mis-pos card.
    expect(r.warnings.some((w) => w.includes("Out-Of-Pos Guy"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("GK"))).toBe(true);
    // The other 10 slots still see 11-way club/league/nation links because
    // the mis-pos card still contributed.
    for (let i = 1; i < 11; i++) {
      expect(r.perSlot[i]).toBe(3);
    }
    // Total = 10 × 3 + 0 = 30.
    expect(r.totalChem).toBe(30);
  });

  it("icon in-position → slot chem 3, and icon counts as 'any league' for teammates", () => {
    // 10 French / Ligue 1 / PSG + 1 Icon (Italian). The icon sits at ST
    // in-position → 3 chem. The 10 French should see league = 10 + iconCount
    // = 11 → ≥8 → 3 pts league alone, so everyone at 3.
    const labels = LINEUP_433;
    const starting: SlotFill[] = labels.map((label, i) => {
      if (i === 9) {
        // Icon at ST.
        return {
          card: mk({
            club: "Icons FC", // clubs are weird for icons; use a distinct name
            league: "Icons League",
            nation: "Italy",
            position: "ST",
            itemType: "icon",
            name: "Pele",
          }),
          positionInLineup: label,
        };
      }
      return {
        card: mk({
          club: "PSG",
          league: "Ligue 1",
          nation: "France",
          position: label,
        }),
        positionInLineup: label,
      };
    });

    const r = computeChemistry(starting);
    // Icon slot → flat 3.
    expect(r.perSlot[9]).toBe(3);
    // Others: league count includes iconCount (1), so 10 same-league + 1 icon
    // = 11 effective → ≥8 → 3 league pts. Slot caps at 3 either way.
    for (let i = 0; i < 11; i++) {
      if (i === 9) continue;
      expect(r.perSlot[i]).toBe(3);
    }
    expect(r.totalChem).toBe(33);
    expect(r.warnings).toHaveLength(0);
  });

  it("icon OUT-of-position → still 0 chem (gate applies)", () => {
    const labels = LINEUP_433;
    const starting: SlotFill[] = labels.map((label, i) => {
      if (i === 0) {
        // Icon declared as ST, dumped at GK.
        return {
          card: mk({
            club: "Icons",
            league: "IconLeague",
            nation: "Italy",
            position: "ST",
            itemType: "icon",
            name: "IconST",
          }),
          positionInLineup: label, // "GK"
        };
      }
      return {
        card: mk({
          club: "PSG",
          league: "Ligue 1",
          nation: "France",
          position: label,
        }),
        positionInLineup: label,
      };
    });
    const r = computeChemistry(starting);
    expect(r.perSlot[0]).toBe(0);
    expect(r.warnings.some((w) => w.includes("IconST"))).toBe(true);
  });

  it("hero bonus visible in neighbouring slots' league tier", () => {
    // 3 La Liga players + 1 hero whose league is La Liga (hero adds +2 to
    // league count, so total effective = 3 + 2 = 5 → tier 2 for other La
    // Liga slots). All distinct clubs + nations to isolate the league bonus.
    // Plus 7 dummies to fill the 11 slots (distinct league/club/nation).
    const labels = LINEUP_433;
    const liga = (idx: number, label: string) =>
      mk({
        league: "La Liga",
        nation: `NN${idx}`, // distinct
        club: `LC${idx}`, // distinct
        position: label,
      });
    const hero = (label: string) =>
      mk({
        league: "La Liga",
        nation: "Unique-Hero-Nation",
        club: "Unique-Hero-Club",
        position: label,
        itemType: "hero",
        name: "HeroX",
      });
    const dummy = (idx: number, label: string) =>
      mk({
        league: `DL${idx}`,
        nation: `DN${idx}`,
        club: `DC${idx}`,
        position: label,
      });

    const cards: ChemistryCard[] = [];
    // 3 Liga (indices 0..2) + 1 hero (index 3, Liga) + 7 dummies (4..10).
    cards.push(liga(0, labels[0]));
    cards.push(liga(1, labels[1]));
    cards.push(liga(2, labels[2]));
    cards.push(hero(labels[3]));
    for (let i = 4; i < 11; i++) cards.push(dummy(i, labels[i]));

    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // La Liga count for a non-hero La Liga player (self-exclusion not
    // applied; we count all cards in pool including self):
    // pool has 3 non-hero +2 from hero = 5. Tier ≥5 → 2 pts league.
    // No other link (distinct clubs/nations) → slot chem = 2.
    for (let i = 0; i < 3; i++) {
      expect(r.perSlot[i]).toBe(2);
    }

    // Hero slot itself → flat 3 (in-position).
    expect(r.perSlot[3]).toBe(3);

    // Dummies → 0 (no links).
    for (let i = 4; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
  });

  it("empty starting + all subs filled → totalChem is 0 (starting-gate)", () => {
    const labels = LINEUP_433;
    const starting: SlotFill[] = labels.map((label) => ({
      card: null,
      positionInLineup: label,
    }));
    // 7 subs all same club/league/nation, all in-pos.
    const subs: SlotFill[] = Array.from({ length: 7 }, () => ({
      card: mk({
        club: "Real Madrid",
        league: "La Liga",
        nation: "Spain",
        position: "ST",
      }),
      positionInLineup: "ST",
    }));
    const r = computeChemistry(starting, undefined, subs);
    // Starting total = 0 (no starters filled).
    expect(r.totalChem).toBe(0);
    // Subs don't contribute to the pool, so each sub sees pool = {} and
    // scores 0 chem (no links).
    expect(r.subsTotalChem).toBe(0);
  });

  it("subs earn chem based on starting-11 pool", () => {
    // 11 starting La Liga players (all same club/league/nation) + 1 sub
    // that shares the league. Sub should earn some chem.
    const labels = LINEUP_433;
    const starting: SlotFill[] = labels.map((label) => ({
      card: mk({
        club: "Real Madrid",
        league: "La Liga",
        nation: "Spain",
        position: label,
      }),
      positionInLineup: label,
    }));
    // Sub: shares league only.
    const subs: SlotFill[] = [
      {
        card: mk({
          club: "FC Barcelona",
          league: "La Liga",
          nation: "Argentina",
          position: "ST",
        }),
        positionInLineup: "ST",
      },
    ];
    const r = computeChemistry(starting, undefined, subs);
    // Starting all capped at 3 → total 33.
    expect(r.totalChem).toBe(33);
    // Sub sees pool with 11 La Liga → league ≥8 → 3 pts. Other axes 0.
    // Slot caps at 3 → subsTotalChem 3.
    expect(r.subsTotalChem).toBe(3);
  });

  it("totalChem caps at 33 even if perSlot would sum to more", () => {
    // Impossible via perSlot (capped at 3) but keep this as a defensive check.
    const labels = LINEUP_433;
    const starting: SlotFill[] = labels.map((label) => ({
      card: mk({
        club: "Real Madrid",
        league: "La Liga",
        nation: "Spain",
        position: label,
      }),
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);
    expect(r.totalChem).toBeLessThanOrEqual(33);
  });
});

// ─── getLeagueFamily / LEAGUE_FAMILIES (FC 26 league grouping) ────────────

describe("getLeagueFamily", () => {
  it("returns null for null/empty input", () => {
    expect(getLeagueFamily(null)).toBeNull();
    expect(getLeagueFamily(undefined)).toBeNull();
    expect(getLeagueFamily("")).toBeNull();
    expect(getLeagueFamily("   ")).toBeNull();
  });

  it("normalizes case + whitespace before lookup", () => {
    expect(getLeagueFamily("Premier League")).toBe("fam-eng-top");
    expect(getLeagueFamily("PREMIER LEAGUE")).toBe("fam-eng-top");
    expect(getLeagueFamily("  premier league  ")).toBe("fam-eng-top");
  });

  it("groups Premier League and Barclays WSL into the same family", () => {
    expect(getLeagueFamily("Premier League")).toBe(
      getLeagueFamily("Barclays WSL"),
    );
  });

  it("groups Serie A men's + women's + sponsor rebrands into one family", () => {
    const fam = getLeagueFamily("Serie A TIM");
    expect(fam).toBe("fam-ita-top");
    expect(getLeagueFamily("Serie A Enilive")).toBe(fam);
    expect(getLeagueFamily("Calcio A Femminile")).toBe(fam);
  });

  it("groups Ligue 1 + D1 Arkema + Arkema PL into one family", () => {
    const fam = getLeagueFamily("Ligue 1 McDonald's");
    expect(fam).toBe("fam-fra-top");
    expect(getLeagueFamily("D1 Arkema")).toBe(fam);
    expect(getLeagueFamily("Arkema PL")).toBe(fam);
  });

  it("groups LALIGA EA SPORTS + Liga F variants", () => {
    const fam = getLeagueFamily("LALIGA EA SPORTS");
    expect(fam).toBe("fam-esp-top");
    expect(getLeagueFamily("Liga F")).toBe(fam);
    expect(getLeagueFamily("Liga F Moeve")).toBe(fam);
  });

  it("keeps genuinely different competitions in separate families", () => {
    expect(getLeagueFamily("Bundesliga")).not.toBe(
      getLeagueFamily("Ligue 1 McDonald's"),
    );
    expect(getLeagueFamily("Premier League")).not.toBe(
      getLeagueFamily("Serie A TIM"),
    );
    expect(getLeagueFamily("LALIGA EA SPORTS")).not.toBe(
      getLeagueFamily("Premier League"),
    );
  });

  it("unmapped league becomes its own family (its normalized name)", () => {
    const fam = getLeagueFamily("Some Unmapped Liga");
    expect(fam).toBe("some unmapped liga");
    // And two unmapped strings stay distinct.
    expect(getLeagueFamily("Other Unmapped Liga")).not.toBe(fam);
  });
});

describe("LEAGUE_FAMILIES map", () => {
  it("includes the high-volume FC 26 men's/women's pairs", () => {
    // English top flight
    expect(LEAGUE_FAMILIES["premier league"]).toBe(
      LEAGUE_FAMILIES["barclays wsl"],
    );
    // French top flight + women's rebrand
    expect(LEAGUE_FAMILIES["ligue 1 mcdonald's"]).toBe(
      LEAGUE_FAMILIES["d1 arkema"],
    );
    // Italian top flight + sponsor rebrand
    expect(LEAGUE_FAMILIES["serie a tim"]).toBe(
      LEAGUE_FAMILIES["serie a enilive"],
    );
  });
});

describe("computeChemistry — league-family grouping", () => {
  // Build 11 cards split into mixed-gender top-flight English so the league
  // family rule pushes the league count above the next tier threshold.
  it("Premier League + Barclays WSL count toward the SAME tier (count = 5 → 2 league pts)", () => {
    const labels = LINEUP_433;
    // 3 Premier League + 2 Barclays WSL, ALL DISTINCT clubs + nations so
    // ONLY league grouping can drive points (no club, no nation links).
    // Plus 6 dummies so the squad has 11 starters.
    const pl = (i: number, label: string) =>
      mk({
        league: "Premier League",
        club: `PLC${i}`,
        nation: `PLN${i}`,
        position: label,
      });
    const wsl = (i: number, label: string) =>
      mk({
        league: "Barclays WSL",
        club: `WSLC${i}`,
        nation: `WSLN${i}`,
        position: label,
      });
    const dummy = (i: number, label: string) =>
      mk({
        league: `OtherLeague${i}`,
        club: `OtherC${i}`,
        nation: `OtherN${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      pl(0, labels[0]),
      pl(1, labels[1]),
      pl(2, labels[2]),
      wsl(3, labels[3]),
      wsl(4, labels[4]),
      dummy(5, labels[5]),
      dummy(6, labels[6]),
      dummy(7, labels[7]),
      dummy(8, labels[8]),
      dummy(9, labels[9]),
      dummy(10, labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // Family count = 3 + 2 = 5 → tier ≥5 → 2 league pts each.
    // No club, no nation links → slot chem = 2 for the 5 family cards.
    for (let i = 0; i < 5; i++) {
      expect(r.perSlot[i]).toBe(2);
    }
    // Dummies → 0.
    for (let i = 5; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
    expect(r.totalChem).toBe(5 * 2);
  });

  it("Serie A TIM + Calcio A Femminile (women's Italian) count together", () => {
    const labels = LINEUP_433;
    const tim = (i: number, label: string) =>
      mk({
        league: "Serie A TIM",
        club: `TIMC${i}`,
        nation: `TIMN${i}`,
        position: label,
      });
    const fem = (i: number, label: string) =>
      mk({
        league: "Calcio A Femminile",
        club: `FEMC${i}`,
        nation: `FEMN${i}`,
        position: label,
      });
    const dummy = (i: number, label: string) =>
      mk({
        league: `D${i}`,
        club: `DC${i}`,
        nation: `DN${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      tim(0, labels[0]),
      tim(1, labels[1]),
      tim(2, labels[2]),
      fem(3, labels[3]),
      fem(4, labels[4]),
      fem(5, labels[5]),
    ];
    while (cards.length < 11) cards.push(dummy(cards.length, labels[cards.length]));

    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // Family count = 6 → tier ≥5 → 2 league pts.
    for (let i = 0; i < 6; i++) {
      expect(r.perSlot[i]).toBe(2);
    }
  });

  it("Ligue 1 McDonald's + D1 Arkema → same family", () => {
    const labels = LINEUP_433;
    const ligue = (i: number, label: string) =>
      mk({
        league: "Ligue 1 McDonald's",
        club: `LC${i}`,
        nation: `LN${i}`,
        position: label,
      });
    const arkema = (i: number, label: string) =>
      mk({
        league: "D1 Arkema",
        club: `AC${i}`,
        nation: `AN${i}`,
        position: label,
      });
    const dummy = (i: number, label: string) =>
      mk({
        league: `D${i}`,
        club: `DC${i}`,
        nation: `DN${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      ligue(0, labels[0]),
      ligue(1, labels[1]),
      ligue(2, labels[2]),
      arkema(3, labels[3]),
      arkema(4, labels[4]),
    ];
    while (cards.length < 11) cards.push(dummy(cards.length, labels[cards.length]));

    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // Family count 5 → tier ≥5 → 2 league pts.
    for (let i = 0; i < 5; i++) {
      expect(r.perSlot[i]).toBe(2);
    }
  });

  it("Bundesliga + Ligue 1 stay in SEPARATE families", () => {
    const labels = LINEUP_433;
    const buli = (i: number, label: string) =>
      mk({
        league: "Bundesliga",
        club: `BC${i}`,
        nation: `BN${i}`,
        position: label,
      });
    const ligue = (i: number, label: string) =>
      mk({
        league: "Ligue 1 McDonald's",
        club: `LC${i}`,
        nation: `LN${i}`,
        position: label,
      });
    const cards: ChemistryCard[] = [];
    // 3 Buli + 3 Ligue 1 + 5 dummies. NEITHER family hits tier 1 (≥3) on
    // its own with 3 cards each, so we need to confirm they don't share.
    // We use 2 of each + some non-family fills to fall just below the
    // tier-1 threshold of 3.
    cards.push(buli(0, labels[0]));
    cards.push(buli(1, labels[1]));
    cards.push(ligue(2, labels[2]));
    cards.push(ligue(3, labels[3]));
    while (cards.length < 11) {
      const i = cards.length;
      cards.push(
        mk({
          league: `Other${i}`,
          club: `OC${i}`,
          nation: `ON${i}`,
          position: labels[i],
        }),
      );
    }
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // Buli count = 2 → below tier 1 (≥3) → 0 league pts.
    expect(r.perSlot[0]).toBe(0);
    expect(r.perSlot[1]).toBe(0);
    // Ligue 1 count = 2 → 0 too.
    expect(r.perSlot[2]).toBe(0);
    expect(r.perSlot[3]).toBe(0);
    // Sanity: total = 0 (no other links).
    expect(r.totalChem).toBe(0);
  });

  it("seasonal sponsor rebrand: Serie A TIM ≡ Serie A Enilive", () => {
    const labels = LINEUP_433;
    const cards: ChemistryCard[] = [];
    // 2 cards "Serie A TIM" + 1 card "Serie A Enilive" → effective
    // count = 3 → tier 1 (≥3 → 1 league pt). All distinct clubs/nations
    // so league is the only contributor.
    cards.push(
      mk({
        league: "Serie A TIM",
        club: "TC1",
        nation: "TN1",
        position: labels[0],
      }),
    );
    cards.push(
      mk({
        league: "Serie A TIM",
        club: "TC2",
        nation: "TN2",
        position: labels[1],
      }),
    );
    cards.push(
      mk({
        league: "Serie A Enilive",
        club: "EC1",
        nation: "EN1",
        position: labels[2],
      }),
    );
    while (cards.length < 11) {
      const i = cards.length;
      cards.push(
        mk({
          league: `Z${i}`,
          club: `ZC${i}`,
          nation: `ZN${i}`,
          position: labels[i],
        }),
      );
    }
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);
    // Family count 3 → ≥3 → 1 league pt for each Serie A* card.
    expect(r.perSlot[0]).toBe(1);
    expect(r.perSlot[1]).toBe(1);
    expect(r.perSlot[2]).toBe(1);
  });
});

// ─── slotsToSlotFills helper ──────────────────────────────────────────────

describe("slotsToSlotFills", () => {
  it("maps a slot-record into fills in 4-3-3 slot order", () => {
    const record: Record<number, ChemistryCard | null> = {};
    for (let i = 0; i < 11; i++) record[i] = null;
    record[0] = mk({ position: "GK", name: "Keeper" });
    const fills = slotsToSlotFills("433", record);
    expect(fills).toHaveLength(11);
    expect(fills[0].positionInLineup).toBe("GK");
    expect(fills[0].card?.name).toBe("Keeper");
    // Remaining slots null.
    for (let i = 1; i < 11; i++) expect(fills[i].card).toBeNull();
  });
});

// ─── deriveChemBonus pure-function unit tests ─────────────────────────────

describe("deriveChemBonus", () => {
  // ─── Icons ────────────────────────────────────────────────────────────
  it("itemType='icon' returns full icon bonus", () => {
    expect(deriveChemBonus("icon", null)).toEqual({
      clubSymbols: 0,
      leagueSymbols: 0,
      leagueSymbolsAllLeagues: true,
      nationSymbols: 2,
      fullChemInPosition: true,
    });
  });

  it("variant '12-icon' matches as icon", () => {
    expect(deriveChemBonus("normal", "12-icon")).toEqual({
      clubSymbols: 0,
      leagueSymbols: 0,
      leagueSymbolsAllLeagues: true,
      nationSymbols: 2,
      fullChemInPosition: true,
    });
  });

  it("compound icon variants all match (TOTY/Winter Wildcards/FUT Birthday/Champion/Thunderstruck)", () => {
    const expected = {
      clubSymbols: 0,
      leagueSymbols: 0,
      leagueSymbolsAllLeagues: true,
      nationSymbols: 2,
      fullChemInPosition: true,
    };
    expect(deriveChemBonus("special", "155-toty-icon")).toEqual(expected);
    expect(deriveChemBonus("special", "35-winter-wilcard-icon")).toEqual(expected);
    expect(deriveChemBonus("special", "149-fut-birthday-icon")).toEqual(expected);
    expect(deriveChemBonus("special", "161-champion-icon")).toEqual(expected);
    expect(deriveChemBonus("special", "157-thunderstruck-icon")).toEqual(expected);
  });

  // ─── Heroes ───────────────────────────────────────────────────────────
  it("itemType='hero' returns full hero bonus", () => {
    expect(deriveChemBonus("hero", null)).toEqual({
      clubSymbols: 0,
      leagueSymbols: 2,
      nationSymbols: 1,
      fullChemInPosition: true,
    });
  });

  it("variant '72-heroes' matches as hero", () => {
    expect(deriveChemBonus("normal", "72-heroes")).toEqual({
      clubSymbols: 0,
      leagueSymbols: 2,
      nationSymbols: 1,
      fullChemInPosition: true,
    });
  });

  it("compound hero variants all match (Winter Wildcards/Joga Bonito/Fantasy FC/FUT Birthday)", () => {
    const expected = {
      clubSymbols: 0,
      leagueSymbols: 2,
      nationSymbols: 1,
      fullChemInPosition: true,
    };
    expect(deriveChemBonus("special", "49-winter-wildcards-hero")).toEqual(expected);
    expect(deriveChemBonus("special", "97-joga-bonito-hero")).toEqual(expected);
    expect(deriveChemBonus("special", "135-fantasy-fc-hero")).toEqual(expected);
    expect(deriveChemBonus("special", "148-fut-birthday-hero")).toEqual(expected);
  });

  // ─── Cornerstones ─────────────────────────────────────────────────────
  it("'150-cornerstones' returns +1 club symbol bonus", () => {
    expect(deriveChemBonus("special", "150-cornerstones")).toEqual({
      clubSymbols: 2,
    });
  });

  // ─── Festival of Football Captains ────────────────────────────────────
  it("'28-festival-of-football-captains' returns +2 nation symbol bonus", () => {
    expect(deriveChemBonus("special", "28-festival-of-football-captains")).toEqual({
      nationSymbols: 3,
    });
  });

  // ─── Squad Foundations (hypothetical) ─────────────────────────────────
  it("'75-squad-foundations' returns +1 league symbol bonus", () => {
    expect(deriveChemBonus("special", "75-squad-foundations")).toEqual({
      leagueSymbols: 2,
    });
  });

  // ─── World Tour (hypothetical) ────────────────────────────────────────
  it("'99-world-tour' returns +1 nation symbol bonus", () => {
    expect(deriveChemBonus("special", "99-world-tour")).toEqual({
      nationSymbols: 2,
    });
  });

  // ─── End of an Era (hypothetical) ─────────────────────────────────────
  it("'200-end-of-an-era' returns icon-like bonus (all-leagues + 2 nation + auto-3)", () => {
    expect(deriveChemBonus("special", "200-end-of-an-era")).toEqual({
      clubSymbols: 0,
      leagueSymbols: 0,
      leagueSymbolsAllLeagues: true,
      nationSymbols: 2,
      fullChemInPosition: true,
    });
  });

  // ─── Positional Excellence Evo (hypothetical) ─────────────────────────
  it("'222-positional-excellence-evo' returns fullChemInPosition only", () => {
    expect(deriveChemBonus("special", "222-positional-excellence-evo")).toEqual({
      fullChemInPosition: true,
    });
  });

  // ─── Null cases ───────────────────────────────────────────────────────
  it("itemType='normal' + variant='3-gold' returns null (no bonus)", () => {
    expect(deriveChemBonus("normal", "3-gold")).toBeNull();
  });

  it("itemType='tots' + variant='11-team-of-the-season' returns null (TOTS Plus chem not modelled)", () => {
    expect(deriveChemBonus("tots", "11-team-of-the-season")).toBeNull();
  });

  it("null/undefined inputs return null", () => {
    expect(deriveChemBonus(null, null)).toBeNull();
    expect(deriveChemBonus(undefined, undefined)).toBeNull();
    expect(deriveChemBonus(null, undefined)).toBeNull();
    expect(deriveChemBonus(undefined, null)).toBeNull();
    expect(deriveChemBonus("", "")).toBeNull();
  });
});

// ─── Hero club fix (Heroes do NOT contribute club symbols) ────────────────

describe("computeChemistry — hero club fix", () => {
  it("hero with club='Real Madrid' does NOT push club counter to 5 (stays at 4)", () => {
    // 4 Real Madrid normal players + 1 hero whose card.club is "Real Madrid".
    // Without the fix: club counter = 4 + 1 = 5 → tier-2 → 2 club pts (wrong).
    // With the fix: club counter = 4 (hero contributes 0 club) → tier-2 (≥4
    // → 2 pts). Wait — both states give 2 pts at the boundary... let's
    // verify the boundary precisely. Tier-2 starts at ≥4. So 4 = tier-2,
    // 5 = tier-2, 7 = tier-3. To distinguish we need a count where the bug
    // changes the tier. Use 6 normal Madrid + 1 hero (would be 7 = tier-3
    // with bug, stays 6 = tier-2 without bug). But 6 + hero = 7 starters,
    // need 4 more fillers → use distinct fillers.
    const labels = LINEUP_433;
    const madrid = (i: number, label: string) =>
      mk({
        club: "Real Madrid",
        league: `MdLeague${i}`, // distinct leagues
        nation: `MdNation${i}`, // distinct nations
        position: label,
      });
    const hero = (label: string) =>
      mk({
        club: "Real Madrid", // hero claims Madrid but should NOT count
        league: "Hero League",
        nation: "Hero Nation",
        position: label,
        itemType: "hero",
        name: "ClubHeroBug",
      });
    const filler = (i: number, label: string) =>
      mk({
        club: `Filler${i}`,
        league: `FL${i}`,
        nation: `FN${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      madrid(0, labels[0]),
      madrid(1, labels[1]),
      madrid(2, labels[2]),
      madrid(3, labels[3]),
      madrid(4, labels[4]),
      madrid(5, labels[5]),
      hero(labels[6]),
      filler(7, labels[7]),
      filler(8, labels[8]),
      filler(9, labels[9]),
      filler(10, labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // With fix: Madrid count = 6 → tier-2 (≥4 but <7) → 2 club pts for
    // the 6 Madrid players. Without fix (bug): Madrid count = 7 → tier-3
    // → 3 club pts. We assert the FIXED behaviour.
    for (let i = 0; i < 6; i++) {
      expect(r.perSlot[i]).toBe(2);
    }
    // Hero in-position → flat 3.
    expect(r.perSlot[6]).toBe(3);
    // Fillers → 0.
    for (let i = 7; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
  });

  it("4 Madrid + 1 hero whose club='Real Madrid' → Madrid stays at 4 (tier-2)", () => {
    // Cleaner version: 4 Madrid normal + 1 hero with club="Real Madrid".
    // Madrid counter (with fix) = 4 → tier-2 → 2 club pts for the 4 Madrid.
    // Hero in-position = 3 (auto). 6 distinct fillers.
    const labels = LINEUP_433;
    const madrid = (i: number, label: string) =>
      mk({
        club: "Real Madrid",
        league: `MdL${i}`,
        nation: `MdN${i}`,
        position: label,
      });
    const hero = (label: string) =>
      mk({
        club: "Real Madrid",
        league: "Some Hero League",
        nation: "Some Hero Nation",
        position: label,
        itemType: "hero",
        name: "HeroNoClub",
      });
    const filler = (i: number, label: string) =>
      mk({
        club: `FillerC${i}`,
        league: `FillerL${i}`,
        nation: `FillerN${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      madrid(0, labels[0]),
      madrid(1, labels[1]),
      madrid(2, labels[2]),
      madrid(3, labels[3]),
      hero(labels[4]),
      filler(5, labels[5]),
      filler(6, labels[6]),
      filler(7, labels[7]),
      filler(8, labels[8]),
      filler(9, labels[9]),
      filler(10, labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);
    // Madrid count = 4 → tier-2 → 2 club pts each.
    for (let i = 0; i < 4; i++) {
      expect(r.perSlot[i]).toBe(2);
    }
    // Hero in-position = 3 (auto).
    expect(r.perSlot[4]).toBe(3);
    // Fillers = 0.
    for (let i = 5; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
  });
});

// ─── Icon nation symbols x2 ───────────────────────────────────────────────

describe("computeChemistry — icon nation symbols x2", () => {
  it("1 Italian Icon + 4 normal Italians → Italy counter = 6 (tier-2 → 2 nation pts)", () => {
    // Icon contributes +2 to Italy nation counter (not +1). Italy total
    // = 4 normal + 2 (icon) = 6 → tier-2 (≥5) → 2 nation pts for the 4
    // Italians. Icon itself → flat 3 (auto in-pos).
    const labels = LINEUP_433;
    const italian = (i: number, label: string) =>
      mk({
        nation: "Italy",
        league: `IL${i}`, // distinct leagues
        club: `IC${i}`, // distinct clubs
        position: label,
      });
    const icon = (label: string) =>
      mk({
        nation: "Italy",
        league: "Icon League", // icon's own league (irrelevant due to itemType)
        club: "Icons FC",
        position: label,
        itemType: "icon",
        name: "ItalianIcon",
      });
    const filler = (i: number, label: string) =>
      mk({
        nation: `Filler${i}`, // distinct nations
        league: `FL${i}`,
        club: `FC${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      italian(0, labels[0]),
      italian(1, labels[1]),
      italian(2, labels[2]),
      italian(3, labels[3]),
      icon(labels[4]),
      filler(5, labels[5]),
      filler(6, labels[6]),
      filler(7, labels[7]),
      filler(8, labels[8]),
      filler(9, labels[9]),
      filler(10, labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // Italy nation count = 4 + 2 (icon) = 6 → tier-2 (≥5) → 2 nation pts
    // for 4 Italians. They have no club/league links → slot chem = 2.
    for (let i = 0; i < 4; i++) {
      expect(r.perSlot[i]).toBe(2);
    }
    // Icon = 3 (auto).
    expect(r.perSlot[4]).toBe(3);
    // Fillers = 0.
    for (let i = 5; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
  });
});

// ─── Cornerstones bonus (+1 club symbol) ──────────────────────────────────

describe("computeChemistry — Cornerstones bonus", () => {
  it("5 Madrid normals + 1 Cornerstones Madrid → club counter = 7 (tier-3 → 3 club pts)", () => {
    // 6 Real Madrid players: 5 normal + 1 Cornerstones (variant
    // '150-cornerstones', itemType='special'). Cornerstones contributes
    // 2 club symbols → Madrid counter = 5 + 2 = 7 → tier-3 → 3 club pts.
    // All distinct leagues + nations to isolate club. Verify all 6
    // (including the Cornerstones, which is NOT auto-3 — contributes via
    // club like a normal card with bonus).
    const labels = LINEUP_433;
    const madrid = (i: number, label: string) =>
      mk({
        club: "Real Madrid",
        league: `MdL${i}`,
        nation: `MdN${i}`,
        position: label,
      });
    const cornerstones = (label: string) =>
      mk({
        club: "Real Madrid",
        league: "Cornerstones League",
        nation: "Cornerstones Nation",
        position: label,
        itemType: "special",
        variant: "150-cornerstones",
        name: "MadridCornerstones",
      });
    const filler = (i: number, label: string) =>
      mk({
        club: `FillerC${i}`,
        league: `FillerL${i}`,
        nation: `FillerN${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      madrid(0, labels[0]),
      madrid(1, labels[1]),
      madrid(2, labels[2]),
      madrid(3, labels[3]),
      madrid(4, labels[4]),
      cornerstones(labels[5]),
      filler(6, labels[6]),
      filler(7, labels[7]),
      filler(8, labels[8]),
      filler(9, labels[9]),
      filler(10, labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // Madrid club count = 5 + 2 (cornerstones) = 7 → tier-3 → 3 club pts.
    // No league/nation links → slot chem = 3 for all 6 Madrid (capped).
    for (let i = 0; i < 6; i++) {
      expect(r.perSlot[i]).toBe(3);
    }
    // Fillers = 0.
    for (let i = 6; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
  });
});

// ─── Festival of Football Captains bonus (+2 nation symbols → 3 total) ────

describe("computeChemistry — Festival Captains bonus", () => {
  it("4 normal Brazilians + 1 Festival Captains Brazilian → Brazil counter = 7 (tier-2 → 2 nation pts)", () => {
    // Captains contributes 3 nation symbols → Brazil counter = 4 + 3 = 7
    // → tier-2 (≥5 but <8) → 2 nation pts. (Tier-3 needs ≥8.)
    // Distinct clubs + leagues to isolate nation.
    const labels = LINEUP_433;
    const brazilian = (i: number, label: string) =>
      mk({
        nation: "Brazil",
        league: `BL${i}`,
        club: `BC${i}`,
        position: label,
      });
    const captains = (label: string) =>
      mk({
        nation: "Brazil",
        league: "Captains League",
        club: "Captains FC",
        position: label,
        itemType: "special",
        variant: "28-festival-of-football-captains",
        name: "BrazilCaptains",
      });
    const filler = (i: number, label: string) =>
      mk({
        nation: `FillerN${i}`,
        league: `FillerL${i}`,
        club: `FillerC${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      brazilian(0, labels[0]),
      brazilian(1, labels[1]),
      brazilian(2, labels[2]),
      brazilian(3, labels[3]),
      captains(labels[4]),
      filler(5, labels[5]),
      filler(6, labels[6]),
      filler(7, labels[7]),
      filler(8, labels[8]),
      filler(9, labels[9]),
      filler(10, labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // Brazil count = 4 + 3 (captains) = 7 → tier-2 (≥5 but <8) → 2 nation
    // pts for all 5 Brazilians. No club/league links → slot chem = 2.
    for (let i = 0; i < 5; i++) {
      expect(r.perSlot[i]).toBe(2);
    }
    // Fillers = 0.
    for (let i = 5; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
  });
});

// ─── Manager bonus ────────────────────────────────────────────────────────

describe("computeChemistry — manager bonus", () => {
  it("manager nation+league match adds +1 chem within the 3-cap (changes 2 → 3)", () => {
    // 3 Spaniards in distinct La Liga clubs + 8 distinct fillers.
    // Spain count = 3 → tier 1 (≥2 but <5) → 1 nation pt.
    // La Liga count = 3 → tier 1 (≥3 but <5) → 1 league pt.
    // Sum without manager = 2.
    // Manager 'Spain' / 'LALIGA EA SPORTS' → +1 per Spaniard (matches
    // both, but capped at +1 per card) → final = 3 each.
    const labels = LINEUP_433;
    const spaniard = (i: number, label: string) =>
      mk({
        nation: "Spain",
        league: "LALIGA EA SPORTS",
        club: `SpC${i}`, // distinct clubs (no club tier)
        position: label,
      });
    const filler = (i: number, label: string) =>
      mk({
        nation: `FN${i}`,
        league: `FL${i}`,
        club: `FC${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      spaniard(0, labels[0]),
      spaniard(1, labels[1]),
      spaniard(2, labels[2]),
      filler(3, labels[3]),
      filler(4, labels[4]),
      filler(5, labels[5]),
      filler(6, labels[6]),
      filler(7, labels[7]),
      filler(8, labels[8]),
      filler(9, labels[9]),
      filler(10, labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    // Without manager.
    const noMgr = computeChemistry(starting);
    for (let i = 0; i < 3; i++) {
      expect(noMgr.perSlot[i]).toBe(2);
    }
    // With manager.
    const mgr: ManagerLink = {
      nation: "Spain",
      league: "LALIGA EA SPORTS",
    };
    const withMgr = computeChemistry(starting, undefined, undefined, mgr);
    for (let i = 0; i < 3; i++) {
      expect(withMgr.perSlot[i]).toBe(3);
    }
    // Fillers see no manager match → 0 either way.
    for (let i = 3; i < 11; i++) {
      expect(noMgr.perSlot[i]).toBe(0);
      expect(withMgr.perSlot[i]).toBe(0);
    }
  });

  it("manager league match alone (nation null) → +1 to that league's cards", () => {
    // 3 La Liga players (distinct nations + clubs) + 8 fillers.
    // Manager: { nation: null, league: 'LALIGA EA SPORTS' }.
    // La Liga count = 3 → tier 1 (1 league pt). No club/nation links.
    // Without manager: 1 each. With manager: 2 each.
    const labels = LINEUP_433;
    const liga = (i: number, label: string) =>
      mk({
        league: "LALIGA EA SPORTS",
        nation: `LN${i}`,
        club: `LC${i}`,
        position: label,
      });
    const filler = (i: number, label: string) =>
      mk({
        nation: `FN${i}`,
        league: `FL${i}`,
        club: `FC${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      liga(0, labels[0]),
      liga(1, labels[1]),
      liga(2, labels[2]),
      filler(3, labels[3]),
      filler(4, labels[4]),
      filler(5, labels[5]),
      filler(6, labels[6]),
      filler(7, labels[7]),
      filler(8, labels[8]),
      filler(9, labels[9]),
      filler(10, labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));

    const mgr: ManagerLink = { nation: null, league: "LALIGA EA SPORTS" };
    const r = computeChemistry(starting, undefined, undefined, mgr);
    for (let i = 0; i < 3; i++) {
      expect(r.perSlot[i]).toBe(2); // 1 league + 1 manager
    }
    // Fillers don't share manager's league → 0.
    for (let i = 3; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
  });

  it("manager nation match alone (league null) → +1 to that nation's cards", () => {
    // Manager 'France' / null. A French player in La Liga gets +1 from
    // manager nation match even though league differs.
    const labels = LINEUP_433;
    const frenchInLaliga = (label: string) =>
      mk({
        nation: "France",
        league: "LALIGA EA SPORTS",
        club: "Frenchy FC",
        position: label,
      });
    const filler = (i: number, label: string) =>
      mk({
        nation: `FN${i}`,
        league: `FL${i}`,
        club: `FC${i}`,
        position: label,
      });
    const cards: ChemistryCard[] = [
      frenchInLaliga(labels[0]),
      ...Array.from({ length: 10 }, (_, i) => filler(i + 1, labels[i + 1])),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const mgr: ManagerLink = { nation: "France", league: null };
    const r = computeChemistry(starting, undefined, undefined, mgr);
    // French card alone → no club/league/nation tier (alone), but +1 from
    // manager nation match → slot chem = 1.
    expect(r.perSlot[0]).toBe(1);
    for (let i = 1; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
  });

  it("manager passed but null nation+league → no bonus to anyone", () => {
    const labels = LINEUP_433;
    const spanish = (i: number, label: string) =>
      mk({
        nation: "Spain",
        league: "LALIGA EA SPORTS",
        club: `SC${i}`,
        position: label,
      });
    const filler = (i: number, label: string) =>
      mk({
        nation: `FN${i}`,
        league: `FL${i}`,
        club: `FC${i}`,
        position: label,
      });
    const cards: ChemistryCard[] = [
      spanish(0, labels[0]),
      spanish(1, labels[1]),
      spanish(2, labels[2]),
      ...Array.from({ length: 8 }, (_, i) => filler(i + 3, labels[i + 3])),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const mgr: ManagerLink = { nation: null, league: null };
    const r = computeChemistry(starting, undefined, undefined, mgr);
    // Spaniards get 1 nation pt + 1 league pt = 2 (no manager bonus).
    for (let i = 0; i < 3; i++) {
      expect(r.perSlot[i]).toBe(2);
    }
  });

  it("manager bonus respects 3-per-slot cap (already at 3 → no over-cap)", () => {
    // 11 Real Madrid / La Liga / Spain — every slot already at cap 3.
    // Manager 'Spain' / 'LALIGA EA SPORTS' shouldn't push above cap.
    const labels = LINEUP_433;
    const starting: SlotFill[] = labels.map((label) => ({
      card: mk({
        club: "Real Madrid",
        league: "LALIGA EA SPORTS",
        nation: "Spain",
        position: label,
      }),
      positionInLineup: label,
    }));
    const mgr: ManagerLink = { nation: "Spain", league: "LALIGA EA SPORTS" };
    const r = computeChemistry(starting, undefined, undefined, mgr);
    // Every slot already 3 → manager can't push above cap.
    expect(r.perSlot.every((p) => p === 3)).toBe(true);
    expect(r.totalChem).toBe(33);
  });

  it("manager bonus also applies to subs", () => {
    const labels = LINEUP_433;
    const starting: SlotFill[] = labels.map((label) => ({
      card: mk({
        club: "Real Madrid",
        league: "LALIGA EA SPORTS",
        nation: "Spain",
        position: label,
      }),
      positionInLineup: label,
    }));
    // Sub: French in PSG/Ligue 1. No tier links to starting pool.
    const subs: SlotFill[] = [
      {
        card: mk({
          club: "PSG",
          league: "Ligue 1 McDonald's",
          nation: "France",
          position: "ST",
          name: "FrenchSub",
        }),
        positionInLineup: "ST",
      },
    ];
    const mgrFrance: ManagerLink = { nation: "France", league: null };
    const r = computeChemistry(starting, undefined, subs, mgrFrance);
    // Sub gets +1 from manager nation match. No tier match → 1 chem.
    expect(r.subsTotalChem).toBe(1);
  });
});

// ─── End of an Era bonus (icon-like — +1 to every league counter) ─────────

describe("computeChemistry — End of an Era bonus", () => {
  it("EoE adds +1 to every league counter (lifts a 2-card league to tier 1)", () => {
    // 1 EoE card + 5 distinct fillers + 2 Eredivisie players + 3 more
    // distinct fillers (total 11).
    // EoE in-pos = auto 3.
    // Eredivisie count = 2 + 1 (EoE iconCount) = 3 → tier 1 (≥3) → 1 league pt.
    // Distinct fillers (no shared league with anyone) get 0 + 1 (EoE icon)
    // = 1 league count → still below tier 1 (need ≥3) → 0 pts.
    const labels = LINEUP_433;
    const eoe = (label: string) =>
      mk({
        club: "EoE Club",
        league: "Some EoE League",
        nation: "Brazil",
        position: label,
        itemType: "special",
        variant: "200-end-of-an-era",
        name: "EoEPele",
      });
    const eredivisie = (i: number, label: string) =>
      mk({
        league: "Eredivisie",
        club: `ErC${i}`, // distinct clubs
        nation: `ErN${i}`, // distinct nations
        position: label,
      });
    const filler = (i: number, label: string) =>
      mk({
        league: `Fl${i}`,
        club: `Fc${i}`,
        nation: `Fn${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      eoe(labels[0]),
      eredivisie(1, labels[1]),
      eredivisie(2, labels[2]),
      filler(3, labels[3]),
      filler(4, labels[4]),
      filler(5, labels[5]),
      filler(6, labels[6]),
      filler(7, labels[7]),
      filler(8, labels[8]),
      filler(9, labels[9]),
      filler(10, labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);

    // EoE in-pos → flat 3.
    expect(r.perSlot[0]).toBe(3);
    // Eredivisie players: league count = 2 + 1 (EoE) = 3 → tier 1 → 1 pt.
    // No other links → slot chem = 1.
    expect(r.perSlot[1]).toBe(1);
    expect(r.perSlot[2]).toBe(1);
    // Fillers: their own unique league → 1 + 1 (EoE) = 2 → still <3 → 0 pts.
    for (let i = 3; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
  });
});

// ─── chemBonus override wins over derive ──────────────────────────────────

describe("computeChemistry — chemBonus override wins", () => {
  it("explicit chemBonus on a normal card beats deriveChemBonus (which returns null)", () => {
    // Normal card with explicit chemBonus { clubSymbols: 5 }. The override
    // pushes the club counter up beyond what 'normal' would yield.
    // Setup: 2 normal Madrid + 1 Madrid card with chemBonus{clubSymbols:5}.
    // Madrid counter = 2 (normals) + 5 (override) = 7 → tier-3 → 3 club pts.
    // Without override (or with deriveChemBonus only): counter = 3 → tier 1
    // (≥2 but <4) → 1 club pt. Override clearly wins.
    const labels = LINEUP_433;
    const madrid = (i: number, label: string) =>
      mk({
        club: "Real Madrid",
        league: `MdL${i}`,
        nation: `MdN${i}`,
        position: label,
      });
    const overrideCard: ChemistryCard = {
      club: "Real Madrid",
      league: "OvLeague",
      nation: "OvNation",
      position: labels[2],
      positionsAlt: [],
      itemType: "normal", // deriveChemBonus would return null
      chemBonus: { clubSymbols: 5 },
      name: "OverrideMadrid",
    };
    const filler = (i: number, label: string) =>
      mk({
        club: `Fc${i}`,
        league: `Fl${i}`,
        nation: `Fn${i}`,
        position: label,
      });

    const cards: ChemistryCard[] = [
      madrid(0, labels[0]),
      madrid(1, labels[1]),
      overrideCard,
      filler(3, labels[3]),
      filler(4, labels[4]),
      filler(5, labels[5]),
      filler(6, labels[6]),
      filler(7, labels[7]),
      filler(8, labels[8]),
      filler(9, labels[9]),
      filler(10, labels[10]),
    ];
    const starting: SlotFill[] = labels.map((label, i) => ({
      card: cards[i],
      positionInLineup: label,
    }));
    const r = computeChemistry(starting);
    // Madrid counter = 2 + 5 (override) = 7 → tier-3 → 3 club pts.
    for (let i = 0; i < 3; i++) {
      expect(r.perSlot[i]).toBe(3);
    }
    // Fillers = 0.
    for (let i = 3; i < 11; i++) {
      expect(r.perSlot[i]).toBe(0);
    }
  });
});
