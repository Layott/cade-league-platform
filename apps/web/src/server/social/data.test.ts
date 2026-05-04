import { describe, it, expect, vi } from "vitest";
import {
  fetchLeaderboardPayload,
  fetchTopScorersPayload,
  fetchUpcomingFixturesPayload,
  fetchGdLeadersPayload,
  fetchLeagueAvgPayload,
} from "./data";

/**
 * Plan 54 Wave 1C — unit tests for `social/data.ts`.
 *
 * Strategy:
 *   - Mock the Supabase client at the table-fan-out level. The fetchers
 *     internally call existing readers (`fetchLeaderboardData`,
 *     `fetchTopScorersData`, `fetchMatchScoresDayDataBySession`) which
 *     themselves chain off `from(...)`. We register one stubbed chain per
 *     table the readers touch, mirroring the pattern in
 *     `leaderboard_data.test.ts` + `match_scores_day_data.test.ts`.
 *   - Photo resolution flows through `player_photo_selections` — we always
 *     supply an empty rowset there so the resolver falls back to its default
 *     (pose 1 / null URL).
 */

const SESSION = "ssss-1111-1111-1111-111111111111";
const MATCH_DAY = "mddd-1111-1111-1111-111111111111";
const SEASON = "seas-1111-1111-1111-111111111111";

type ChainResult = { data: unknown; error: Error | null };

/**
 * Build a Supabase-fluent chain that resolves to `result` regardless of
 * which `select/eq/is/order/limit/in/not/or/maybeSingle/single` calls the
 * caller chains. Mirrors `leaderboard_data.test.ts::chain`.
 */
function chain(result: ChainResult) {
  const thenable = Promise.resolve(result);
  const api: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "is",
    "order",
    "limit",
    "or",
    "in",
    "not",
  ]) {
    api[m] = vi.fn(() => api);
  }
  api.maybeSingle = vi.fn(() => thenable);
  api.single = vi.fn(() => thenable);
  (api as { then?: unknown }).then = (
    onFulfilled: (v: ChainResult) => unknown,
  ) => thenable.then(onFulfilled);
  return api;
}

/**
 * Build a mock Supabase client that fans `from(table)` out to per-table chains.
 * `player_photo_selections` defaults to empty so the resolver falls back.
 */
function mkSb(handlers: Record<string, ChainResult>) {
  const tableChains: Record<string, ReturnType<typeof chain>> = {};
  for (const [table, result] of Object.entries(handlers)) {
    tableChains[table] = chain(result);
  }
  if (!tableChains.player_photo_selections) {
    tableChains.player_photo_selections = chain({ data: [], error: null });
  }
  return {
    from: vi.fn((t: string) => {
      const c = tableChains[t];
      if (!c) {
        throw new Error(`unexpected table read in test: ${t}`);
      }
      return c;
    }),
  };
}

/** Standard session + match_day rows the fetchers' resolveSession picks up. */
const SESSION_ROW = { data: { id: SESSION, match_day_id: MATCH_DAY }, error: null };
const MATCH_DAY_ROW = {
  data: { id: MATCH_DAY, season_id: SEASON, match_date: "2026-05-04" },
  error: null,
};

/* ------------------------------------------------------------------ *
 * fetchLeaderboardPayload                                             *
 * ------------------------------------------------------------------ */

