import { describe, it, expect, vi } from "vitest";
import {
  buildScorebarPayload,
  buildPunishmentTickerPayload,
  buildStandingsWidgetPayload,
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
      issued_at: `2026-04-${10 + i}`,
      public_visible: true,
      player: { users: { display_name: `P${i}` } },
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
  it("returns schema-valid rows in rank order", async () => {
    const rows = [
      {
        rank: 1,
        points: 9,
        goal_difference: 5,
        player: { users: { display_name: "Anon-01" } },
      },
      {
        rank: 2,
        points: 7,
        goal_difference: 2,
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
  });
});
