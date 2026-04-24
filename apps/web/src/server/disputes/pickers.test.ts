import { describe, it, expect, vi } from "vitest";
import {
  listMatchesForUser,
  listMatchDaysForUser,
  listSanctionsForUser,
} from "./pickers";

const USER_ID = "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu";
const PLAYER_ID = "pppppppp-pppp-4ppp-8ppp-pppppppppppp";
const OTHER_PLAYER_ID = "qqqqqqqq-qqqq-4qqq-8qqq-qqqqqqqqqqqq";
const MATCH_DAY_ID = "mdmdmdmd-mdmd-4mdm-8mdm-mdmdmdmdmdmd";
const MATCH_ID = "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm";

type SbStub = {
  players?: { id: string } | null;
  matches?: unknown[];
  matchDays?: unknown[];
  disciplinaryActions?: unknown[];
};

function mkSb(stub: SbStub) {
  const from = vi.fn((table: string) => {
    if (table === "players") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: stub.players ?? null, error: null }),
            })),
          })),
        })),
      };
    }
    if (table === "matches") {
      return {
        select: vi.fn(() => ({
          // pickers.ts dropped the .or() player filter — any signed-in
          // user now sees all matches. Chain: select().is().limit().
          is: vi.fn(() => ({
            limit: vi
              .fn()
              .mockResolvedValue({ data: stub.matches ?? [], error: null }),
          })),
        })),
      };
    }
    if (table === "match_days") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            is: vi
              .fn()
              .mockResolvedValue({ data: stub.matchDays ?? [], error: null }),
          })),
        })),
      };
    }
    if (table === "disciplinary_actions") {
      return {
        select: vi.fn(() => ({
          is: vi.fn(() => ({
            is: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({
                  data: stub.disciplinaryActions ?? [],
                  error: null,
                }),
              })),
            })),
          })),
        })),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { from } as never;
}

describe("listMatchesForUser", () => {
  it("lists matches even when the caller has no player row (e.g. admin)", async () => {
    const sb = mkSb({
      players: null,
      matches: [
        {
          id: MATCH_ID,
          match_day_id: MATCH_DAY_ID,
          status: "completed",
          home_player_id: PLAYER_ID,
          away_player_id: OTHER_PLAYER_ID,
          match_days: { id: MATCH_DAY_ID, match_date: "2026-04-16", venue_name: "Lagos HQ" },
          match_results: [{ home_score: 2, away_score: 1, result_type: "normal", confirmed_at: "2026-04-16T20:00:00Z" }],
          home: { id: PLAYER_ID, gamer_tag: "ME", users: { display_name: "Me" } },
          away: { id: OTHER_PLAYER_ID, gamer_tag: "WOLE", users: { display_name: "WOLEVATION" } },
        },
      ],
    });
    const out = await listMatchesForUser(sb, USER_ID);
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toMatch(/Me vs WOLEVATION/);
  });

  it("builds a compact label showing both players + home-anchored score", async () => {
    const sb = mkSb({
      players: { id: PLAYER_ID },
      matches: [
        {
          id: MATCH_ID,
          match_day_id: MATCH_DAY_ID,
          status: "completed",
          home_player_id: PLAYER_ID,
          away_player_id: OTHER_PLAYER_ID,
          match_days: {
            id: MATCH_DAY_ID,
            match_date: "2026-04-16",
            venue_name: "Lagos HQ",
          },
          match_results: [
            {
              home_score: 2,
              away_score: 1,
              result_type: "normal",
              confirmed_at: "2026-04-16T20:00:00Z",
            },
          ],
          home: { id: PLAYER_ID, gamer_tag: "ME", users: { display_name: "Me" } },
          away: {
            id: OTHER_PLAYER_ID,
            gamer_tag: "WOLE",
            users: { display_name: "WOLEVATION" },
          },
        },
      ],
    });
    const out = await listMatchesForUser(sb, USER_ID);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(MATCH_ID);
    expect(out[0]!.opponentDisplayName).toBe("Me vs WOLEVATION");
    expect(out[0]!.scoreText).toBe("2-1");
    expect(out[0]!.label).toMatch(/2026-04-16/);
    expect(out[0]!.label).toMatch(/Me vs WOLEVATION/);
    expect(out[0]!.label).toMatch(/2-1/);
  });

  it("score is always home-home, away-away (not submitter-relative)", async () => {
    const sb = mkSb({
      players: { id: PLAYER_ID },
      matches: [
        {
          id: MATCH_ID,
          match_day_id: MATCH_DAY_ID,
          status: "completed",
          home_player_id: OTHER_PLAYER_ID,
          away_player_id: PLAYER_ID,
          match_days: {
            id: MATCH_DAY_ID,
            match_date: "2026-04-16",
            venue_name: "Lagos HQ",
          },
          match_results: {
            home_score: 3,
            away_score: 1,
            result_type: "normal",
            confirmed_at: "2026-04-16T20:00:00Z",
          },
          home: {
            id: OTHER_PLAYER_ID,
            gamer_tag: "WOLE",
            users: { display_name: "WOLEVATION" },
          },
          away: { id: PLAYER_ID, gamer_tag: "ME", users: { display_name: "Me" } },
        },
      ],
    });
    const out = await listMatchesForUser(sb, USER_ID);
    // Home was OTHER (3), away was PLAYER_ID (1) — home-first score text.
    expect(out[0]!.scoreText).toBe("3-1");
    expect(out[0]!.opponentDisplayName).toBe("WOLEVATION vs Me");
  });

  it("omits score for matches with no confirmed result", async () => {
    const sb = mkSb({
      players: { id: PLAYER_ID },
      matches: [
        {
          id: MATCH_ID,
          match_day_id: MATCH_DAY_ID,
          status: "scheduled",
          home_player_id: PLAYER_ID,
          away_player_id: OTHER_PLAYER_ID,
          match_days: {
            id: MATCH_DAY_ID,
            match_date: "2026-04-20",
            venue_name: "Lagos HQ",
          },
          match_results: null,
          home: { id: PLAYER_ID, gamer_tag: "ME", users: { display_name: "Me" } },
          away: {
            id: OTHER_PLAYER_ID,
            gamer_tag: "WOLE",
            users: { display_name: "WOLEVATION" },
          },
        },
      ],
    });
    const out = await listMatchesForUser(sb, USER_ID);
    expect(out[0]!.scoreText).toBeNull();
    // label ends after the opponent name — no trailing " · <n>-<n>" score.
    expect(out[0]!.label).not.toMatch(/· \d+-\d+$/);
  });
});

