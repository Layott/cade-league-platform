import { describe, it, expect } from "vitest";
import {
  applyTiebreakers,
  DEFAULT_TIEBREAKER_ORDER,
  type StandingsRow,
} from "./tiebreakers";

function mk(overrides: Partial<StandingsRow>): StandingsRow {
  return {
    playerId: overrides.playerId ?? "p?",
    pts: overrides.pts ?? 0,
    gd: overrides.gd ?? 0,
    gf: overrides.gf ?? 0,
    ga: overrides.ga ?? 0,
    played: overrides.played ?? 0,
    wins: overrides.wins ?? 0,
    draws: overrides.draws ?? 0,
    losses: overrides.losses ?? 0,
    name: overrides.name ?? "?",
  };
}

describe("applyTiebreakers()", () => {
  it("returns [] for empty input", () => {
    expect(applyTiebreakers([], DEFAULT_TIEBREAKER_ORDER as unknown as string[])).toEqual([]);
  });

  it("does NOT mutate input array", () => {
    const rows = [mk({ name: "B", pts: 1 }), mk({ name: "A", pts: 1 })];
    const before = [...rows];
    applyTiebreakers(rows, DEFAULT_TIEBREAKER_ORDER as unknown as string[]);
    expect(rows).toEqual(before);
  });

  it("sorts by default ladder: totalPts DESC, gd DESC, gf DESC, name ASC", () => {
    const rows = [
      mk({ playerId: "p1", name: "Charlie", pts: 5, gd: 1, gf: 5 }),
      mk({ playerId: "p2", name: "Alpha", pts: 9, gd: 1, gf: 5 }),
      mk({ playerId: "p3", name: "Bravo", pts: 9, gd: 3, gf: 5 }),
      mk({ playerId: "p4", name: "Delta", pts: 9, gd: 1, gf: 9 }),
    ];
    const out = applyTiebreakers(rows, DEFAULT_TIEBREAKER_ORDER as unknown as string[]);
    expect(out.map((r) => r.playerId)).toEqual(["p3", "p4", "p2", "p1"]);
  });

  it("default ladder breaks ties with name ASC", () => {
    const rows = [
      mk({ playerId: "z", name: "Zulu", pts: 6, gd: 0, gf: 4 }),
      mk({ playerId: "a", name: "Alpha", pts: 6, gd: 0, gf: 4 }),
    ];
    const out = applyTiebreakers(rows, undefined);
    expect(out[0].name).toBe("Alpha");
  });

  it("accepts null/undefined ladder and falls back to default", () => {
    const rows = [
      mk({ playerId: "x", name: "X", pts: 3 }),
      mk({ playerId: "y", name: "Y", pts: 6 }),
    ];
    expect(applyTiebreakers(rows, null)?.[0].name).toBe("Y");
    expect(applyTiebreakers(rows, undefined)?.[0].name).toBe("Y");
    expect(applyTiebreakers(rows, [])?.[0].name).toBe("Y");
  });

  it("custom order ['wins','gd','name'] overrides default", () => {
    const rows = [
      mk({ playerId: "p1", name: "Alpha", wins: 2, gd: 5, pts: 99 }),
      mk({ playerId: "p2", name: "Bravo", wins: 4, gd: 1, pts: 5 }),
      mk({ playerId: "p3", name: "Charlie", wins: 4, gd: 5, pts: 1 }),
    ];
    const out = applyTiebreakers(rows, ["wins", "gd", "name"]);
    // wins desc -> p3 / p2 first; tiebreak on gd desc -> p3 then p2; p1 last
    expect(out.map((r) => r.playerId)).toEqual(["p3", "p2", "p1"]);
  });

  it("losses is lower-better when in the ladder", () => {
    const rows = [
      mk({ playerId: "p1", name: "Alpha", pts: 5, losses: 4 }),
      mk({ playerId: "p2", name: "Bravo", pts: 5, losses: 2 }),
      mk({ playerId: "p3", name: "Charlie", pts: 5, losses: 1 }),
    ];
    const out = applyTiebreakers(rows, ["totalPts", "losses", "name"]);
    // points equal -> losses ascending -> p3, p2, p1
    expect(out.map((r) => r.playerId)).toEqual(["p3", "p2", "p1"]);
  });

  it("single-tier all-same -> falls back to name", () => {
    const rows = [
      mk({ playerId: "z", name: "Zach", pts: 5, gd: 0, gf: 5 }),
      mk({ playerId: "a", name: "Alice", pts: 5, gd: 0, gf: 5 }),
      mk({ playerId: "m", name: "Mike", pts: 5, gd: 0, gf: 5 }),
    ];
    const out = applyTiebreakers(rows, DEFAULT_TIEBREAKER_ORDER as unknown as string[]);
    expect(out.map((r) => r.name)).toEqual(["Alice", "Mike", "Zach"]);
  });

  it("missing/unknown key throws a descriptive error", () => {
    const rows = [mk({ name: "x" })];
    expect(() => applyTiebreakers(rows, ["totalPts", "ohNo"])).toThrow(
      /unsupported tiebreaker key "ohNo"/,
    );
  });

  it("name comparison is case-insensitive", () => {
    const rows = [
      mk({ playerId: "p1", name: "alpha", pts: 5 }),
      mk({ playerId: "p2", name: "Bravo", pts: 5 }),
    ];
    const out = applyTiebreakers(rows, DEFAULT_TIEBREAKER_ORDER as unknown as string[]);
    expect(out[0].playerId).toBe("p1"); // alpha < Bravo lower-cased
  });

  it("appends `name` as final fallback when ladder ends elsewhere", () => {
    const rows = [
      mk({ playerId: "p1", name: "Zach", pts: 5, gd: 0 }),
      mk({ playerId: "p2", name: "Alice", pts: 5, gd: 0 }),
    ];
    const out = applyTiebreakers(rows, ["totalPts", "gd"]);
    expect(out[0].name).toBe("Alice");
  });

  it("supports `played` higher-better key", () => {
    const rows = [
      mk({ playerId: "p1", name: "Alpha", pts: 0, played: 1 }),
      mk({ playerId: "p2", name: "Bravo", pts: 0, played: 5 }),
    ];
    const out = applyTiebreakers(rows, ["totalPts", "played", "name"]);
    expect(out[0].playerId).toBe("p2");
  });

  it("returns NEW array (referential inequality)", () => {
    const rows = [mk({ name: "A" })];
    const out = applyTiebreakers(rows, undefined);
    expect(out).not.toBe(rows);
  });
});
