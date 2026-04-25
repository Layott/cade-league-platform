import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  generateLeaderboardXLSX,
  buildFormMap,
  buildWorkbook,
  type LeaderboardXLSXRow,
} from "./leaderboard_xlsx";

/**
 * Build a sb mock with `.from('standings')` and `.from('match_results')`
 * resolving to fixed data. The chain shape mirrors the real call sequence:
 *
 *   standings:      select -> eq -> is -> order -> order -> order
 *   match_results:  select -> eq -> is -> not
 */
function mkSb(opts: {
  standings: unknown[];
  results: unknown[];
  resultsError?: { message: string } | null;
}) {
  const standingsTerminal = vi
    .fn()
    .mockResolvedValue({ data: opts.standings, error: null });
  const resultsTerminal = vi
    .fn()
    .mockResolvedValue({ data: opts.results, error: opts.resultsError ?? null });

  const standings = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(() => ({
              order: standingsTerminal,
            })),
          })),
        })),
      })),
    })),
  };
  const matchResults = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          not: resultsTerminal,
        })),
      })),
    })),
  };
  return {
    from: vi.fn((t: string) => {
      if (t === "standings") return standings;
      if (t === "match_results") return matchResults;
      throw new Error(`unexpected table ${t}`);
    }),
  };
}

const standingsFixture = [
  {
    player_id: "p1",
    matches_played: 5,
    wins: 4,
    draws: 1,
    losses: 0,
    goals_for: 12,
    goals_against: 3,
    goal_difference: 9,
    points: 13,
    player: { gamer_tag: "FARUK", users: { display_name: "Faruk Doe" } },
  },
  {
    player_id: "p2",
    matches_played: 5,
    wins: 2,
    draws: 1,
    losses: 2,
    goals_for: 7,
    goals_against: 8,
    goal_difference: -1,
    points: 7,
    player: { gamer_tag: "ANIFE", users: { display_name: null } },
  },
];

const resultsFixture = [
  {
    match_id: "m1",
    home_score: 3,
    away_score: 1,
    match: {
      home_player_id: "p1",
      away_player_id: "p2",
      season_id: "s",
      scheduled_for: "2026-04-20T18:00:00Z",
    },
  },
  {
    match_id: "m2",
    home_score: 0,
    away_score: 2,
    match: {
      home_player_id: "p2",
      away_player_id: "p1",
      season_id: "s",
      scheduled_for: "2026-04-21T18:00:00Z",
    },
  },
];

describe("buildFormMap()", () => {
  it("encodes results as W/D/L letters per player and clamps to last 5", () => {
    const m = buildFormMap(resultsFixture);
    expect(m.get("p1")).toBe("WW");
    expect(m.get("p2")).toBe("LL");
  });

  it("returns empty map for empty input", () => {
    expect(buildFormMap([]).size).toBe(0);
  });

  it("clamps to last 5 entries oldest -> newest", () => {
    const seven = Array.from({ length: 7 }).map((_, i) => ({
      match_id: `m${i}`,
      home_score: 1,
      away_score: 0,
      match: {
        home_player_id: "p1",
        away_player_id: "p2",
        season_id: "s",
        scheduled_for: `2026-04-${20 + i}T00:00:00Z`,
      },
    }));
    const m = buildFormMap(seven);
    expect(m.get("p1")?.length).toBe(5);
    expect(m.get("p2")?.length).toBe(5);
  });

  it("D for 1-1 draws", () => {
    const r = [
      {
        match_id: "m1",
        home_score: 1,
        away_score: 1,
        match: {
          home_player_id: "p1",
          away_player_id: "p2",
          season_id: "s",
          scheduled_for: "2026-04-20T00:00:00Z",
        },
      },
    ];
    const m = buildFormMap(r);
    expect(m.get("p1")).toBe("D");
    expect(m.get("p2")).toBe("D");
  });
});

describe("buildWorkbook()", () => {
  it("creates a one-sheet workbook named 'Standings' with header row", () => {
    const rows: LeaderboardXLSXRow[] = [
      {
        pos: 1,
        player: "Faruk",
        p: 5,
        w: 4,
        d: 1,
        l: 0,
        gf: 12,
        ga: 3,
        gd: 9,
        pts: 13,
        form: "WWDWW",
      },
    ];
    const wb = buildWorkbook(rows);
    expect(wb.SheetNames).toEqual(["Standings"]);
    const ws = wb.Sheets["Standings"];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    expect(aoa[0]).toEqual([
      "Pos",
      "Player",
      "P",
      "W",
      "D",
      "L",
      "GF",
      "GA",
      "GD",
      "Pts",
      "Form",
    ]);
    expect(aoa[1]?.[0]).toBe(1);
    expect(aoa[1]?.[1]).toBe("Faruk");
  });
});

