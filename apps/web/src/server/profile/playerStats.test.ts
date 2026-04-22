import { describe, it, expect, vi } from "vitest";
import {
  getSeasonStats,
  getFormLastN,
  getCurrentStreaks,
  getMatchHistory,
} from "./playerStats";

const P = "pppppppp-pppp-4ppp-8ppp-pppppppppppp";
const O1 = "11111111-1111-4111-8111-111111111111";
const O2 = "22222222-2222-4222-8222-222222222222";
const O3 = "33333333-3333-4333-8333-333333333333";
const SEASON = "ssssssss-ssss-4sss-8sss-ssssssssssss";

/**
 * Minimal DTO a test can pass to `mkSb` — a row as Supabase would return it
 * from the matches + match_results + match_days + home/away join.
 */
type FakeMatch = {
  id: string;
  homeId: string;
  awayId: string;
  matchDate: string; // YYYY-MM-DD
  homeScore: number;
  awayScore: number;
  resultType?: "normal" | "forfeit" | "void";
  confirmed?: boolean;
  homeName?: string;
  awayName?: string;
  matchDayDeleted?: boolean;
};

function toRaw(m: FakeMatch) {
  return {
    id: m.id,
    home_player_id: m.homeId,
    away_player_id: m.awayId,
    match_day_id: `md-${m.id}`,
    match_days: {
      match_date: m.matchDate,
      deleted_at: m.matchDayDeleted ? "2026-04-01T00:00:00Z" : null,
    },
    match_results: {
      home_score: m.homeScore,
      away_score: m.awayScore,
      result_type: m.resultType ?? "normal",
      confirmed_at: m.confirmed === false ? null : "2026-04-22T10:00:00Z",
    },
    home: {
      id: m.homeId,
      gamer_tag: m.homeName ?? `tag-${m.homeId.slice(0, 3)}`,
      users: { display_name: m.homeName ?? `P-${m.homeId.slice(0, 3)}` },
    },
    away: {
      id: m.awayId,
      gamer_tag: m.awayName ?? `tag-${m.awayId.slice(0, 3)}`,
      users: { display_name: m.awayName ?? `P-${m.awayId.slice(0, 3)}` },
    },
  };
}

/**
 * Mock a Supabase client that:
 *   - Returns `standings` with a provided rank ordering (optional)
 *   - Returns `matches` rows from the fixture list
 */
function mkSb(opts: {
  matches?: FakeMatch[];
  standings?: Array<{
    player_id: string;
    matches_played: number;
    wins: number;
    draws: number;
    losses: number;
    goals_for: number;
    goals_against: number;
    goal_difference: number;
    points: number;
    punishment_points_deducted: number;
    punishment_gd_deducted: number;
    display_name?: string;
    gamer_tag?: string;
  }>;
}) {
  const matchRows = (opts.matches ?? []).map(toRaw);
  return {
    from: vi.fn((table: string) => {
      if (table === "standings") {
        const data = (opts.standings ?? []).map((r) => ({
          player_id: r.player_id,
          matches_played: r.matches_played,
          wins: r.wins,
          draws: r.draws,
          losses: r.losses,
          goals_for: r.goals_for,
          goals_against: r.goals_against,
          goal_difference: r.goal_difference,
          points: r.points,
          punishment_points_deducted: r.punishment_points_deducted,
          punishment_gd_deducted: r.punishment_gd_deducted,
          player: {
            id: r.player_id,
            gamer_tag: r.gamer_tag ?? "tag",
            users: { id: r.player_id, display_name: r.display_name ?? "Name" },
          },
        }));
        // listStandings chains: from → select → eq → is → order → order → order
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          is: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: (resolve: (v: { data: typeof data; error: null }) => unknown) =>
            resolve({ data, error: null }),
        };
        return chain;
      }
      if (table === "matches") {
        // readPlayerMatches chains: from → select → eq → is → or  → (awaitable)
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          is: vi.fn(() => chain),
          or: vi.fn(() =>
            Promise.resolve({ data: matchRows, error: null }),
          ),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    }),
  } as never;
}

