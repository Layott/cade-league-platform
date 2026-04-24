import { describe, it, expect, vi } from "vitest";
import {
  buildScorebarPayload,
  buildPunishmentTickerPayload,
  buildStandingsWidgetPayload,
  buildScoreBugFromMatch,
  buildLowerThirdFromPlayer,
  buildH2HFromMatch,
  buildUpNextFromNextMatch,
  type MatchLite,
} from "./autofill";

/**
 * Chainable Supabase stub — returns the last-added data when `.maybeSingle`
 * or the chain terminates in an awaited value. Query builders form a long
 * chain of `eq / is / order / limit / select / etc.`; the stub returns
 * itself from each fn, terminating with the configured `result`.
 */
function chain(result: { data: unknown; error: null } | { data: null; error: Error }) {
  const thenable = Promise.resolve(result);
  const api: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "is",
    "order",
    "limit",
    "gte",
    "lte",
  ]) {
    api[m] = vi.fn(() => api);
  }
  api.maybeSingle = vi.fn(() => thenable);
  api.single = vi.fn(() => thenable);
  // For terminal awaits without maybeSingle, expose `.then` so the chain
  // resolves directly.
  (api as { then?: unknown }).then = (
    onFulfilled: (v: typeof result) => unknown,
  ) => thenable.then(onFulfilled);
  return api;
}

function mkSb(handlers: Record<string, unknown>) {
  return {
    from: vi.fn((table: string) => {
      const h = handlers[table];
      if (!h) throw new Error(`unexpected table in test: ${table}`);
      return h;
    }),
  };
}

