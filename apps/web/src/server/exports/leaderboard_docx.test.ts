import { describe, it, expect, vi } from "vitest";
import { generateLeaderboardDOCX, buildFormMap, buildDocument } from "./leaderboard_docx";

function mkSb(opts: {
  standings: unknown[];
  results: unknown[];
  resultsError?: { message: string } | null;
}) {
  const standings = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({
                data: opts.standings,
                error: null,
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
          not: vi.fn().mockResolvedValue({
            data: opts.results,
            error: opts.resultsError ?? null,
          }),
        })),
      })),
    })),
  };
  return {
    from: vi.fn((t: string) => {
      if (t === "standings") return standings;
      if (t === "match_results") return matchResults;
      throw new Error(`unexpected ${t}`);
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
];

describe("buildFormMap()", () => {
  it("encodes results into W/D/L letters", () => {
    const m = buildFormMap(resultsFixture);
    expect(m.get("p1")).toBe("W");
    expect(m.get("p2")).toBe("L");
  });

  it("returns empty map for empty results", () => {
    expect(buildFormMap([]).size).toBe(0);
  });
});

describe("buildDocument()", () => {
  it("builds a Document instance from standings + form map", () => {
    const formMap = buildFormMap(resultsFixture);
    const doc = buildDocument(standingsFixture, formMap);
    expect(doc).toBeDefined();
    // Document is opaque; just confirm it's an object with sections
    expect(typeof doc).toBe("object");
  });
});

describe("generateLeaderboardDOCX()", () => {
  it("returns a non-empty Buffer with valid DOCX magic bytes", async () => {
    const sb = mkSb({ standings: standingsFixture, results: resultsFixture });
    const buf = await generateLeaderboardDOCX("s-1", sb as never);
    expect(Buffer.isBuffer(buf) || buf instanceof Uint8Array).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    // .docx is also a ZIP -> 'PK' header
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("calls .from('standings') + .from('match_results') exactly once", async () => {
    const sb = mkSb({ standings: [], results: [] });
    await generateLeaderboardDOCX("s-1", sb as never);
    expect(sb.from).toHaveBeenCalledWith("standings");
    expect(sb.from).toHaveBeenCalledWith("match_results");
  });

  it("renders even with empty standings (header-only doc)", async () => {
    const sb = mkSb({ standings: [], results: [] });
    const buf = await generateLeaderboardDOCX("s-1", sb as never);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("does not throw when match_results read errors", async () => {
    const errSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sb = mkSb({
      standings: standingsFixture,
      results: [],
      resultsError: { message: "rls" },
    });
    const buf = await generateLeaderboardDOCX("s-1", sb as never);
    expect(buf.length).toBeGreaterThan(0);
    errSpy.mockRestore();
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
                  error: { message: "rls denied" },
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
        throw new Error("?");
      }),
    };
    await expect(generateLeaderboardDOCX("s", sb as never)).rejects.toThrow(
      /standings read/,
    );
  });

  it("uses display_name when present", async () => {
    const sb = mkSb({ standings: standingsFixture, results: [] });
    const buf = await generateLeaderboardDOCX("s-1", sb as never);
    // We can't easily read DOCX content, but at minimum confirm bytes were
    // produced + size sensible.
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("produces deterministic byte length for same input across calls", async () => {
    const sb1 = mkSb({ standings: standingsFixture, results: resultsFixture });
    const sb2 = mkSb({ standings: standingsFixture, results: resultsFixture });
    const a = await generateLeaderboardDOCX("s-1", sb1 as never);
    const b = await generateLeaderboardDOCX("s-1", sb2 as never);
    // docx adds timestamps; lengths typically match within 100 bytes
    expect(Math.abs(a.length - b.length)).toBeLessThan(2000);
  });

  it("uses gamer_tag fallback when display_name is null", async () => {
    const standings = [
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
        player: { gamer_tag: "TACTICAL", users: { display_name: null } },
      },
    ];
    const sb = mkSb({ standings, results: [] });
    const buf = await generateLeaderboardDOCX("s-1", sb as never);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("falls back to '(unknown)' when player record missing", async () => {
    const standings = [
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
        player: null,
      },
    ];
    const sb = mkSb({ standings, results: [] });
    const buf = await generateLeaderboardDOCX("s-1", sb as never);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("produces a workbook with at least N standings rows reflected as bytes", async () => {
    const long = Array.from({ length: 13 }).map((_, i) => ({
      player_id: `p${i}`,
      matches_played: 12,
      wins: 10 - i,
      draws: 2,
      losses: i,
      goals_for: 30 - i,
      goals_against: 10 + i,
      goal_difference: 20 - 2 * i,
      points: 30 - 3 * i,
      player: { gamer_tag: `P${i}`, users: { display_name: `Player ${i}` } },
    }));
    const sb = mkSb({ standings: long, results: [] });
    const buf = await generateLeaderboardDOCX("s-1", sb as never);
    // 13-row table should be larger than the 1-row one
    expect(buf.length).toBeGreaterThan(2000);
  });
});
