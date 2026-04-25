import { describe, it, expect } from "vitest";
import {
  computeWinProbability,
  seasonStrength,
  formStrength,
  h2hStrength,
  type PlayerSeasonStats,
  type H2HRecord,
} from "./win_probability";

const empty: PlayerSeasonStats = {
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  gf: 0,
  ga: 0,
  gd: 0,
  points: 0,
  last5Form: [],
};

function mkStats(overrides: Partial<PlayerSeasonStats> = {}): PlayerSeasonStats {
  return { ...empty, ...overrides };
}

describe("seasonStrength()", () => {
  it("returns 0.5 (neutral) for unplayed seasons", () => {
    expect(seasonStrength(empty)).toBe(0.5);
  });

  it("rises with PPG", () => {
    const weak = mkStats({ played: 5, points: 0, gf: 0 });
    const strong = mkStats({ played: 5, points: 15, gf: 10 });
    expect(seasonStrength(strong)).toBeGreaterThan(seasonStrength(weak));
  });
});

describe("formStrength()", () => {
  it("returns 0.5 (neutral) for empty form arrays", () => {
    expect(formStrength(empty)).toBe(0.5);
  });

  it("returns 1.0 for five wins", () => {
    expect(formStrength(mkStats({ last5Form: [3, 3, 3, 3, 3] }))).toBe(1);
  });

  it("returns 0 for five losses", () => {
    expect(formStrength(mkStats({ last5Form: [0, 0, 0, 0, 0] }))).toBe(0);
  });

  it("clamps unknown form values into 0/1/3 buckets", () => {
    // 99 -> 3, 0.5 -> 0
    const out = formStrength(mkStats({ last5Form: [99, 0.5, 0.5, 0.5, 0.5] }));
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(0.25);
  });
});

describe("h2hStrength()", () => {
  it("returns 0.5 when no matches played", () => {
    expect(h2hStrength({ totalMatches: 0, aWins: 0, bWins: 0, draws: 0 })).toBe(
      0.5,
    );
  });

  it("returns 1.0 when A has won all", () => {
    expect(h2hStrength({ totalMatches: 3, aWins: 3, bWins: 0, draws: 0 })).toBe(
      1,
    );
  });

  it("returns 0.0 when B has won all", () => {
    expect(h2hStrength({ totalMatches: 3, aWins: 0, bWins: 3, draws: 0 })).toBe(
      0,
    );
  });
});