describe("listMatchDaysForUser", () => {
  it("derives unique match days from the user's matches", async () => {
    const sb = mkSb({
      players: { id: PLAYER_ID },
      matches: [
        {
          id: MATCH_ID,
          match_day_id: MATCH_DAY_ID,
          status: "completed",
          home_player_id: PLAYER_ID,
          away_player_id: OTHER_PLAYER_ID,
          match_days: {
            id: MATCH_DAY_ID,
            match_date: "2026-04-16",
            venue_name: "Lagos HQ",
          },
          match_results: null,
          home: { id: PLAYER_ID, gamer_tag: "ME", users: null },
          away: { id: OTHER_PLAYER_ID, gamer_tag: "WOLE", users: null },
        },
      ],
      matchDays: [
        { id: MATCH_DAY_ID, match_date: "2026-04-16", venue_name: "Lagos HQ" },
      ],
    });
    const out = await listMatchDaysForUser(sb, USER_ID);
    expect(out).toHaveLength(1);
    expect(out[0]!.venueName).toBe("Lagos HQ");
    expect(out[0]!.matchDate).toBe("2026-04-16");
  });
});

describe("listSanctionsForUser", () => {
  it("filters sanctions to the user's player_id only", async () => {
    const sb = mkSb({
      players: { id: PLAYER_ID },
      disciplinaryActions: [
        {
          id: "a1",
          case_id: "c1",
          sanction_type: "warning",
          magnitude: 0,
          effective_from: "2026-04-10",
          notes: null,
          deleted_at: null,
          revoked_at: null,
          disciplinary_cases: {
            id: "c1",
            incident_type: "late_arrival",
            player_id: PLAYER_ID,
          },
        },
        {
          id: "a2",
          case_id: "c2",
          sanction_type: "point_deduction",
          magnitude: 3,
          effective_from: "2026-04-08",
          notes: null,
          deleted_at: null,
          revoked_at: null,
          disciplinary_cases: {
            id: "c2",
            incident_type: "forfeit",
            player_id: OTHER_PLAYER_ID, // NOT mine — must be filtered out
          },
        },
      ],
    });
    const out = await listSanctionsForUser(sb, USER_ID);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("a1");
    expect(out[0]!.label).toMatch(/Late Arrival/i);
    expect(out[0]!.label).toMatch(/Warning/i);
    expect(out[0]!.label).toMatch(/2026-04-10/);
  });

  it("includes magnitude for non-warning sanctions", async () => {
    const sb = mkSb({
      players: { id: PLAYER_ID },
      disciplinaryActions: [
        {
          id: "a1",
          case_id: "c1",
          sanction_type: "point_deduction",
          magnitude: 3,
          effective_from: "2026-04-10",
          notes: null,
          deleted_at: null,
          revoked_at: null,
          disciplinary_cases: {
            id: "c1",
            incident_type: "forfeit",
            player_id: PLAYER_ID,
          },
        },
      ],
    });
    const out = await listSanctionsForUser(sb, USER_ID);
    expect(out[0]!.label).toMatch(/\(3\)/);
  });
});
