import { describe, it, expect } from "vitest";
import { buildFormMap, type ResultRow } from "./leaderboard_view";

/**
 * Plan 51 follow-up — form-build filter regression tests.
 *
 * Reproduces the Anife `form="LLLLL", played=0` bug where pending-walkover
 * rows (scores logged, awaiting counter-confirm) leaked into the per-player
 * form string even though `recompute_standings` correctly excluded them
 * from `played`.
 */

function row(overrides: Partial<ResultRow>): ResultRow {
  return {
    match_id: "m-x",
    home_score: 0,
    away_score: 0,
    result_type: "normal",
    walkover_pending: false,
    match: {
      home_player_id: "p-h",
      away_player_id: "p-a",
      season_id: "s-1",
    },
    ...overrides,
  };
}

describe("buildFormMap", () => {
  it("excludes walkover_pending rows from form", () => {
    // Anife is the away player on every walkover-pending 0-3 row.
    const anife = "p-anife";
    const rows: ResultRow[] = [
      row({
        match_id: "m1",
        home_score: 3,
        away_score: 0,
        walkover_pending: true,
        match: { home_player_id: "p-1", away_player_id: anife, season_id: "s-1" },
      }),
      row({
        match_id: "m2",
        home_score: 3,
        away_score: 0,
        walkover_pending: true,
        match: { home_player_id: "p-2", away_player_id: anife, season_id: "s-1" },
      }),
      row({
        match_id: "m3",
        home_score: 3,
        away_score: 0,
        walkover_pending: true,
        match: { home_player_id: "p-3", away_player_id: anife, season_id: "s-1" },
      }),
    ];
    const out = buildFormMap(rows);
    // Anife should NOT be present in the form map at all — every row was
    // filtered out as walkover_pending.
    expect(out.get(anife)).toBeUndefined();
    expect(out.get("p-1")).toBeUndefined();
  });

  it("excludes void rows from form (existing rule, regression-locked)", () => {
    const rows: ResultRow[] = [
      row({
        match_id: "m1",
        home_score: 2,
        away_score: 1,
        result_type: "void",
        match: { home_player_id: "p-h", away_player_id: "p-a", season_id: "s-1" },
      }),
    ];
    const out = buildFormMap(rows);
    expect(out.size).toBe(0);
  });

  it("counts confirmed normal results into form letters", () => {
    const rows: ResultRow[] = [
      row({
        match_id: "m1",
        home_score: 2,
        away_score: 1,
        result_type: "normal",
        walkover_pending: false,
        match: { home_player_id: "p-h", away_player_id: "p-a", season_id: "s-1" },
      }),
    ];
    const out = buildFormMap(rows);
    expect(out.get("p-h")).toBe("W");
    expect(out.get("p-a")).toBe("L");
  });

  it("counts confirmed forfeit (walkover_pending=false) into form", () => {
    const rows: ResultRow[] = [
      row({
        match_id: "m1",
        home_score: 3,
        away_score: 0,
        result_type: "forfeit",
        walkover_pending: false,
        match: { home_player_id: "p-h", away_player_id: "p-a", season_id: "s-1" },
      }),
    ];
    const out = buildFormMap(rows);
    expect(out.get("p-h")).toBe("W");
    expect(out.get("p-a")).toBe("L");
  });

  it("treats missing walkover_pending (null) as confirmed (legacy rows)", () => {
    // Legacy rows from before the walkover_pending column existed should
    // continue to count toward form.
    const rows: ResultRow[] = [
      row({
        match_id: "m1",
        home_score: 1,
        away_score: 1,
        result_type: "normal",
        walkover_pending: null,
      }),
    ];
    const out = buildFormMap(rows);
    expect(out.get("p-h")).toBe("D");
    expect(out.get("p-a")).toBe("D");
  });
});