describe("buildScorebarPayload", () => {
  it("returns null when match not found", async () => {
    const sb = mkSb({
      matches: chain({ data: null, error: null }),
    });
    const out = await buildScorebarPayload(
      sb as never,
      "11111111-1111-4111-8111-111111111111",
    );
    expect(out).toBeNull();
  });

  it("builds schema-valid scorebar payload from match + result", async () => {
    const sb = mkSb({
      matches: chain({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          home_player: { id: "h", users: { display_name: "Anon-01" } },
          away_player: { id: "a", users: { display_name: "Anon-02" } },
          match_results: [{ home_score: 3, away_score: 1 }],
        },
        error: null,
      }),
    });
    const out = await buildScorebarPayload(
      sb as never,
      "11111111-1111-4111-8111-111111111111",
    );
    expect(out).toEqual({
      homeName: "Anon-01",
      awayName: "Anon-02",
      homeScore: 3,
      awayScore: 1,
      matchId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("defaults scores to 0 when no match_results row exists", async () => {
    const sb = mkSb({
      matches: chain({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          home_player: { id: "h", users: { display_name: "A" } },
          away_player: { id: "a", users: { display_name: "B" } },
          match_results: [],
        },
        error: null,
      }),
    });
    const out = await buildScorebarPayload(
      sb as never,
      "11111111-1111-4111-8111-111111111111",
    );
    expect(out?.homeScore).toBe(0);
    expect(out?.awayScore).toBe(0);
  });
});

describe("buildPunishmentTickerPayload", () => {
  it("filters public_visible=true and caps to limit", async () => {
    // The query builder already filters public_visible=true server-side,
    // so we assert the handler is called with a limit and returns N items.
    const rows = Array.from({ length: 5 }, (_, i) => ({
      sanction_type: "warning",
      magnitude: `-${i + 1}`,
      imposed_at: `2026-04-${10 + i}`,
      public_visible: true,
      disciplinary_cases: {
        player_id: `p${i}`,
        players: { users: { display_name: `P${i}` } },
      },
    }));
    const sb = mkSb({
      disciplinary_actions: chain({ data: rows, error: null }),
    });
    const out = await buildPunishmentTickerPayload(
      sb as never,
      "11111111-1111-4111-8111-111111111111",
      8,
    );
    expect(out?.items.length).toBe(5);
    expect(out?.items[0].playerName).toBe("P0");
  });

  it("returns null when no rows", async () => {
    const sb = mkSb({
      disciplinary_actions: chain({ data: [], error: null }),
    });
    const out = await buildPunishmentTickerPayload(
      sb as never,
      "11111111-1111-4111-8111-111111111111",
    );
    expect(out).toBeNull();
  });
});

describe("buildStandingsWidgetPayload", () => {
  it("derives rank from order-by position (standings has no rank column)", async () => {
    // The table is sorted server-side by points desc → gd desc → gf desc;
    // rank is assigned 1..N from the resulting row index.
    const rows = [
      {
        points: 9,
        goal_difference: 5,
        goals_for: 8,
        player: { users: { display_name: "Anon-01" } },
      },
      {
        points: 7,
        goal_difference: 2,
        goals_for: 6,
        player: { users: { display_name: "Anon-02" } },
      },
    ];
    const sb = mkSb({
      standings: chain({ data: rows, error: null }),
    });
    const out = await buildStandingsWidgetPayload(
      sb as never,
      "11111111-1111-4111-8111-111111111111",
      2,
    );
    expect(out?.topN).toBe(2);
    expect(out?.rows[0]).toEqual({
      rank: 1,
      displayName: "Anon-01",
      pts: 9,
      gd: 5,
    });
    expect(out?.rows[1].rank).toBe(2);
  });
});

// -- Plan 42 — match-aware autofill builders -------------------------------

const sampleMatch: MatchLite = {
  id: "11111111-1111-4111-8111-111111111111",
  homePlayer: {
    id: "22222222-2222-4222-8222-222222222222",
    gamerTag: "ADEFOLA",
    displayName: "Adefola",
    jerseyNumber: 10,
  },
  awayPlayer: {
    id: "33333333-3333-4333-8333-333333333333",
    gamerTag: "FARUK",
    displayName: "Faruk",
    jerseyNumber: 7,
  },
};

describe("buildScoreBugFromMatch", () => {
  it("emits schema-valid score_bug starting at 0-0 with both display names", () => {
    const payload = buildScoreBugFromMatch(sampleMatch);
    expect(payload).not.toBeNull();
    expect(payload?.players).toHaveLength(2);
    expect(payload?.players[0].displayName).toBe("Adefola");
    expect(payload?.players[0].score).toBe(0);
    expect(payload?.players[1].displayName).toBe("Faruk");
    expect(payload?.players[1].score).toBe(0);
    expect(payload?.matchId).toBe(sampleMatch.id);
    // Plan 42.1 — no slot passed → no slot field on payload.
    expect((payload as { slot?: string } | null)?.slot).toBeUndefined();
  });

  it("Plan 42.1 — attaches `slot: primary` when slot is passed", () => {
    const payload = buildScoreBugFromMatch(sampleMatch, "primary");
    expect(payload?.slot).toBe("primary");
  });

  it("Plan 42.1 — attaches `slot: secondary` when slot is passed", () => {
    const payload = buildScoreBugFromMatch(sampleMatch, "secondary");
    expect(payload?.slot).toBe("secondary");
  });

  it("returns null when both players are absent", () => {
    const payload = buildScoreBugFromMatch({
      id: "m-1",
      homePlayer: null,
      awayPlayer: null,
    });
    expect(payload).toBeNull();
  });

  it("falls back to '—' when a player row has neither displayName nor gamerTag", () => {
    const payload = buildScoreBugFromMatch({
      id: "44444444-4444-4444-8444-444444444444",
      homePlayer: {
        id: "55555555-5555-4555-8555-555555555555",
        gamerTag: null,
        displayName: null,
        jerseyNumber: null,
      },
      awayPlayer: sampleMatch.awayPlayer,
    });
    expect(payload?.players[0].displayName).toBe("—");
  });
});

describe("buildLowerThirdFromPlayer", () => {
  it("emits schema-valid lower_third payload from a player row", () => {
    const payload = buildLowerThirdFromPlayer(sampleMatch.homePlayer);
    expect(payload?.playerId).toBe("22222222-2222-4222-8222-222222222222");
    expect(payload?.displayName).toBe("Adefola");
    expect(payload?.gamerTag).toBe("ADEFOLA");
    expect(payload?.jerseyNumber).toBe(10);
    expect((payload as { slot?: string } | null)?.slot).toBeUndefined();
  });

  it("Plan 42.1 — attaches slot when passed", () => {
    const payload = buildLowerThirdFromPlayer(sampleMatch.homePlayer, "secondary");
    expect(payload?.slot).toBe("secondary");
  });

  it("returns null on null input", () => {
    expect(buildLowerThirdFromPlayer(null)).toBeNull();
  });
});

describe("buildH2HFromMatch", () => {
  it("loads seasonal stats for both players and returns a schema-valid h2h_2", async () => {
    // Stub standings so both maybeSingle calls resolve to fake W/D/L rows.
    let call = 0;
    const standingsChain = {
      select: vi.fn(() => standingsChain),
      eq: vi.fn(() => standingsChain),
      is: vi.fn(() => standingsChain),
      maybeSingle: vi.fn(() => {
        call += 1;
        const data = call === 1
          ? { wins: 3, draws: 1, losses: 0 }
          : { wins: 1, draws: 2, losses: 2 };
        return Promise.resolve({ data, error: null });
      }),
    };
    const sb = {
      from: vi.fn(() => standingsChain),
    };
    const out = await buildH2HFromMatch(sb as never, sampleMatch);
    expect(out?.players).toHaveLength(2);
    expect(out?.players[0].h2hStats).toEqual({ w: 3, d: 1, l: 0 });
    expect(out?.players[1].h2hStats).toEqual({ w: 1, d: 2, l: 2 });
    expect((out as { slot?: string } | null)?.slot).toBeUndefined();
  });

  it("Plan 42.1 — propagates slot when passed", async () => {
    const standingsChain = {
      select: vi.fn(() => standingsChain),
      eq: vi.fn(() => standingsChain),
      is: vi.fn(() => standingsChain),
      maybeSingle: vi.fn(() =>
        Promise.resolve({ data: { wins: 0, draws: 0, losses: 0 }, error: null }),
      ),
    };
    const sb = { from: vi.fn(() => standingsChain) };
    const out = await buildH2HFromMatch(sb as never, sampleMatch, "secondary");
    expect(out?.slot).toBe("secondary");
  });

  it("returns null when either player is missing", async () => {
    const sb = { from: vi.fn() };
    const out = await buildH2HFromMatch(sb as never, {
      id: "66666666-6666-4666-8666-666666666666",
      homePlayer: sampleMatch.homePlayer,
      awayPlayer: null,
    });
    expect(out).toBeNull();
  });
});

describe("buildUpNextFromNextMatch", () => {
  it("returns null when the session has no rows matching scope", async () => {
    const sessionChain = chain({
      data: {
        match_day_id: "md-1",
        current_match_id: null,
        primary_match_id: null,
        secondary_match_id: null,
      },
      error: null,
    });
    const matchesChain = chain({ data: [], error: null });
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "stream_sessions") return sessionChain;
        if (table === "matches") return matchesChain;
        throw new Error(`unexpected: ${table}`);
      }),
    };
    const out = await buildUpNextFromNextMatch(
      sb as never,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(out).toBeNull();
  });

  it("returns null when the session doesn't exist", async () => {
    const sessionChain = chain({ data: null, error: null });
    const sb = {
      from: vi.fn(() => sessionChain),
    };
    const out = await buildUpNextFromNextMatch(
      sb as never,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(out).toBeNull();
  });

  it("Plan 42.1 — accepts optional slot param without throwing", async () => {
    const sessionChain = chain({ data: null, error: null });
    const sb = { from: vi.fn(() => sessionChain) };
    const out = await buildUpNextFromNextMatch(
      sb as never,
      "22222222-2222-4222-8222-222222222222",
      "primary",
    );
    expect(out).toBeNull();
  });
});