describe("computeWinProbability()", () => {
  it("empty stats both players -> ~50/50 with draw baseline", () => {
    const r = computeWinProbability(empty, empty);
    // Symmetric within float epsilon
    expect(Math.abs(r.pA - r.pB)).toBeLessThan(1e-6);
    // Draw within baseline range
    expect(r.pDraw).toBeGreaterThanOrEqual(0.15);
    expect(r.pDraw).toBeLessThanOrEqual(0.4);
    // Sum to 1
    expect(r.pA + r.pB + r.pDraw).toBeCloseTo(1, 6);
  });

  it("player A dominant (high GF, high PPG) -> pA > pB", () => {
    const a = mkStats({
      played: 10,
      wins: 9,
      draws: 1,
      losses: 0,
      points: 28,
      gf: 35,
      ga: 8,
      last5Form: [3, 3, 3, 3, 3],
    });
    const b = mkStats({
      played: 10,
      wins: 1,
      draws: 1,
      losses: 8,
      points: 4,
      gf: 6,
      ga: 28,
      last5Form: [0, 0, 0, 0, 0],
    });
    const r = computeWinProbability(a, b);
    expect(r.pA).toBeGreaterThan(r.pB);
    expect(r.pA).toBeGreaterThan(0.5);
  });

  it("player B dominant inversely -> pB > pA", () => {
    const a = mkStats({
      played: 10,
      wins: 1,
      draws: 1,
      losses: 8,
      points: 4,
      gf: 6,
      ga: 28,
      last5Form: [0, 0, 0, 0, 0],
    });
    const b = mkStats({
      played: 10,
      wins: 9,
      draws: 1,
      losses: 0,
      points: 28,
      gf: 35,
      ga: 8,
      last5Form: [3, 3, 3, 3, 3],
    });
    const r = computeWinProbability(a, b);
    expect(r.pB).toBeGreaterThan(r.pA);
  });

  it("balanced stats but A has 5/5 form vs B 0/5 form -> pA biased", () => {
    const a = mkStats({
      played: 5,
      points: 7,
      gf: 8,
      ga: 7,
      last5Form: [3, 3, 3, 3, 3],
    });
    const b = mkStats({
      played: 5,
      points: 7,
      gf: 8,
      ga: 7,
      last5Form: [0, 0, 0, 0, 0],
    });
    const r = computeWinProbability(a, b);
    expect(r.pA).toBeGreaterThan(r.pB);
  });

  it("with H2H 3-0 in favour of A -> pA boosted", () => {
    const a = mkStats({ played: 5, points: 7, gf: 8, ga: 7, last5Form: [3, 1, 0, 3, 1] });
    const b = mkStats({ played: 5, points: 7, gf: 8, ga: 7, last5Form: [3, 1, 0, 3, 1] });
    const noH2h = computeWinProbability(a, b);
    const withH2h = computeWinProbability(a, b, {
      totalMatches: 3,
      aWins: 3,
      bWins: 0,
      draws: 0,
    });
    expect(withH2h.pA).toBeGreaterThan(noH2h.pA);
  });

  it("with H2H 0-3 in favour of B -> pB boosted", () => {
    const a = mkStats({ played: 5, points: 7, gf: 8, ga: 7, last5Form: [3, 1, 0, 3, 1] });
    const b = mkStats({ played: 5, points: 7, gf: 8, ga: 7, last5Form: [3, 1, 0, 3, 1] });
    const withH2h = computeWinProbability(a, b, {
      totalMatches: 3,
      aWins: 0,
      bWins: 3,
      draws: 0,
    });
    expect(withH2h.pB).toBeGreaterThan(withH2h.pA);
  });

  it("without H2H provided -> falls back to season+form only (deterministic on identical inputs)", () => {
    const a = mkStats({ played: 5, points: 9, gf: 12, ga: 6, last5Form: [3, 3, 1, 3, 0] });
    const b = mkStats({ played: 5, points: 6, gf: 8, ga: 8, last5Form: [3, 0, 1, 3, 1] });
    const r1 = computeWinProbability(a, b);
    const r2 = computeWinProbability(a, b);
    expect(r1).toEqual(r2);
  });

  it("pA + pB + pDraw === 1 (within rounding) for varied inputs", () => {
    const cases: Array<[PlayerSeasonStats, PlayerSeasonStats, H2HRecord?]> = [
      [empty, empty, undefined],
      [mkStats({ played: 1, points: 3, last5Form: [3] }), empty, undefined],
      [
        mkStats({ played: 8, points: 16, gf: 14, ga: 9, last5Form: [3, 3, 0, 1, 3] }),
        mkStats({ played: 8, points: 12, gf: 11, ga: 10, last5Form: [1, 1, 3, 0, 3] }),
        { totalMatches: 4, aWins: 2, bWins: 1, draws: 1 },
      ],
    ];
    for (const [a, b, h2h] of cases) {
      const r = computeWinProbability(a, b, h2h);
      expect(r.pA + r.pB + r.pDraw).toBeCloseTo(1, 6);
    }
  });

  it("pDraw stays in 0.15-0.40 range across edge cases", () => {
    const a1 = mkStats({ played: 1, points: 3, gf: 5, ga: 0, last5Form: [3] });
    const b1 = mkStats({ played: 1, points: 0, gf: 0, ga: 5, last5Form: [0] });
    const r1 = computeWinProbability(a1, b1);
    expect(r1.pDraw).toBeGreaterThanOrEqual(0.15);
    expect(r1.pDraw).toBeLessThanOrEqual(0.4);

    const r2 = computeWinProbability(empty, empty);
    expect(r2.pDraw).toBeGreaterThanOrEqual(0.15);
    expect(r2.pDraw).toBeLessThanOrEqual(0.4);
  });

  it("snapshot test on canonical fixture (faruk vs anife realistic numbers)", () => {
    const faruk = mkStats({
      played: 8,
      wins: 5,
      draws: 2,
      losses: 1,
      points: 17,
      gf: 18,
      ga: 9,
      gd: 9,
      last5Form: [3, 3, 1, 3, 0],
    });
    const anife = mkStats({
      played: 8,
      wins: 3,
      draws: 3,
      losses: 2,
      points: 12,
      gf: 13,
      ga: 11,
      gd: 2,
      last5Form: [1, 3, 1, 0, 3],
    });
    const r = computeWinProbability(faruk, anife, {
      totalMatches: 2,
      aWins: 1,
      bWins: 1,
      draws: 0,
    });
    // Sum to one + faruk slightly favoured but not dominant.
    expect(r.pA + r.pB + r.pDraw).toBeCloseTo(1, 6);
    expect(r.pA).toBeGreaterThan(r.pB);
    expect(r.pA - r.pB).toBeLessThan(0.5);
  });

  it("result stable under symmetric swap when no H2H -> swapping inputs swaps outputs", () => {
    const a = mkStats({ played: 5, points: 12, gf: 11, ga: 7, last5Form: [3, 3, 1, 1, 3] });
    const b = mkStats({ played: 5, points: 4, gf: 5, ga: 9, last5Form: [0, 1, 0, 0, 1] });
    const r1 = computeWinProbability(a, b);
    const r2 = computeWinProbability(b, a);
    expect(r1.pA).toBeCloseTo(r2.pB, 6);
    expect(r1.pB).toBeCloseTo(r2.pA, 6);
    expect(r1.pDraw).toBeCloseTo(r2.pDraw, 6);
  });
});
