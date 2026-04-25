import { describe, it, expect, vi, beforeEach } from "vitest";
import { enterResult, editResult, confirmResult } from "./results";

function mkSb({
  existing,
  insertId = "r-1",
}: {
  existing?: { id: string; confirmed_at: string | null };
  insertId?: string;
}) {
  const insertFn = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: insertId }, error: null }),
    })),
  }));
  const updateFn = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi
          .fn()
          .mockResolvedValue({ data: { id: existing?.id ?? insertId }, error: null }),
      })),
    })),
  }));
  const matchUpdateFn = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
  // Plan 51: enterResult/editResult emit a follow-up read on `matches` to
  // resolve seasonId + player ids for realtime broadcasts. Mock that chain
  // so the side-effect path doesn't blow up the test.
  const matchSelectFn = vi.fn(() => ({
    eq: vi.fn(() => ({
      is: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            home_player_id: "p-home",
            away_player_id: "p-away",
            match_days: { season_id: "season-1" },
          },
          error: null,
        }),
      })),
    })),
  }));
  // Plan 51: also stub matches lookups for auto_snapshot — `select('id').eq(...)`.
  // Stub leaderboard_snapshots + match_days + standings as no-op chains so
  // the auto_snapshot path runs without throwing in unit tests.
  const send = vi.fn().mockResolvedValue("ok");
  const channel = vi.fn(() => ({ send }));
  const removeChannel = vi.fn();
  return {
    from: vi.fn((t: string) => {
      if (t === "match_results") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: existing ?? null, error: null }),
              })),
            })),
            in: vi.fn(() => ({
              in: vi.fn(() => ({
                is: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            })),
          })),
          insert: insertFn,
          update: updateFn,
        };
      }
      if (t === "matches") {
        return {
          update: matchUpdateFn,
          select: matchSelectFn,
        };
      }
      if (t === "match_days") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "md-1", season_id: "season-1" },
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      if (t === "standings") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
        };
      }
      if (t === "leaderboard_snapshots") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                })),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 1, captured_at: "x", snapshot_data: [] },
                error: null,
              }),
            })),
          })),
        };
      }
      throw new Error(`unexpected ${t}`);
    }),
    channel,
    removeChannel,
    _insert: insertFn,
    _update: updateFn,
    _matchUpdate: matchUpdateFn,
  };
}

const ACTOR = "00000000-0000-4000-8000-000000000099";
const MATCH = "11111111-1111-4111-8111-111111111111";

describe("enterResult", () => {
  beforeEach(() => vi.resetAllMocks());

  it("inserts a draft result when none exists and marks match completed", async () => {
    const sb = mkSb({});
    const out = await enterResult(
      sb as never,
      {
        matchId: MATCH,
        homeScore: 2,
        awayScore: 1,
        resultType: "normal",
      },
      ACTOR
    );
    expect(out.id).toBe("r-1");
    expect(sb._insert).toHaveBeenCalledOnce();
    expect(sb._matchUpdate).toHaveBeenCalledOnce();
  });

  it("rejects re-entering when a result already exists", async () => {
    const sb = mkSb({ existing: { id: "r-0", confirmed_at: null } });
    await expect(
      enterResult(
        sb as never,
        {
          matchId: MATCH,
          homeScore: 0,
          awayScore: 0,
          resultType: "normal",
        },
        ACTOR
      )
    ).rejects.toThrow(/already exists/i);
  });

  it("auto-coerces forfeit to 3-0", async () => {
    const sb = mkSb({});
    await enterResult(
      sb as never,
      {
        matchId: MATCH,
        homeScore: 0,
        awayScore: 0,
        resultType: "forfeit",
      },
      ACTOR
    );
    const payload = (sb._insert.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload.home_score).toBe(3);
    expect(payload.away_score).toBe(0);
  });
});

describe("editResult", () => {
  it("updates existing row (keeps confirmed_at untouched)", async () => {
    const sb = mkSb({ existing: { id: "r-0", confirmed_at: "2026-01-01T00:00:00Z" } });
    await editResult(sb as never, {
      matchId: MATCH,
      homeScore: 4,
      awayScore: 2,
      resultType: "normal",
    });
    expect(sb._update).toHaveBeenCalledOnce();
    const payload = (sb._update.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("confirmed_at");
  });
});

describe("confirmResult", () => {
  it("sets confirmed_by + confirmed_at", async () => {
    const sb = mkSb({ existing: { id: "r-0", confirmed_at: null } });
    await confirmResult(sb as never, { matchId: MATCH }, ACTOR);
    expect(sb._update).toHaveBeenCalledOnce();
    const payload = (sb._update.mock.calls[0] as [unknown])[0] as Record<string, unknown>;
    expect(payload.confirmed_by).toBe(ACTOR);
    expect(typeof payload.confirmed_at).toBe("string");
  });

  it("throws if no draft exists", async () => {
    const sb = mkSb({});
    await expect(confirmResult(sb as never, { matchId: MATCH }, ACTOR)).rejects.toThrow(
      /no result/i
    );
  });

  it("is a no-op if already confirmed", async () => {
    const sb = mkSb({ existing: { id: "r-0", confirmed_at: "2026-01-01T00:00:00Z" } });
    await confirmResult(sb as never, { matchId: MATCH }, ACTOR);
    expect(sb._update).not.toHaveBeenCalled();
  });
});
