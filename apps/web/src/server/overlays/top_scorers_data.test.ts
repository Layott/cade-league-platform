import { describe, it, expect, vi } from "vitest";
import {
  fetchTopScorersData,
  toTopScorersPayload,
  topScorersChannelName,
} from "./top_scorers_data";

/**
 * Audit Slice 1 — unit tests for the top-scorers overlay server reader.
 *
 * The reader queries two tables twice (player_match_stats + goal_events)
 * — once without match_id, once with — so the Supabase stub needs to
 * return the same sequence on the N-th call. We model this with a
 * queue-per-table.
 */

type ChainResult = { data: unknown; error: Error | null };

function queueChain(queue: ChainResult[]) {
  let callCount = 0;
  const api: Record<string, unknown> = {};
  const makeThenable = () => {
    const result = queue[callCount] ?? queue[queue.length - 1] ?? {
      data: [],
      error: null,
    };
    callCount += 1;
    return Promise.resolve(result);
  };
  for (const m of ["select", "eq", "is"]) {
    api[m] = vi.fn(() => api);
  }
  api.maybeSingle = vi.fn(makeThenable);
  // Each terminal await returns the next queued result.
  (api as { then?: unknown }).then = (
    onFulfilled: (v: ChainResult) => unknown,
  ) => makeThenable().then(onFulfilled);
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
const MATCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("fetchTopScorersData", () => {
  it("returns empty rows when no data in either source", async () => {
    // Both tables return empty on every call.
    const sb = mkSb({
      player_match_stats: queueChain([
        { data: [], error: null },
        { data: [], error: null },
      ]),
      goal_events: queueChain([
        { data: [], error: null },
        { data: [], error: null },
      ]),
    });
    const out = await fetchTopScorersData(sb as never, SEASON);
    expect(out.rows).toEqual([]);
    expect(out.seasonId).toBe(SEASON);
    expect(out.channel).toBe(`public:standings:${SEASON}`);
  });

  it("aggregates player_match_stats when goal_events is empty", async () => {
    const pms = [
      {
        player_id: "p1",
        match_id: MATCH_A,
        goals: 3,
        match: {
          season_id: SEASON,
          deleted_at: null,
          match_results: [
            { confirmed_at: "2026-05-01T18:00:00Z", result_type: "normal" },
          ],
        },
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
      {
        player_id: "p2",
        match_id: MATCH_A,
        goals: 1,
        match: {
          season_id: SEASON,
          deleted_at: null,
          match_results: [
            { confirmed_at: "2026-05-01T18:00:00Z", result_type: "normal" },
          ],
        },
        player: { gamer_tag: "ADEFOLA", users: { display_name: "Adefola" } },
      },
    ];
    const sb = mkSb({
      player_match_stats: queueChain([
        { data: pms, error: null }, // first select (without match_id)
        { data: pms, error: null }, // second select (with match_id)
      ]),
      goal_events: queueChain([
        { data: [], error: null },
        { data: [], error: null },
      ]),
    });
    const out = await fetchTopScorersData(sb as never, SEASON);
    expect(out.rows.length).toBe(2);
    expect(out.rows[0].player_name).toBe("Faruk");
    expect(out.rows[0].goals).toBe(3);
    expect(out.rows[0].rank).toBe(1);
    expect(out.rows[1].player_name).toBe("Adefola");
    expect(out.rows[1].goals).toBe(1);
    expect(out.rows[1].rank).toBe(2);
  });

  it("skips matches whose match_results aren't confirmed+non-void", async () => {
    // One confirmed match (3 goals), one unconfirmed (5 goals) — reader
    // should only count the confirmed one.
    const pms = [
      {
        player_id: "p1",
        match_id: MATCH_A,
        goals: 3,
        match: {
          season_id: SEASON,
          deleted_at: null,
          match_results: [
            { confirmed_at: "2026-05-01T18:00:00Z", result_type: "normal" },
          ],
        },
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
      {
        player_id: "p1",
        match_id: MATCH_B,
        goals: 5,
        match: {
          season_id: SEASON,
          deleted_at: null,
          match_results: [
            { confirmed_at: null, result_type: "normal" }, // not confirmed
          ],
        },
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
    ];
    const sb = mkSb({
      player_match_stats: queueChain([
        { data: pms, error: null },
        { data: pms, error: null },
      ]),
      goal_events: queueChain([
        { data: [], error: null },
        { data: [], error: null },
      ]),
    });
    const out = await fetchTopScorersData(sb as never, SEASON);
    expect(out.rows.length).toBe(1);
    expect(out.rows[0].goals).toBe(3); // only confirmed match counted
  });

  it("prefers goal_events over player_match_stats for same (player, match)", async () => {
    // Player p1 has goal_events rows for MATCH_A (2 goals, plus 1 own
    // goal that should be excluded). They also have a pms row for
    // MATCH_A saying 5 goals — the ge count (2) should win.
    // Player p2 has only a pms row for MATCH_A (4 goals) — counted.
    // Player p1 also has a pms-only row for MATCH_B (1 goal) — added.
    const gePayload = [
      {
        player_id: "p1",
        match_id: MATCH_A,
        own_goal: false,
        match: { season_id: SEASON, deleted_at: null },
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
      {
        player_id: "p1",
        match_id: MATCH_A,
        own_goal: false,
        match: { season_id: SEASON, deleted_at: null },
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
    ];
    const pmsPayload = [
      {
        player_id: "p1",
        match_id: MATCH_A,
        goals: 5, // suppressed because ge covers this match
        match: {
          season_id: SEASON,
          deleted_at: null,
          match_results: [
            { confirmed_at: "2026-05-01T18:00:00Z", result_type: "normal" },
          ],
        },
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
      {
        player_id: "p1",
        match_id: MATCH_B,
        goals: 1, // no ge for MATCH_B → counted
        match: {
          season_id: SEASON,
          deleted_at: null,
          match_results: [
            { confirmed_at: "2026-05-02T18:00:00Z", result_type: "normal" },
          ],
        },
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
      {
        player_id: "p2",
        match_id: MATCH_A,
        goals: 4, // p2 has no ge — counted fully
        match: {
          season_id: SEASON,
          deleted_at: null,
          match_results: [
            { confirmed_at: "2026-05-01T18:00:00Z", result_type: "normal" },
          ],
        },
        player: { gamer_tag: "ADEFOLA", users: { display_name: "Adefola" } },
      },
    ];
    const sb = mkSb({
      player_match_stats: queueChain([
        { data: pmsPayload, error: null },
        { data: pmsPayload, error: null },
      ]),
      goal_events: queueChain([
        { data: gePayload, error: null },
        { data: gePayload, error: null },
      ]),
    });
    const out = await fetchTopScorersData(sb as never, SEASON);
    // Adefola 4, Faruk 2 (ge MATCH_A) + 1 (pms MATCH_B) = 3
    expect(out.rows[0].player_name).toBe("Adefola");
    expect(out.rows[0].goals).toBe(4);
    expect(out.rows[1].player_name).toBe("Faruk");
    expect(out.rows[1].goals).toBe(3);
  });

  it("excludes zero-goal players", async () => {
    const pms = [
      {
        player_id: "p1",
        match_id: MATCH_A,
        goals: 0,
        match: {
          season_id: SEASON,
          deleted_at: null,
          match_results: [
            { confirmed_at: "2026-05-01T18:00:00Z", result_type: "normal" },
          ],
        },
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
    ];
    const sb = mkSb({
      player_match_stats: queueChain([
        { data: pms, error: null },
        { data: pms, error: null },
      ]),
      goal_events: queueChain([
        { data: [], error: null },
        { data: [], error: null },
      ]),
    });
    const out = await fetchTopScorersData(sb as never, SEASON);
    expect(out.rows).toEqual([]);
  });

  it("tolerates a missing goal_events table (not-yet-migrated env)", async () => {
    const pms = [
      {
        player_id: "p1",
        match_id: MATCH_A,
        goals: 2,
        match: {
          season_id: SEASON,
          deleted_at: null,
          match_results: [
            { confirmed_at: "2026-05-01T18:00:00Z", result_type: "normal" },
          ],
        },
        player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
      },
    ];
    const missingTableError = new Error(
      'relation "public.goal_events" does not exist',
    );
    const sb = mkSb({
      player_match_stats: queueChain([
        { data: pms, error: null },
        { data: pms, error: null },
      ]),
      goal_events: queueChain([
        { data: null, error: missingTableError },
        { data: null, error: missingTableError },
      ]),
    });
    const out = await fetchTopScorersData(sb as never, SEASON);
    expect(out.rows.length).toBe(1);
    expect(out.rows[0].goals).toBe(2);
  });
});

describe("toTopScorersPayload", () => {
  it("returns a schema-valid payload with empty rows when no data", () => {
    const payload = toTopScorersPayload({
      seasonId: SEASON,
      rows: [],
      channel: `public:standings:${SEASON}`,
    });
    expect(payload.rows).toEqual([]);
  });

  it("maps DB rows to schema rows", () => {
    const payload = toTopScorersPayload({
      seasonId: SEASON,
      rows: [
        {
          rank: 1,
          player_id: "p1",
          player_name: "Faruk",
          gamer_tag: "FARUK",
          goals: 7,
          photo_url: "/players/faruk/headshot_01.png",
        },
      ],
      channel: `public:standings:${SEASON}`,
    });
    expect(payload.rows[0]).toEqual({
      rank: 1,
      displayName: "Faruk",
      goals: 7,
      photoUrl: "/players/faruk/headshot_01.png",
    });
  });

  it("omits photoUrl when null", () => {
    const payload = toTopScorersPayload({
      seasonId: SEASON,
      rows: [
        {
          rank: 1,
          player_id: "p1",
          player_name: "Mystery",
          gamer_tag: null,
          goals: 2,
          photo_url: null,
        },
      ],
      channel: `public:standings:${SEASON}`,
    });
    expect(payload.rows[0]).toEqual({
      rank: 1,
      displayName: "Mystery",
      goals: 2,
    });
  });
});

describe("topScorersChannelName", () => {
  it("shares the standings channel topic for re-fetch signalling", () => {
    expect(topScorersChannelName(SEASON)).toBe(`public:standings:${SEASON}`);
  });
});
