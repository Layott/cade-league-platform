import { describe, it, expect, vi } from "vitest";
import { getH2HGrid } from "./h2h";

const P = "pppppppp-pppp-4ppp-8ppp-pppppppppppp";
const O1 = "11111111-1111-4111-8111-111111111111";
const O2 = "22222222-2222-4222-8222-222222222222";
const SEASON = "ssssssss-ssss-4sss-8sss-ssssssssssss";

type FakeMatch = {
  id: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  resultType?: "normal" | "forfeit" | "void";
  confirmed?: boolean;
  homeName?: string;
  awayName?: string;
};

function toRaw(m: FakeMatch) {
  return {
    id: m.id,
    home_player_id: m.homeId,
    away_player_id: m.awayId,
    match_results: {
      home_score: m.homeScore,
      away_score: m.awayScore,
      result_type: m.resultType ?? "normal",
      confirmed_at: m.confirmed === false ? null : "2026-04-22T10:00:00Z",
    },
    home: {
      id: m.homeId,
      gamer_tag: `tag-${m.homeId.slice(0, 3)}`,
      users: { display_name: m.homeName ?? `P-${m.homeId.slice(0, 3)}` },
    },
    away: {
      id: m.awayId,
      gamer_tag: `tag-${m.awayId.slice(0, 3)}`,
      users: { display_name: m.awayName ?? `P-${m.awayId.slice(0, 3)}` },
    },
  };
}

function mkSb(matches: FakeMatch[]) {
  const rows = matches.map(toRaw);
  return {
    from: vi.fn((table: string) => {
      if (table !== "matches") throw new Error(`unexpected table ${table}`);
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        is: vi.fn(() => chain),
        or: vi.fn(() => Promise.resolve({ data: rows, error: null })),
      };
      return chain;
    }),
  } as never;
}

describe("getH2HGrid", () => {
  it("returns empty array when no matches vs any opponent", async () => {
    const sb = mkSb([]);
    const out = await getH2HGrid(sb, P, SEASON);
    expect(out).toEqual([]);
  });

  it("aggregates home + away matches against same opponent onto one row", async () => {
    const sb = mkSb([
      // Player HOME: 3-1 W. gf=3 ga=1.
      { id: "m1", homeId: P, awayId: O1, homeScore: 3, awayScore: 1 },
      // Player AWAY: 2-2 D. gf=2 ga=2.
      { id: "m2", homeId: O1, awayId: P, homeScore: 2, awayScore: 2 },
      // Player AWAY: 0-1 L. gf=1 ga=0. (player scored 1, conceded 0? no —
      // player is AWAY so gf = away_score = 1, ga = home_score = 0. player wins.)
      // Adjust: make a real away loss: home 2, away 0 → player gf=0 ga=2 → L.
      { id: "m3", homeId: O1, awayId: P, homeScore: 2, awayScore: 0 },
    ]);
    const out = await getH2HGrid(sb, P, SEASON);
    expect(out).toHaveLength(1);
    const row = out[0];
    expect(row.opponentId).toBe(O1);
    expect(row.mp).toBe(3);
    expect(row.w).toBe(1);
    expect(row.d).toBe(1);
    expect(row.l).toBe(1);
    expect(row.gf).toBe(3 + 2 + 0);
    expect(row.ga).toBe(1 + 2 + 2);
  });

  it("excludes void matches", async () => {
    const sb = mkSb([
      { id: "m1", homeId: P, awayId: O1, homeScore: 5, awayScore: 0 }, // counted
      {
        id: "m2",
        homeId: P,
        awayId: O1,
        homeScore: 99,
        awayScore: 0,
        resultType: "void",
      },
      { id: "m3", homeId: P, awayId: O1, homeScore: 2, awayScore: 1 }, // counted
    ]);
    const out = await getH2HGrid(sb, P, SEASON);
    expect(out).toHaveLength(1);
    expect(out[0].mp).toBe(2);
    expect(out[0].gf).toBe(7);
    expect(out[0].ga).toBe(1);
  });

  it("excludes unconfirmed matches", async () => {
    const sb = mkSb([
      { id: "m1", homeId: P, awayId: O1, homeScore: 2, awayScore: 0, confirmed: false },
      { id: "m2", homeId: P, awayId: O1, homeScore: 1, awayScore: 0 }, // counted
    ]);
    const out = await getH2HGrid(sb, P, SEASON);
    expect(out).toHaveLength(1);
    expect(out[0].mp).toBe(1);
  });

  it("produces separate rows per opponent; subject is never included", async () => {
    const sb = mkSb([
      { id: "m1", homeId: P, awayId: O1, homeScore: 1, awayScore: 0 },
      { id: "m2", homeId: P, awayId: O2, homeScore: 0, awayScore: 2 },
      { id: "m3", homeId: O2, awayId: P, homeScore: 1, awayScore: 1 },
    ]);
    const out = await getH2HGrid(sb, P, SEASON);
    expect(out.map((r) => r.opponentId).sort()).toEqual([O1, O2].sort());
    // Subject never appears.
    expect(out.find((r) => r.opponentId === P)).toBeUndefined();
    const vO2 = out.find((r) => r.opponentId === O2)!;
    expect(vO2.mp).toBe(2);
    expect(vO2.l).toBe(1);
    expect(vO2.d).toBe(1);
    expect(vO2.gf).toBe(0 + 1);
    expect(vO2.ga).toBe(2 + 1);
  });
});
