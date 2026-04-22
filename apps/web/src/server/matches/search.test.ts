import { describe, it, expect } from "vitest";
import {
  filterFixtures,
  matchesQuery,
  summarizeRoundRobin,
  type FixturePair,
} from "./search";

const sampleGroup = (id: string, fixtures: ReturnType<typeof mkFix>[]) => ({
  id,
  fixtures,
});

function mkFix(home_tag: string, away_tag: string, home_name = home_tag, away_name = away_tag) {
  return { home_tag, away_tag, home_name, away_name };
}

describe("matchesQuery", () => {
  it("returns true on empty query", () => {
    expect(matchesQuery(mkFix("ADEFOLA", "GURU"), "")).toBe(true);
    expect(matchesQuery(mkFix("ADEFOLA", "GURU"), "   ")).toBe(true);
  });

  it("matches case-insensitively against either tag", () => {
    const f = mkFix("ADEFOLA", "GURU");
    expect(matchesQuery(f, "ade")).toBe(true);
    expect(matchesQuery(f, "GURU")).toBe(true);
    expect(matchesQuery(f, "guru")).toBe(true);
    expect(matchesQuery(f, "mitch")).toBe(false);
  });

  it("matches against display_name as well as gamer_tag", () => {
    const f = mkFix("BAJI_JNR", "MR_OGA", "Baji Jnr", "Mr Oga");
    expect(matchesQuery(f, "baji")).toBe(true);
    expect(matchesQuery(f, "mr oga")).toBe(true);
  });
});

describe("filterFixtures", () => {
  const groups = [
    sampleGroup("d1", [mkFix("ADEFOLA", "GURU"), mkFix("MITCH", "WOLEVATION")]),
    sampleGroup("d2", [mkFix("BAJI_JNR", "MITCH")]),
    sampleGroup("d3", [mkFix("KAYKAY", "TACTICAL")]),
  ];

  it("returns all groups untouched on empty query", () => {
    expect(filterFixtures(groups, "")).toHaveLength(3);
  });

  it("filters fixtures within each group and drops empty groups", () => {
    const out = filterFixtures(groups, "mitch");
    expect(out).toHaveLength(2); // d1 and d2 each have one mitch fixture
    expect(out[0].fixtures).toHaveLength(1);
    expect(out[1].fixtures).toHaveLength(1);
  });

  it("returns empty when no fixture matches", () => {
    const out = filterFixtures(groups, "nobody");
    expect(out).toHaveLength(0);
  });
});

describe("summarizeRoundRobin", () => {
  it("counts each player and detects duplicates", () => {
    const pairs: FixturePair[] = [
      ["A", "B"],
      ["A", "C"],
      ["B", "C"],
      ["A", "B"], // dup
    ];
    const s = summarizeRoundRobin(pairs);
    expect(s.total).toBe(4);
    expect(s.perPlayer).toEqual({ A: 3, B: 3, C: 2 });
    expect(s.duplicates).toEqual(["A|B"]);
  });

  it("treats reversed pairs as duplicates", () => {
    const pairs: FixturePair[] = [
      ["A", "B"],
      ["B", "A"],
    ];
    expect(summarizeRoundRobin(pairs).duplicates).toEqual(["A|B"]);
  });
});