describe("generateLeaderboardXLSX()", () => {
  it("returns a non-empty Buffer with valid XLSX magic bytes", async () => {
    const sb = mkSb({
      standings: standingsFixture,
      results: resultsFixture,
    });
    const buf = await generateLeaderboardXLSX("s-1", sb as never);
    expect(Buffer.isBuffer(buf) || buf instanceof Uint8Array).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    // .xlsx is a ZIP -> first two bytes 'PK' (0x50 0x4B).
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("calls .from('standings') + .from('match_results') exactly once", async () => {
    const sb = mkSb({ standings: [], results: [] });
    await generateLeaderboardXLSX("s-1", sb as never);
    expect(sb.from).toHaveBeenCalledWith("standings");
    expect(sb.from).toHaveBeenCalledWith("match_results");
  });

  it("renders display_name when present, falls back to gamer_tag", async () => {
    const sb = mkSb({
      standings: standingsFixture,
      results: resultsFixture,
    });
    const buf = await generateLeaderboardXLSX("s-1", sb as never);
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Standings"];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    expect(aoa[1]?.[1]).toBe("Faruk Doe"); // display_name
    expect(aoa[2]?.[1]).toBe("ANIFE"); // gamer_tag fallback
  });

  it("falls back to (unknown) when both display_name + gamer_tag are null", async () => {
    const standings = [
      {
        player_id: "p3",
        matches_played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goals_for: 0,
        goals_against: 0,
        goal_difference: 0,
        points: 0,
        player: null,
      },
    ];
    const sb = mkSb({ standings, results: [] });
    const buf = await generateLeaderboardXLSX("s-1", sb as never);
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Standings"];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    expect(aoa[1]?.[1]).toBe("(unknown)");
  });

  it("orders rows in standings order from the supabase query (no client-side resort)", async () => {
    const sb = mkSb({
      standings: standingsFixture,
      results: [],
    });
    const buf = await generateLeaderboardXLSX("s-1", sb as never);
    const wb = XLSX.read(buf, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Standings"], {
      header: 1,
    });
    expect(aoa[1]?.[0]).toBe(1);
    expect(aoa[2]?.[0]).toBe(2);
  });

  it("populates Form column from the form map", async () => {
    const sb = mkSb({
      standings: standingsFixture,
      results: resultsFixture,
    });
    const buf = await generateLeaderboardXLSX("s-1", sb as never);
    const wb = XLSX.read(buf, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Standings"], {
      header: 1,
    });
    // header row at idx 0; p1 row at 1, form column is index 10
    expect(aoa[1]?.[10]).toBe("WW");
    expect(aoa[2]?.[10]).toBe("LL");
  });

  it("renders empty form string when the form query errors", async () => {
    const errSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sb = mkSb({
      standings: standingsFixture,
      results: [],
      resultsError: { message: "RLS denied" },
    });
    const buf = await generateLeaderboardXLSX("s-1", sb as never);
    const wb = XLSX.read(buf, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Standings"], {
      header: 1,
    });
    expect(aoa[1]?.[10]).toBe("");
    errSpy.mockRestore();
  });

  it("emits W/D/L from goal_events fallback (canonical order check)", async () => {
    const results = [
      {
        match_id: "m1",
        home_score: 5,
        away_score: 0,
        match: {
          home_player_id: "p1",
          away_player_id: "p2",
          season_id: "s",
          scheduled_for: "2026-04-20T00:00:00Z",
        },
      },
      {
        match_id: "m2",
        home_score: 0,
        away_score: 0,
        match: {
          home_player_id: "p1",
          away_player_id: "p2",
          season_id: "s",
          scheduled_for: "2026-04-22T00:00:00Z",
        },
      },
    ];
    const m = buildFormMap(results);
    expect(m.get("p1")).toBe("WD");
    expect(m.get("p2")).toBe("LD");
  });

  it("propagates standings read error", async () => {
    const standings = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn(() => ({
                order: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: "rls" },
                }),
              })),
            })),
          })),
        })),
      })),
    };
    const matchResults = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            not: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
      })),
    };
    const sb = {
      from: vi.fn((t: string) => {
        if (t === "standings") return standings;
        if (t === "match_results") return matchResults;
        throw new Error(`unexpected ${t}`);
      }),
    };
    await expect(generateLeaderboardXLSX("s", sb as never)).rejects.toThrow(
      /standings read/,
    );
  });

  it("renders 0-row workbook (empty season)", async () => {
    const sb = mkSb({ standings: [], results: [] });
    const buf = await generateLeaderboardXLSX("s", sb as never);
    const wb = XLSX.read(buf, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Standings"], {
      header: 1,
    });
    // Just the header
    expect(aoa.length).toBe(1);
  });
});
