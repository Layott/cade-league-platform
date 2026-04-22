import { describe, it, expect } from "vitest";
import { PLAN26_SCHEDULE } from "./plan26-schedule";
import { summarizeRoundRobin, type FixturePair } from "./search";

const ROSTER = [
  "ADEFOLA",
  "ANIFE",
  "BAJI_JNR",
  "DADABOI",
  "FARUK",
  "GURU",
  "KAYKAY",
  "KILLER_FREAK",
  "KINGNONEX",
  "MITCH",
  "MR_OGA",
  "TACTICAL",
  "WOLEVATION",
] as const;

const allPairs: FixturePair[] = PLAN26_SCHEDULE.flatMap((d) =>
  d.pairs.map((p) => [p[0], p[1]] as const),
);

describe("PLAN26_SCHEDULE LOC fixture invariants", () => {
  it("has 8 match days with the LOC-supplied dates", () => {
    expect(PLAN26_SCHEDULE.map((d) => d.date)).toEqual([
      "2026-04-26",
      "2026-05-02",
      "2026-05-04",
      "2026-05-10",
      "2026-05-11",
      "2026-05-17",
      "2026-05-18",
      "2026-05-25",
    ]);
  });

  it("has 78 fixtures total split 10/11/9/11/10/10/9/8", () => {
    expect(PLAN26_SCHEDULE.map((d) => d.pairs.length)).toEqual([
      10, 11, 9, 11, 10, 10, 9, 8,
    ]);
    expect(allPairs.length).toBe(78);
  });

  it("uses only the 13 known gamer_tags and references each", () => {
    const seen = new Set<string>();
    for (const [a, b] of allPairs) {
      seen.add(a);
      seen.add(b);
    }
    expect([...seen].sort()).toEqual([...ROSTER].sort());
  });

  it("gives every player exactly 12 matches and contains zero duplicate pairs", () => {
    const summary = summarizeRoundRobin(allPairs);
    expect(summary.total).toBe(78);
    expect(summary.duplicates).toEqual([]);
    for (const tag of ROSTER) {
      expect(summary.perPlayer[tag]).toBe(12);
    }
  });

  it("never pits a player against themselves", () => {
    for (const [a, b] of allPairs) {
      expect(a).not.toBe(b);
    }
  });
});
