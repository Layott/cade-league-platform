import { describe, it, expect, vi, beforeEach } from "vitest";
import { maybeCaptureMatchDaySnapshot } from "./auto_snapshot";

/**
 * Plan 51 — auto-snapshot test harness.
 *
 * Builds a per-table mock matrix matching the shapes used by
 * `maybeCaptureMatchDaySnapshot` + the underlying `captureSnapshot`
 * (which is exercised through the real implementation, not mocked).
 */

type Tables = Record<string, unknown>;

function mkSb(tables: Tables) {
  return {
    from: vi.fn((t: string) => {
      const table = tables[t];
      if (!table) throw new Error(`unexpected table ${t}`);
      return table as Record<string, unknown>;
    }),
  };
}

function mkMatchesTable(opts: {
  matchRow?: { id: string; match_day_id: string } | null;
  allRows?: { id: string }[];
}) {
  return {
    select: vi.fn((cols: string) => {
      // matchId lookup: select('match_day_id').eq('id', x).is('deleted_at', null).maybeSingle()
      if (cols === "match_day_id") {
        return {
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: opts.matchRow ?? null,
                error: null,
              }),
            })),
          })),
        };
      }
      // matches in day: select('id').eq('match_day_id', x).is('deleted_at', null)
      if (cols === "id") {
        return {
          eq: vi.fn(() => ({
            is: vi.fn().mockResolvedValue({
              data: opts.allRows ?? [],
              error: null,
            }),
          })),
        };
      }
      throw new Error(`unexpected matches.select(${cols})`);
    }),
  };
}

function mkResultsTable(opts: {
  finalizedRows?: { match_id: string; result_type: string }[];
}) {
  return {
    select: vi.fn(() => ({
      in: vi.fn(() => ({
        in: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({
            data: opts.finalizedRows ?? [],
            error: null,
          }),
        })),
      })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("maybeCaptureMatchDaySnapshot()", () => {
  it("returns missing_match when match doesn't resolve", async () => {
    const sb = mkSb({
      matches: mkMatchesTable({ matchRow: null }),
    });
    const out = await maybeCaptureMatchDaySnapshot("missing", sb as never);
    expect(out).toEqual({ captured: false, reason: "missing_match" });
  });

  it("returns not_final_match when not all matches finalized", async () => {
    const sb = mkSb({
      matches: mkMatchesTable({
        matchRow: { id: "m1", match_day_id: "md-1" },
        allRows: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
      }),
      match_results: mkResultsTable({
        finalizedRows: [
          { match_id: "m1", result_type: "normal" },
          { match_id: "m2", result_type: "normal" },
        ],
      }),
    });
    const out = await maybeCaptureMatchDaySnapshot("m1", sb as never);
    expect(out).toEqual({ captured: false, reason: "not_final_match" });
  });

  it("captures snapshot when all matches in day are finalized", async () => {
    const matches = mkMatchesTable({
      matchRow: { id: "m1", match_day_id: "md-1" },
      allRows: [{ id: "m1" }, { id: "m2" }],
    });
    const results = mkResultsTable({
      finalizedRows: [
        { match_id: "m1", result_type: "normal" },
        { match_id: "m2", result_type: "forfeit" },
      ],
    });
    // captureSnapshot reads: leaderboard_snapshots (existing read), match_days, standings, leaderboard_snapshots (insert)
    const snapshots = {
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
            data: {
              id: 99,
              captured_at: "2026-04-25T10:00:00Z",
              snapshot_data: [],
            },
            error: null,
          }),
        })),
      })),
    };
    const matchDays = {
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
    const standings = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    };
    const sb = mkSb({
      matches,
      match_results: results,
      leaderboard_snapshots: snapshots,
      match_days: matchDays,
      standings,
    });
    const out = await maybeCaptureMatchDaySnapshot("m1", sb as never);
    expect(out).toEqual({
      captured: true,
      matchDayId: "md-1",
      snapshotId: 99,
    });
  });

  it("voids do NOT count as finalized (so day with a void doesn't trigger snapshot prematurely)", async () => {
    // 3 matches, 2 normal + 1 void → not all finalized.
    const sb = mkSb({
      matches: mkMatchesTable({
        matchRow: { id: "m1", match_day_id: "md-1" },
        allRows: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
      }),
      match_results: mkResultsTable({
        // .in('result_type', ['normal','forfeit']) excludes voids — only the 2
        // non-void rows come back.
        finalizedRows: [
          { match_id: "m1", result_type: "normal" },
          { match_id: "m2", result_type: "normal" },
        ],
      }),
    });
    const out = await maybeCaptureMatchDaySnapshot("m1", sb as never);
    expect(out).toEqual({ captured: false, reason: "not_final_match" });
  });

  it("returns not_final_match when matches table is empty", async () => {
    const sb = mkSb({
      matches: mkMatchesTable({
        matchRow: { id: "m1", match_day_id: "md-empty" },
        allRows: [],
      }),
      match_results: mkResultsTable({ finalizedRows: [] }),
    });
    const out = await maybeCaptureMatchDaySnapshot("m1", sb as never);
    expect(out).toEqual({ captured: false, reason: "not_final_match" });
  });

  it("swallows errors and returns reason=error", async () => {
    const matches = mkMatchesTable({
      matchRow: { id: "m1", match_day_id: "md-1" },
      allRows: [{ id: "m1" }],
    });
    const results = {
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          in: vi.fn(() => ({
            is: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "kaboom" },
            }),
          })),
        })),
      })),
    };
    const sb = mkSb({ matches, match_results: results });
    const out = await maybeCaptureMatchDaySnapshot("m1", sb as never);
    expect(out).toEqual({ captured: false, reason: "error" });
  });

  it("is idempotent: re-call after snapshot exists returns captured=true with existing id", async () => {
    const matches = mkMatchesTable({
      matchRow: { id: "m1", match_day_id: "md-1" },
      allRows: [{ id: "m1" }],
    });
    const results = mkResultsTable({
      finalizedRows: [{ match_id: "m1", result_type: "normal" }],
    });
    // captureSnapshot's existing-snapshot short-circuit:
    // 1. readSnapshot returns truthy.
    // 2. Then a secondary select(id, captured_at, snapshot_data) returns the row.
    let selectCallCount = 0;
    const snapshots = {
      select: vi.fn(() => {
        selectCallCount += 1;
        if (selectCallCount === 1) {
          // readSnapshot's chain (cols starts with captured_at)
          return {
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      captured_at: "2026-04-25T10:00:00Z",
                      snapshot_data: [],
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }
        // Second call: readFull
        return {
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 7,
                    captured_at: "2026-04-25T10:00:00Z",
                    snapshot_data: [],
                  },
                  error: null,
                }),
              })),
            })),
          })),
        };
      }),
      insert: vi.fn(() => {
        throw new Error("should not be called when snapshot exists");
      }),
    };
    const sb = mkSb({
      matches,
      match_results: results,
      leaderboard_snapshots: snapshots,
    });
    const out = await maybeCaptureMatchDaySnapshot("m1", sb as never);
    expect(out).toEqual({
      captured: true,
      matchDayId: "md-1",
      snapshotId: 7,
    });
  });
});
