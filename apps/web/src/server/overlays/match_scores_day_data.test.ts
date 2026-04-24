import { describe, it, expect, vi } from "vitest";
import {
  fetchMatchScoresDayData,
  fetchMatchScoresDayDataBySession,
  toMatchScoresDayPayload,
} from "./match_scores_day_data";

/**
 * Audit Slice 1 — unit tests for the match_scores_day overlay reader.
 * Mocks the Supabase chain; no real DB hits.
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
const MATCH_DAY = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";

describe("fetchMatchScoresDayData", () => {
  it("returns empty rows + sensible defaults when match_day is unknown", async () => {
    const sb = mkSb({
      match_days: chain({ data: null, error: null }),
    });
    const out = await fetchMatchScoresDayData(sb as never, MATCH_DAY);
    expect(out.rows).toEqual([]);
    expect(out.label).toBe("Match Day");
    expect(out.channels.standings).toBeNull();
    expect(out.channels.session).toBeNull();
  });

  it("builds a label + rows from the match_day + matches query", async () => {
    const matchDayRow = {
      id: MATCH_DAY,
      match_date: "2026-05-02",
      venue_name: "GameEvo Studio",
      season_id: SEASON,
    };
    const matchRows = [
      {
        id: "m1",
        scheduled_time: "18:00:00",
        status: "completed",
        home_player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
        away_player: {
          gamer_tag: "ADEFOLA",
          users: { display_name: "Adefola" },
        },
        match_results: [
          {
            home_score: 3,
            away_score: 1,
            result_type: "normal",
            confirmed_at: "2026-05-02T18:30:00Z",
          },
        ],
      },
      {
        id: "m2",
        scheduled_time: "19:00:00",
        status: "in_progress",
        home_player: { gamer_tag: "KAYKAY", users: { display_name: "Kaykay" } },
        away_player: { gamer_tag: "MITCH", users: { display_name: "Mitch" } },
        match_results: [],
      },
      {
        id: "m3",
        scheduled_time: "20:00:00",
        status: "scheduled",
        home_player: { gamer_tag: "GURU", users: { display_name: "Guru" } },
        away_player: {
          gamer_tag: "WOLEVATION",
          users: { display_name: "Wolevation" },
        },
        match_results: [],
      },
    ];
    const sb = mkSb({
      match_days: chain({ data: matchDayRow, error: null }),
      matches: chain({ data: matchRows, error: null }),
    });
    const out = await fetchMatchScoresDayData(sb as never, MATCH_DAY);
    expect(out.rows.length).toBe(3);
    expect(out.rows[0]).toMatchObject({
      home: "Faruk",
      away: "Adefola",
      home_score: 3,
      away_score: 1,
      status: "completed",
    });
    expect(out.rows[1]).toMatchObject({
      home: "Kaykay",
      away: "Mitch",
      home_score: null,
      away_score: null,
      status: "in_progress",
    });
    expect(out.rows[2]).toMatchObject({
      home: "Guru",
      away: "Wolevation",
      home_score: null,
      away_score: null,
      status: "scheduled",
    });
    expect(out.label).toContain("GameEvo Studio");
    expect(out.channels.standings).toBe(`public:standings:${SEASON}`);
    expect(out.channels.session).toBeNull(); // no sessionId passed
  });

  it("uses draft (non-void) result when no confirmed row exists", async () => {
    const matchDayRow = {
      id: MATCH_DAY,
      match_date: "2026-05-02",
      venue_name: null,
      season_id: SEASON,
    };
    const matchRows = [
      {
        id: "m1",
        scheduled_time: "18:00:00",
        status: "in_progress",
        home_player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
        away_player: {
          gamer_tag: "ADEFOLA",
          users: { display_name: "Adefola" },
        },
        match_results: [
          {
            home_score: 2,
            away_score: 0,
            result_type: "normal",
            confirmed_at: null,
          },
        ],
      },
    ];
    const sb = mkSb({
      match_days: chain({ data: matchDayRow, error: null }),
      matches: chain({ data: matchRows, error: null }),
    });
    const out = await fetchMatchScoresDayData(sb as never, MATCH_DAY);
    expect(out.rows[0].home_score).toBe(2);
    expect(out.rows[0].away_score).toBe(0);
    expect(out.rows[0].status).toBe("in_progress");
  });

  it("excludes void results from the score render", async () => {
    const matchDayRow = {
      id: MATCH_DAY,
      match_date: "2026-05-02",
      venue_name: null,
      season_id: SEASON,
    };
    const matchRows = [
      {
        id: "m1",
        scheduled_time: null,
        status: "voided",
        home_player: { gamer_tag: "FARUK", users: { display_name: "Faruk" } },
        away_player: {
          gamer_tag: "ADEFOLA",
          users: { display_name: "Adefola" },
        },
        match_results: [
          {
            home_score: 3,
            away_score: 0,
            result_type: "void",
            confirmed_at: "2026-05-02T18:30:00Z",
          },
        ],
      },
    ];
    const sb = mkSb({
      match_days: chain({ data: matchDayRow, error: null }),
      matches: chain({ data: matchRows, error: null }),
    });
    const out = await fetchMatchScoresDayData(sb as never, MATCH_DAY);
    expect(out.rows[0].home_score).toBeNull();
    expect(out.rows[0].away_score).toBeNull();
    expect(out.rows[0].status).toBe("scheduled"); // voided → null score
  });

  it("wires session channel when sessionId passed", async () => {
    const sb = mkSb({
      match_days: chain({
        data: {
          id: MATCH_DAY,
          match_date: "2026-05-02",
          venue_name: null,
          season_id: SEASON,
        },
        error: null,
      }),
      matches: chain({ data: [], error: null }),
    });
    const out = await fetchMatchScoresDayData(sb as never, MATCH_DAY, {
      sessionId: SESSION,
    });
    expect(out.channels.session).toBe(`overlay:${SESSION}`);
    expect(out.channels.standings).toBe(`public:standings:${SEASON}`);
  });

  it("falls back to '—' when a player row has neither name nor tag", async () => {
    const sb = mkSb({
      match_days: chain({
        data: {
          id: MATCH_DAY,
          match_date: "2026-05-02",
          venue_name: null,
          season_id: SEASON,
        },
        error: null,
      }),
      matches: chain({
        data: [
          {
            id: "m1",
            scheduled_time: null,
            status: "scheduled",
            home_player: { gamer_tag: null, users: null },
            away_player: {
              gamer_tag: "ADEFOLA",
              users: { display_name: "Adefola" },
            },
            match_results: [],
          },
        ],
        error: null,
      }),
    });
    const out = await fetchMatchScoresDayData(sb as never, MATCH_DAY);
    expect(out.rows[0].home).toBe("—");
    expect(out.rows[0].away).toBe("Adefola");
  });
});

describe("fetchMatchScoresDayDataBySession", () => {
  it("returns null when session is unknown", async () => {
    const sb = mkSb({
      stream_sessions: chain({ data: null, error: null }),
    });
    const out = await fetchMatchScoresDayDataBySession(sb as never, SESSION);
    expect(out).toBeNull();
  });

  it("delegates to fetchMatchScoresDayData with the session's match_day", async () => {
    // Session returns a match_day_id, then the delegate chain returns
    // an empty match_days row → default label.
    const sb = mkSb({
      stream_sessions: chain({
        data: {
          id: SESSION,
          match_day_id: MATCH_DAY,
          primary_match_id: null,
          secondary_match_id: null,
          current_match_id: null,
        },
        error: null,
      }),
      match_days: chain({
        data: {
          id: MATCH_DAY,
          match_date: "2026-05-02",
          venue_name: "Studio",
          season_id: SEASON,
        },
        error: null,
      }),
      matches: chain({ data: [], error: null }),
    });
    const out = await fetchMatchScoresDayDataBySession(sb as never, SESSION);
    expect(out).not.toBeNull();
    expect(out?.matchDayId).toBe(MATCH_DAY);
    expect(out?.channels.session).toBe(`overlay:${SESSION}`);
    expect(out?.channels.standings).toBe(`public:standings:${SEASON}`);
  });
});

describe("toMatchScoresDayPayload", () => {
  it("produces a schema-valid payload", () => {
    const payload = toMatchScoresDayPayload({
      matchDayId: MATCH_DAY,
      seasonId: SEASON,
      matchDate: "2026-05-02",
      venueName: "Studio",
      label: "Fri May 2 · Studio",
      rows: [
        {
          match_id: "m1",
          home: "Faruk",
          away: "Adefola",
          home_score: 3,
          away_score: 1,
          status: "completed",
          scheduled_time: "18:00:00",
        },
      ],
      channels: {
        standings: `public:standings:${SEASON}`,
        session: null,
      },
    });
    expect(payload.matchDayLabel).toBe("Fri May 2 · Studio");
    expect(payload.rows[0]).toEqual({
      home: "Faruk",
      away: "Adefola",
      homeScore: 3,
      awayScore: 1,
      status: "completed",
    });
  });

  it("handles empty rows (schema default)", () => {
    const payload = toMatchScoresDayPayload({
      matchDayId: MATCH_DAY,
      seasonId: SEASON,
      matchDate: null,
      venueName: null,
      label: "Empty Day",
      rows: [],
      channels: { standings: null, session: null },
    });
    expect(payload.rows).toEqual([]);
  });
});
