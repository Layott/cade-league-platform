import { describe, it, expect, vi } from "vitest";
import {
  fetchLeaderboardData,
  toLeaderboardAnimatedPayload,
  leaderboardChannelName,
} from "./leaderboard_data";

/**
 * Audit Slice 1 — unit tests for the leaderboard overlay server reader.
 * Mocks the Supabase query chain; never hits a real DB.
 */

type ChainResult = { data: unknown; error: Error | null };

function chain(result: ChainResult) {
  const thenable = Promise.resolve(result);
  const api: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit"]) {
    api[m] = vi.fn(() => api);
  }
  api.maybeSingle = vi.fn(() => thenable);
  (api as { then?: unknown }).then = (
    onFulfilled: (v: ChainResult) => unknown,
  ) => thenable.then(onFulfilled);
  return api;
}

function mkSb(handlers: Record<string, unknown>) {
  return {
    from: vi.fn((t: string) => {
      const h = handlers[t];
      if (!h) throw new Error(`unexpected table in test: ${t}`);
      return h;
    }),
  };
}

const SEASON = "11111111-1111-4111-8111-111111111111";

describe("fetchLeaderboardData", () => {
  it("returns empty rows + channel when standings is empty", async () => {
    const sb = mkSb({ standings: chain({ data: [], error: null }) });
    const out = await fetchLeaderboardData(sb as never, SEASON, 10);
    expect(out.rows).toEqual([]);
    expect(out.channel).toBe(`public:standings:${SEASON}`);
    expect(out.seasonId).toBe(SEASON);
  });

  it("maps rows + assigns ranks 1..N from sorted order", async () => {
    const rows = [
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
    const sb = mkSb({ standings: chain({ data: rows, error: null }) });
    const out = await fetchLeaderboardData(sb as never, SEASON, 10);
    expect(out.rows.length).toBe(2);
    expect(out.rows[0].rank).toBe(1);
    expect(out.rows[0].player_name).toBe("Faruk");
    expect(out.rows[0].points).toBe(9);
    expect(out.rows[1].rank).toBe(2);
    expect(out.rows[1].player_name).toBe("Adefola");
  });

  it("falls back to gamer_tag when display_name is null", async () => {
    const rows = [
      {
        player_id: "p1",
        matches_played: 1,
        wins: 1,
        draws: 0,
        losses: 0,
        goals_for: 2,
        goals_against: 0,
        goal_difference: 2,
        points: 3,
        player: { gamer_tag: "KAYKAY", users: null },
      },
    ];
    const sb = mkSb({ standings: chain({ data: rows, error: null }) });
    const out = await fetchLeaderboardData(sb as never, SEASON, 10);
    expect(out.rows[0].player_name).toBe("KAYKAY");
  });

  it("falls back to '(unknown)' when both name fields are null", async () => {
    const rows = [
      {
        player_id: "p1",
        matches_played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goals_for: 0,
        goals_against: 0,
        goal_difference: 0,
        points: 0,
        player: { gamer_tag: null, users: null },
      },
    ];
    const sb = mkSb({ standings: chain({ data: rows, error: null }) });
    const out = await fetchLeaderboardData(sb as never, SEASON, 10);
    expect(out.rows[0].player_name).toBe("(unknown)");
  });

  it("clamps topN into [1, 13]", async () => {
    const sb = mkSb({ standings: chain({ data: [], error: null }) });
    // 2026-04-26 — bumped cap from 10 → 13 (full Elite roster). topN = 50
    // should pass through as 13 to .limit().
    const q = sb.from("standings");
    await fetchLeaderboardData(sb as never, SEASON, 50);
    const limitMock = (
      q as unknown as { limit: ReturnType<typeof vi.fn> }
    ).limit;
    expect(limitMock).toHaveBeenCalledWith(13);
  });

  it("throws a useful error when the query returns an error", async () => {
    const sb = mkSb({
      standings: chain({ data: null, error: new Error("boom") }),
    });
    await expect(
      fetchLeaderboardData(sb as never, SEASON, 10),
    ).rejects.toThrow(/fetchLeaderboardData failed: boom/);
  });
});

describe("toLeaderboardAnimatedPayload", () => {
  it("returns null when no rows", () => {
    const out = toLeaderboardAnimatedPayload({
      seasonId: SEASON,
      rows: [],
      channel: `public:standings:${SEASON}`,
    });
    expect(out).toBeNull();
  });

  it("produces a schema-valid payload from DB rows", () => {
    const data = {
      seasonId: SEASON,
      rows: [
        {
          rank: 1,
          player_id: "p1",
          player_name: "Faruk",
          slug: "faruk",
          matches_played: 3,
          wins: 3,
          draws: 0,
          losses: 0,
          goals_for: 9,
          goals_against: 2,
          goal_difference: 7,
          points: 9,
        },
        {
          rank: 2,
          player_id: "p2",
          player_name: "Adefola",
          slug: "adefola",
          matches_played: 3,
          wins: 2,
          draws: 0,
          losses: 1,
          goals_for: 7,
          goals_against: 5,
          goal_difference: 2,
          points: 6,
        },
      ],
      channel: `public:standings:${SEASON}`,
    };
    const payload = toLeaderboardAnimatedPayload(data);
    expect(payload).not.toBeNull();
    expect(payload?.topN).toBe(2);
    // 2026-04-26 — payload now carries slug, photoUrl, orgLogoUrl, and
    // p/w/d/l/gf/ga so the v2 07-leaderboard overlay can render the
    // 13-player table without a second round-trip. Subset assertion so
    // future field additions don't break the test.
    expect(payload?.rows[0]).toMatchObject({
      rank: 1,
      displayName: "Faruk",
      pts: 9,
      gd: 7,
      slug: "faruk",
      photoUrl: "/overlays/v2/_assets/players/processed/faruk/headshot_01_nobg.png",
      p: 3,
      w: 3,
      d: 0,
      l: 0,
      gf: 9,
      ga: 2,
    });
    expect(payload?.rows[1].displayName).toBe("Adefola");
    expect(payload?.rows[1].slug).toBe("adefola");
  });
});

describe("leaderboardChannelName", () => {
  it("matches the DB migration topic convention", () => {
    expect(leaderboardChannelName(SEASON)).toBe(`public:standings:${SEASON}`);
  });
});