describe("fetchLeaderboardPayload", () => {
  it("maps standings rows to flat shape with sequential pos", async () => {
    const standings = [
      {
        player_id: "p1",
        matches_played: 3,
        wins: 3,
        draws: 0,
        losses: 0,
        goals_for: 9,
        goals_against: 2,
        goal_difference: 7,
        points: 9,
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
      {
        player_id: "p2",
        matches_played: 3,
        wins: 2,
        draws: 0,
        losses: 1,
        goals_for: 7,
        goals_against: 5,
        goal_difference: 2,
        points: 6,
        player: { gamer_tag: "ADEFOLA", users: { display_name: "Adefola" } },
      },
    ];

    const sb = mkSb({
      stream_sessions: SESSION_ROW,
      match_days: MATCH_DAY_ROW,
      standings: { data: standings, error: null },
      season_participants: { data: [], error: null },
      leaderboard_snapshots: { data: [], error: null },
    });

    const payload = await fetchLeaderboardPayload(sb as never, SESSION);
    expect(payload.seasonId).toBe(SEASON);
    expect(payload.matchDayId).toBe(MATCH_DAY);
    expect(payload.weekLabel).toMatch(/2026/);
    expect(payload.rows).toHaveLength(2);
    expect(payload.rows[0].pos).toBe(1);
    expect(payload.rows[0].name).toBe("Faruk");
    expect(payload.rows[0].pts).toBe(9);
    expect(payload.rows[0].gd).toBe(7);
    expect(payload.rows[1].pos).toBe(2);
    expect(payload.rows[1].name).toBe("Adefola");
  });

  it("returns empty rows when standings + season_participants are both empty", async () => {
    const sb = mkSb({
      stream_sessions: SESSION_ROW,
      match_days: MATCH_DAY_ROW,
      standings: { data: [], error: null },
      season_participants: { data: [], error: null },
      leaderboard_snapshots: { data: [], error: null },
    });
    const payload = await fetchLeaderboardPayload(sb as never, SESSION);
    expect(payload.rows).toEqual([]);
  });

  it("throws when session is not found", async () => {
    const sb = mkSb({
      stream_sessions: { data: null, error: null },
    });
    await expect(fetchLeaderboardPayload(sb as never, SESSION)).rejects.toThrow(
      /session.*not found/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * fetchTopScorersPayload                                              *
 * ------------------------------------------------------------------ */

describe("fetchTopScorersPayload", () => {
  it("derives goals from match_results fallback (no pms / ge rows)", async () => {
    const matchResults = [
      {
        match_id: "m1",
        home_score: 5,
        away_score: 1,
        result_type: "normal",
        walkover_pending: false,
        confirmed_at: "2026-05-04T12:00:00Z",
        match: {
          home_player_id: "p1",
          away_player_id: "p2",
          home_player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
          away_player: { gamer_tag: "ADEFOLA", users: { display_name: "Adefola" } },
        },
      },
      {
        match_id: "m2",
        home_score: 2,
        away_score: 3,
        result_type: "normal",
        walkover_pending: false,
        confirmed_at: "2026-05-04T13:00:00Z",
        match: {
          home_player_id: "p3",
          away_player_id: "p1",
          home_player: { gamer_tag: "GURU", users: { display_name: "Guru" } },
          away_player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
        },
      },
    ];
    const sb = mkSb({
      stream_sessions: SESSION_ROW,
      match_days: MATCH_DAY_ROW,
      player_match_stats: { data: [], error: null },
      goal_events: { data: [], error: null },
      match_results: { data: matchResults, error: null },
    });

    const payload = await fetchTopScorersPayload(sb as never, SESSION);
    expect(payload.seasonId).toBe(SEASON);
    expect(payload.rows.length).toBeGreaterThan(0);
    // Faruk scored 5 (home m1) + 3 (away m2) = 8; Adefola = 1; Guru = 2.
    const faruk = payload.rows.find((r) => r.name === "Faruk");
    expect(faruk?.goals).toBe(8);
    // Sort: Faruk (8) first, Guru (2), Adefola (1).
    expect(payload.rows[0].name).toBe("Faruk");
    expect(payload.rows[0].pos).toBe(1);
  });

  it("returns empty rows when no goals across all sources", async () => {
    const sb = mkSb({
      stream_sessions: SESSION_ROW,
      match_days: MATCH_DAY_ROW,
      player_match_stats: { data: [], error: null },
      goal_events: { data: [], error: null },
      match_results: { data: [], error: null },
    });
    const payload = await fetchTopScorersPayload(sb as never, SESSION);
    expect(payload.rows).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * fetchUpcomingFixturesPayload                                        *
 * ------------------------------------------------------------------ */

describe("fetchUpcomingFixturesPayload", () => {
  it("maps match-day matches to flat fixture shape", async () => {
    const matches = [
      {
        id: "m1",
        scheduled_time: "2026-05-04T14:00:00Z",
        status: "scheduled",
        home_player_id: "p1",
        away_player_id: "p2",
        home_player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
        away_player: { gamer_tag: "ADEFOLA", users: { display_name: "Adefola" } },
        match_results: [],
      },
      {
        id: "m2",
        scheduled_time: "2026-05-04T15:00:00Z",
        status: "completed",
        home_player_id: "p3",
        away_player_id: "p4",
        home_player: { gamer_tag: "GURU", users: { display_name: "Guru" } },
        away_player: { gamer_tag: "MITCH", users: { display_name: "Mitch" } },
        match_results: [
          {
            home_score: 3,
            away_score: 1,
            result_type: "normal",
            confirmed_at: "2026-05-04T16:00:00Z",
          },
        ],
      },
    ];
    const sb = mkSb({
      stream_sessions: SESSION_ROW,
      match_days: {
        data: {
          id: MATCH_DAY,
          match_date: "2026-05-04",
          venue_name: "Lagos Arena",
          season_id: SEASON,
        },
        error: null,
      },
      matches: { data: matches, error: null },
    });

    const payload = await fetchUpcomingFixturesPayload(sb as never, SESSION);
    expect(payload.seasonId).toBe(SEASON);
    expect(payload.rows).toHaveLength(2);
    expect(payload.rows[0].matchId).toBe("m1");
    expect(payload.rows[0].home).toBe("Faruk");
    expect(payload.rows[0].away).toBe("Adefola");
    expect(payload.rows[0].status).toBe("scheduled");
    expect(payload.rows[1].status).toBe("completed");
  });

  it("throws when the session resolves to no data", async () => {
    const sb = mkSb({
      stream_sessions: { data: null, error: null },
    });
    await expect(
      fetchUpcomingFixturesPayload(sb as never, SESSION),
    ).rejects.toThrow(/not found/);
  });
});

/* ------------------------------------------------------------------ *
 * fetchGdLeadersPayload                                               *
 * ------------------------------------------------------------------ */

describe("fetchGdLeadersPayload", () => {
  it("returns top 5 by goal difference desc", async () => {
    const standings = Array.from({ length: 7 }, (_, i) => ({
      player_id: `p${i + 1}`,
      matches_played: 5,
      wins: i,
      draws: 0,
      losses: 5 - i,
      goals_for: 10 + i,
      goals_against: 5,
      // p1 GD=1, p2=2, ..., p7=7.
      goal_difference: i + 1,
      points: i * 3,
      player: {
        gamer_tag: `TAG${i + 1}`,
        users: { display_name: `Player ${i + 1}` },
      },
    }));
    const sb = mkSb({
      stream_sessions: SESSION_ROW,
      match_days: MATCH_DAY_ROW,
      standings: { data: standings, error: null },
      season_participants: { data: [], error: null },
    });

    const payload = await fetchGdLeadersPayload(sb as never, SESSION);
    expect(payload.rows).toHaveLength(5);
    expect(payload.rows[0].pos).toBe(1);
    // Largest GD first.
    expect(payload.rows[0].gd).toBe(7);
    expect(payload.rows[0].name).toBe("Player 7");
    expect(payload.rows[1].gd).toBe(6);
    expect(payload.rows[4].gd).toBe(3);
  });

  it("handles fewer than 5 rows gracefully", async () => {
    const standings = [
      {
        player_id: "p1",
        matches_played: 3,
        wins: 3,
        draws: 0,
        losses: 0,
        goals_for: 9,
        goals_against: 2,
        goal_difference: 7,
        points: 9,
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
    ];
    const sb = mkSb({
      stream_sessions: SESSION_ROW,
      match_days: MATCH_DAY_ROW,
      standings: { data: standings, error: null },
      season_participants: { data: [], error: null },
    });

    const payload = await fetchGdLeadersPayload(sb as never, SESSION);
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0].gd).toBe(7);
  });
});

/* ------------------------------------------------------------------ *
 * fetchLeagueAvgPayload                                               *
 * ------------------------------------------------------------------ */

describe("fetchLeagueAvgPayload", () => {
  it("computes 1-decimal averages + halved match total", async () => {
    const standings = [
      {
        player_id: "p1",
        matches_played: 4,
        wins: 3,
        draws: 0,
        losses: 1,
        goals_for: 8,
        goals_against: 3,
        goal_difference: 5,
        points: 9,
        player: { gamer_tag: "F", users: { display_name: "F" } },
      },
      {
        player_id: "p2",
        matches_played: 4,
        wins: 1,
        draws: 0,
        losses: 3,
        goals_for: 4,
        goals_against: 7,
        goal_difference: -3,
        points: 3,
        player: { gamer_tag: "A", users: { display_name: "A" } },
      },
    ];
    const sb = mkSb({
      stream_sessions: SESSION_ROW,
      match_days: MATCH_DAY_ROW,
      standings: { data: standings, error: null },
      season_participants: { data: [], error: null },
    });

    const payload = await fetchLeagueAvgPayload(sb as never, SESSION);
    expect(payload.playerCount).toBe(2);
    expect(payload.avg.matchesPlayed).toBe(4);
    expect(payload.avg.wins).toBe(2);
    expect(payload.avg.goalsFor).toBe(6);
    expect(payload.avg.points).toBe(6);
    // mp/2 = 8/2 = 4 unique matches counted league-wide.
    expect(payload.total.matches).toBe(4);
    expect(payload.total.goalsFor).toBe(12);
  });

  it("returns zeroed payload + playerCount=0 when no rows", async () => {
    const sb = mkSb({
      stream_sessions: SESSION_ROW,
      match_days: MATCH_DAY_ROW,
      standings: { data: [], error: null },
      season_participants: { data: [], error: null },
    });

    const payload = await fetchLeagueAvgPayload(sb as never, SESSION);
    expect(payload.playerCount).toBe(0);
    expect(payload.avg.points).toBe(0);
    expect(payload.total.matches).toBe(0);
  });
});
