import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { generateMetricsXLSX, buildMetricsWorkbook } from "./metrics_xlsx";

function mkSb(opts: {
  standings: unknown[];
  results: unknown[];
  disciplinary: unknown[];
  resultsError?: { message: string } | null;
  disciplinaryError?: { message: string } | null;
  standingsError?: { message: string } | null;
}) {
  const standings = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: opts.standings,
                error: opts.standingsError ?? null,
              }),
            })),
          })),
        })),
      })),
    })),
  };
  // Plan 51 audit fix: both reads dropped the `.eq("<joined>.season_id", ...)`
  // shorthand and now filter in-memory after a `.is(deleted_at, null)`.
  const matchResults = {
    select: vi.fn(() => ({
      is: vi.fn().mockResolvedValue({
        data: opts.results,
        error: opts.resultsError ?? null,
      }),
    })),
  };
  const disciplinary = {
    select: vi.fn(() => ({
      is: vi.fn().mockResolvedValue({
        data: opts.disciplinary,
        error: opts.disciplinaryError ?? null,
      }),
    })),
  };
  return {
    from: vi.fn((t: string) => {
      if (t === "standings") return standings;
      if (t === "match_results") return matchResults;
      if (t === "disciplinary_actions") return disciplinary;
      throw new Error(`unexpected ${t}`);
    }),
  };
}

const standings = [
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
    wins: 1,
    draws: 1,
    losses: 3,
    goals_for: 5,
    goals_against: 9,
    goal_difference: -4,
    points: 4,
    player: { gamer_tag: "ANIFE", users: { display_name: null } },
  },
];

const results = [
  {
    id: "r1",
    match_id: "m1",
    home_score: 3,
    away_score: 1,
    result_type: "normal",
    is_walkover: false,
    walkover_initiated_by: null,
    confirmed_at: "2026-04-21T20:00:00Z",
    created_at: "2026-04-21T18:00:00Z",
    match: {
      home_player_id: "p1",
      away_player_id: "p2",
      season_id: "s-1",
      scheduled_time: "18:00:00",
      match_day_id: "md-1",
    },
  },
  {
    id: "r2",
    match_id: "m2",
    home_score: 3,
    away_score: 0,
    result_type: "forfeit",
    is_walkover: true,
    walkover_initiated_by: "admin",
    confirmed_at: "2026-04-22T20:00:00Z",
    created_at: "2026-04-22T18:00:00Z",
    match: {
      home_player_id: "p2",
      away_player_id: "p1",
      season_id: "s-1",
      scheduled_time: "18:00:00",
      match_day_id: "md-2",
    },
  },
];

const disciplinary = [
  {
    id: "d1",
    sanction_type: "warning",
    magnitude: 1,
    effective_from: "2026-04-21",
    effective_until: null,
    imposed_at: "2026-04-21T20:00:00Z",
    notes: "Late",
    case: { player_id: "p1", season_id: "s-1" },
  },
];

describe("buildMetricsWorkbook()", () => {
  it("creates 5 named sheets", () => {
    const wb = buildMetricsWorkbook({
      standings,
      formMap: new Map([
        ["p1", "WW"],
        ["p2", "LL"],
      ]),
      results,
      disciplinary,
    });
    expect(wb.SheetNames).toEqual([
      "Standings",
      "Per-Player Form",
      "Match-Day Results",
      "Walkovers",
      "Disciplinary Actions",
    ]);
  });

  it("Standings sheet header matches spec", () => {
    const wb = buildMetricsWorkbook({
      standings,
      formMap: new Map(),
      results: [],
      disciplinary: [],
    });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Standings"], {
      header: 1,
    });
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
  });

  it("Per-Player Form sheet aggregates W/D/L counts from form string", () => {
    const wb = buildMetricsWorkbook({
      standings,
      formMap: new Map([
        ["p1", "WWDLW"],
        ["p2", "LLLDD"],
      ]),
      results: [],
      disciplinary: [],
    });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(
      wb.Sheets["Per-Player Form"],
      { header: 1 },
    );
    expect(aoa[0]).toEqual(["Player", "Last 5 Form", "Wins", "Draws", "Losses"]);
    expect(aoa[1]?.[2]).toBe(3);
    expect(aoa[1]?.[3]).toBe(1);
    expect(aoa[1]?.[4]).toBe(1);
  });

  it("Walkovers sheet only includes is_walkover=true rows", () => {
    const wb = buildMetricsWorkbook({
      standings,
      formMap: new Map(),
      results,
      disciplinary,
    });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Walkovers"], {
      header: 1,
    });
    // header + 1 row for r2 walkover
    expect(aoa.length).toBe(2);
    expect(aoa[1]?.[6]).toBe("admin");
  });

  it("Match-Day Results sheet sorts by match_day_id ascending", () => {
    const reversed = [...results].reverse();
    const wb = buildMetricsWorkbook({
      standings,
      formMap: new Map(),
      results: reversed,
      disciplinary,
    });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(
      wb.Sheets["Match-Day Results"],
      { header: 1 },
    );
    expect(aoa[1]?.[0]).toBe("md-1");
    expect(aoa[2]?.[0]).toBe("md-2");
  });

  it("Disciplinary sheet maps player_id to display name", () => {
    const wb = buildMetricsWorkbook({
      standings,
      formMap: new Map(),
      results: [],
      disciplinary,
    });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(
      wb.Sheets["Disciplinary Actions"],
      { header: 1 },
    );
    expect(aoa[1]?.[0]).toBe("Faruk Doe");
  });
});