describe("getSeasonStats", () => {
  it("returns zeros + null position when player has no standings row", async () => {
    const sb = mkSb({ standings: [] });
    const out = await getSeasonStats(sb, P, SEASON);
    expect(out).toEqual({
      mp: 0,
      w: 0,
      d: 0,
      l: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
      pointsDeducted: 0,
      gdDeducted: 0,
      tablePosition: null,
    });
  });

  it("maps standings row to stats + tablePosition (1-indexed)", async () => {
    const sb = mkSb({
      standings: [
        {
          player_id: O1,
          matches_played: 10,
          wins: 7,
          draws: 2,
          losses: 1,
          goals_for: 22,
          goals_against: 5,
          goal_difference: 17,
          points: 23,
          punishment_points_deducted: 0,
          punishment_gd_deducted: 0,
        },
        {
          player_id: P,
          matches_played: 10,
          wins: 6,
          draws: 1,
          losses: 3,
          goals_for: 18,
          goals_against: 10,
          goal_difference: 8,
          points: 19,
          punishment_points_deducted: 2,
          punishment_gd_deducted: 1,
        },
      ],
    });
    const out = await getSeasonStats(sb, P, SEASON);
    expect(out.tablePosition).toBe(2);
    expect(out.mp).toBe(10);
    expect(out.points).toBe(19);
    expect(out.pointsDeducted).toBe(2);
    expect(out.gdDeducted).toBe(1);
    expect(out.gd).toBe(8);
  });
});

describe("getFormLastN", () => {
  it("returns empty array when no matches", async () => {
    const sb = mkSb({ matches: [] });
    const out = await getFormLastN(sb, P, SEASON, 5);
    expect(out).toEqual([]);
  });

  it("returns partial-season results oldest → newest", async () => {
    const sb = mkSb({
      matches: [
        { id: "m1", homeId: P, awayId: O1, matchDate: "2026-05-04", homeScore: 3, awayScore: 1 }, // W
        { id: "m2", homeId: O2, awayId: P, matchDate: "2026-05-11", homeScore: 0, awayScore: 2 }, // W (as away)
        { id: "m3", homeId: P, awayId: O3, matchDate: "2026-05-18", homeScore: 1, awayScore: 1 }, // D
      ],
    });
    const out = await getFormLastN(sb, P, SEASON, 5);
    expect(out.map((x) => x.result)).toEqual(["W", "W", "D"]);
    expect(out[0].wasHome).toBe(true);
    expect(out[1].wasHome).toBe(false);
    expect(out.map((x) => x.matchDate)).toEqual(["2026-05-04", "2026-05-11", "2026-05-18"]);
  });

  it("limits to n most recent and returns them oldest-first", async () => {
    const ms: Parameters<typeof mkSb>[0]["matches"] = [];
    for (let i = 0; i < 8; i++) {
      ms!.push({
        id: `m${i}`,
        homeId: P,
        awayId: O1,
        matchDate: `2026-05-${String(i + 1).padStart(2, "0")}`,
        homeScore: 2,
        awayScore: 1,
      });
    }
    const sb = mkSb({ matches: ms });
    const out = await getFormLastN(sb, P, SEASON, 5);
    expect(out).toHaveLength(5);
    // Oldest-first of the last 5 → m3..m7.
    expect(out.map((x) => x.matchId)).toEqual(["m3", "m4", "m5", "m6", "m7"]);
  });

  it("excludes void matches", async () => {
    const sb = mkSb({
      matches: [
        { id: "m1", homeId: P, awayId: O1, matchDate: "2026-05-04", homeScore: 3, awayScore: 0 }, // W
        {
          id: "m2",
          homeId: O1,
          awayId: P,
          matchDate: "2026-05-05",
          homeScore: 3,
          awayScore: 0,
          resultType: "void",
        },
        { id: "m3", homeId: P, awayId: O2, matchDate: "2026-05-06", homeScore: 0, awayScore: 2 }, // L
      ],
    });
    const out = await getFormLastN(sb, P, SEASON, 5);
    expect(out.map((x) => x.matchId)).toEqual(["m1", "m3"]);
  });
});

