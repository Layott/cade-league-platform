import { describe, it, expect } from "vitest";
import { calculateChemistry, type ChemistryCard } from "./chemistry";

function mk(
  over: Partial<ChemistryCard> & { club?: string; league?: string; nation?: string },
): ChemistryCard {
  return {
    club: over.club ?? null,
    league: over.league ?? null,
    nation: over.nation ?? null,
  };
}

describe("calculateChemistry", () => {
  it("returns 0 for a single card (no link possible)", () => {
    expect(calculateChemistry([mk({ club: "Real Madrid" })])).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(calculateChemistry([])).toBe(0);
  });

  it("returns 100 when all 11 cards share club + league + nation", () => {
    const eleven = Array.from({ length: 11 }, () =>
      mk({ club: "Real Madrid", league: "La Liga", nation: "Spain" }),
    );
    expect(calculateChemistry(eleven)).toBe(100);
  });

  it("returns a partial score for a mixed squad", () => {
    // 5 Madrid/La Liga/Spain + 5 Barca/La Liga/Spain + 1 PSG/Ligue 1/France
    // Everyone's league + nation matches ≥2 others (except the PSG odd-one
    // whose league/nation are unique); clubs split 5/5/1.
    const cards: ChemistryCard[] = [
      ...Array.from({ length: 5 }, () =>
        mk({ club: "Real Madrid", league: "La Liga", nation: "Spain" }),
      ),
      ...Array.from({ length: 5 }, () =>
        mk({ club: "FC Barcelona", league: "La Liga", nation: "Spain" }),
      ),
      mk({ club: "PSG", league: "Ligue 1", nation: "France" }),
    ];
    const chem = calculateChemistry(cards);
    expect(chem).toBeGreaterThan(0);
    expect(chem).toBeLessThan(100);
  });

  it("is case-insensitive and trims whitespace", () => {
    const cards = Array.from({ length: 3 }, (_, i) => {
      if (i === 0) return mk({ club: "real madrid" });
      if (i === 1) return mk({ club: "REAL MADRID" });
      return mk({ club: " Real Madrid " });
    });
    expect(calculateChemistry(cards)).toBeGreaterThan(0);
  });

  it("handles nulls gracefully (missing club/league/nation)", () => {
    const cards: ChemistryCard[] = [
      mk({ nation: "Spain" }),
      mk({ nation: "Spain" }),
      mk({ nation: "Spain" }),
    ];
    const chem = calculateChemistry(cards);
    expect(chem).toBeGreaterThan(0);
  });

  it("returns 0 when no three-way axis match exists", () => {
    const cards: ChemistryCard[] = [
      mk({ club: "A", league: "X", nation: "N1" }),
      mk({ club: "B", league: "Y", nation: "N2" }),
      mk({ club: "C", league: "Z", nation: "N3" }),
    ];
    expect(calculateChemistry(cards)).toBe(0);
  });

  it("caps at 100", () => {
    const many = Array.from({ length: 23 }, () =>
      mk({ club: "A", league: "A", nation: "A" }),
    );
    expect(calculateChemistry(many)).toBeLessThanOrEqual(100);
  });
});