describe("generateMetricsXLSX()", () => {
  it("returns a Buffer with valid XLSX magic bytes (PK header)", async () => {
    const sb = mkSb({ standings, results, disciplinary });
    const buf = await generateMetricsXLSX("s-1", sb as never);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("queries all 3 tables", async () => {
    const sb = mkSb({ standings: [], results: [], disciplinary: [] });
    await generateMetricsXLSX("s-1", sb as never);
    expect(sb.from).toHaveBeenCalledWith("standings");
    expect(sb.from).toHaveBeenCalledWith("match_results");
    expect(sb.from).toHaveBeenCalledWith("disciplinary_actions");
  });

  it("survives match_results read error (sheet remains empty)", async () => {
    const errSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sb = mkSb({
      standings,
      results: [],
      disciplinary: [],
      resultsError: { message: "rls" },
    });
    const buf = await generateMetricsXLSX("s-1", sb as never);
    expect(buf.length).toBeGreaterThan(0);
    errSpy.mockRestore();
  });

  it("survives disciplinary read error (sheet remains empty)", async () => {
    const errSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sb = mkSb({
      standings,
      results: [],
      disciplinary: [],
      disciplinaryError: { message: "rls" },
    });
    const buf = await generateMetricsXLSX("s-1", sb as never);
    expect(buf.length).toBeGreaterThan(0);
    errSpy.mockRestore();
  });

  it("propagates standings read error (cannot recover)", async () => {
    const sb = mkSb({
      standings: [],
      results: [],
      disciplinary: [],
      standingsError: { message: "rls" },
    });
    await expect(generateMetricsXLSX("s-1", sb as never)).rejects.toThrow(
      /standings read/,
    );
  });

  it("includes 5 sheets in the produced buffer", async () => {
    const sb = mkSb({ standings, results, disciplinary });
    const buf = await generateMetricsXLSX("s-1", sb as never);
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames.length).toBe(5);
  });

  it("produces non-trivial bytes for a fully populated workbook", async () => {
    const sb = mkSb({ standings, results, disciplinary });
    const buf = await generateMetricsXLSX("s-1", sb as never);
    expect(buf.length).toBeGreaterThan(2000);
  });

  it("0-row inputs produce a workbook with 5 header-only sheets", async () => {
    const sb = mkSb({ standings: [], results: [], disciplinary: [] });
    const buf = await generateMetricsXLSX("s-1", sb as never);
    const wb = XLSX.read(buf, { type: "buffer" });
    for (const name of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
        header: 1,
      });
      // header row only
      expect(aoa.length).toBe(1);
    }
  });

  it("Standings sheet preserves player count from input", async () => {
    const sb = mkSb({ standings, results: [], disciplinary: [] });
    const buf = await generateMetricsXLSX("s-1", sb as never);
    const wb = XLSX.read(buf, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(
      wb.Sheets["Standings"],
      { header: 1 },
    );
    expect(aoa.length).toBe(1 + standings.length);
  });

  it("Walkovers sheet only contains walkover rows from results fixture", async () => {
    const sb = mkSb({ standings, results, disciplinary });
    const buf = await generateMetricsXLSX("s-1", sb as never);
    const wb = XLSX.read(buf, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(
      wb.Sheets["Walkovers"],
      { header: 1 },
    );
    // 1 walkover row + header
    expect(aoa.length).toBe(2);
  });
});