describe("getCurrentStreaks", () => {
  it("zero streaks when no matches", async () => {
    const sb = mkSb({ matches: [] });
    const out = await getCurrentStreaks(sb, P, SEASON);
    expect(out).toEqual({ winStreak: 0, unbeatenStreak: 0, goalScoringStreak: 0 });
  });

  it("win streak resets on a loss; unbeaten continues through draws", async () => {
    // Oldest → newest: W W L D W W W. Most-recent = W.
    // winStreak should = 3 (most-recent 3 wins).
    // unbeatenStreak should = 3 (same — hits the 'L' which breaks it). Wait
    // the 'L' came before the 4th-from-last, so unbeaten starts fresh after L.
    // From most-recent going back: W, W, W, D, L → unbeaten stops at L.
    // Unbeaten wins+draws before L = 4 (W, W, W, D). So unbeatenStreak = 4.
    const sb = mkSb({
      matches: [
        { id: "m1", homeId: P, awayId: O1, matchDate: "2026-05-01", homeScore: 2, awayScore: 1 }, // W
        { id: "m2", homeId: P, awayId: O1, matchDate: "2026-05-02", homeScore: 1, awayScore: 0 }, // W
        { id: "m3", homeId: O1, awayId: P, matchDate: "2026-05-03", homeScore: 2, awayScore: 0 }, // L
        { id: "m4", homeId: P, awayId: O1, matchDate: "2026-05-04", homeScore: 1, awayScore: 1 }, // D
        { id: "m5", homeId: P, awayId: O1, matchDate: "2026-05-05", homeScore: 2, awayScore: 0 }, // W
        { id: "m6", homeId: P, awayId: O1, matchDate: "2026-05-06", homeScore: 3, awayScore: 0 }, // W
        { id: "m7", homeId: P, awayId: O1, matchDate: "2026-05-07", homeScore: 1, awayScore: 0 }, // W
      ],
    });
    const out = await getCurrentStreaks(sb, P, SEASON);
    expect(out.winStreak).toBe(3);
    expect(out.unbeatenStreak).toBe(4);
  });

  it("goal-scoring streak stops at a zero-gf match", async () => {
    // Newest last. Most-recent 3 matches all have player-gf > 0, before
    // that one with 0 gf.
    const sb = mkSb({
      matches: [
        { id: "m1", homeId: P, awayId: O1, matchDate: "2026-05-01", homeScore: 0, awayScore: 0 }, // gf=0
        { id: "m2", homeId: P, awayId: O1, matchDate: "2026-05-02", homeScore: 2, awayScore: 0 }, // gf=2
        { id: "m3", homeId: O1, awayId: P, matchDate: "2026-05-03", homeScore: 0, awayScore: 1 }, // gf=1 (away)
        { id: "m4", homeId: P, awayId: O1, matchDate: "2026-05-04", homeScore: 3, awayScore: 3 }, // gf=3
      ],
    });
    const out = await getCurrentStreaks(sb, P, SEASON);
    expect(out.goalScoringStreak).toBe(3);
  });
});

describe("getMatchHistory", () => {
  it("paginates most-recent first with correct pageCount", async () => {
    const ms: Parameters<typeof mkSb>[0]["matches"] = [];
    for (let i = 1; i <= 12; i++) {
      ms!.push({
        id: `m${i}`,
        homeId: P,
        awayId: O1,
        matchDate: `2026-05-${String(i).padStart(2, "0")}`,
        homeScore: 1,
        awayScore: 0,
      });
    }
    const sb = mkSb({ matches: ms });

    const page1 = await getMatchHistory(sb, P, SEASON, { page: 1, pageSize: 10 });
    expect(page1.pageCount).toBe(2);
    expect(page1.rows).toHaveLength(10);
    // Most-recent first → m12, m11, ..., m3.
    expect(page1.rows[0].matchId).toBe("m12");
    expect(page1.rows[9].matchId).toBe("m3");

    const page2 = await getMatchHistory(sb, P, SEASON, { page: 2, pageSize: 10 });
    expect(page2.rows).toHaveLength(2);
    expect(page2.rows[0].matchId).toBe("m2");
    expect(page2.rows[1].matchId).toBe("m1");
  });

  it("computes result and GD correctly for home vs away orientation", async () => {
    const sb = mkSb({
      matches: [
        // Player is HOME, scored 4 conceded 1 → W, GD contribution +3.
        { id: "home-win", homeId: P, awayId: O1, matchDate: "2026-05-01", homeScore: 4, awayScore: 1 },
        // Player is AWAY, scored 0 conceded 2 → L, GD contribution -2.
        { id: "away-loss", homeId: O2, awayId: P, matchDate: "2026-05-02", homeScore: 2, awayScore: 0 },
      ],
    });
    const page = await getMatchHistory(sb, P, SEASON, { page: 1, pageSize: 10 });
    const homeWin = page.rows.find((r) => r.matchId === "home-win")!;
    expect(homeWin.result).toBe("W");
    expect(homeWin.wasHome).toBe(true);
    expect(homeWin.homeScore).toBe(4);
    expect(homeWin.awayScore).toBe(1);

    const awayLoss = page.rows.find((r) => r.matchId === "away-loss")!;
    expect(awayLoss.result).toBe("L");
    expect(awayLoss.wasHome).toBe(false);
    expect(awayLoss.homeScore).toBe(2);
    expect(awayLoss.awayScore).toBe(0);
  });
});
