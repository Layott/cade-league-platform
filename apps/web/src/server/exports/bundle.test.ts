import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  buildBundleWorkbook,
  collectBundleData,
  type BundleData,
} from "./bundle";

const SEASON_ID = "s-1";

const season = {
  id: SEASON_ID,
  year_range: "2025-2026",
  division_name: "Division 1 Elite",
  start_date: "2025-09-01",
  end_date: "2026-06-30",
  status: "active",
};

const partners = [
  {
    partner_key: "wagyr",
    label: "Wagyr",
    display_label: "Wagyr",
    alt: "Wagyr logo",
    file_url: "/brand/wagyr.png",
    sort_order: 0,
  },
  {
    partner_key: "gamepride",
    label: "Gamepride",
    display_label: null,
    alt: "Gamepride logo",
    file_url: "/brand/gamepride.png",
    sort_order: 1,
  },
];

const matchDays = [
  {
    id: "md-1",
    match_date: "2026-05-16",
    arrival_cutoff_time: "16:00:00",
    match_start_time: "17:00:00",
    venue_name: "Onile",
    status: "scheduled",
    notes: null,
  },
];

const players = [
  {
    id: "p1",
    gamer_tag: "FARUK",
    users: { display_name: "Faruk Doe" },
  },
  {
    id: "p2",
    gamer_tag: "ANIFE",
    users: { display_name: null },
  },
];

const matches = [
  {
    id: "m1",
    match_day_id: "md-1",
    scheduled_time: "17:00:00",
    status: "completed",
    match_slot: 1,
    match_lane: 1,
    home_player_id: "p1",
    away_player_id: "p2",
  },
];

const results = [
  {
    match_id: "m1",
    home_score: 3,
    away_score: 1,
    result_type: "normal",
    is_walkover: false,
    walkover_initiated_by: null,
    confirmed_at: "2026-05-16T18:00:00Z",
    created_at: "2026-05-16T17:00:00Z",
    match: {
      home_player_id: "p1",
      away_player_id: "p2",
      season_id: SEASON_ID,
      match_day_id: "md-1",
    },
  },
];

const standings = [
  {
    player_id: "p1",
    matches_played: 1,
    wins: 1,
    draws: 0,
    losses: 0,
    goals_for: 3,
    goals_against: 1,
    goal_difference: 2,
    points: 3,
    player: { gamer_tag: "FARUK", users: { display_name: "Faruk Doe" } },
  },
  {
    player_id: "p2",
    matches_played: 1,
    wins: 0,
    draws: 0,
    losses: 1,
    goals_for: 1,
    goals_against: 3,
    goal_difference: -2,
    points: 0,
    player: { gamer_tag: "ANIFE", users: { display_name: null } },
  },
];

const disciplinary = [
  {
    id: "d1",
    sanction_type: "warning",
    magnitude: 1,
    effective_from: "2026-05-16",
    effective_until: null,
    imposed_at: "2026-05-16T18:00:00Z",
    notes: "late arrival",
    case: { player_id: "p2", season_id: SEASON_ID },
  },
];

function mkSb() {
  const seasonChain = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: season, error: null }),
        })),
      })),
    })),
  };
  const partnersChain = {
    select: vi.fn(() => ({
      is: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: partners, error: null }),
      })),
    })),
  };
  const matchDaysChain = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: matchDays, error: null }),
        })),
      })),
    })),
  };
  const playersChain = {
    select: vi.fn(() => ({
      is: vi.fn().mockResolvedValue({ data: players, error: null }),
    })),
  };
  const matchesChain = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn().mockResolvedValue({ data: matches, error: null }),
      })),
    })),
  };
  const resultsChain = {
    select: vi.fn(() => ({
      is: vi.fn().mockResolvedValue({ data: results, error: null }),
    })),
  };
  const standingsChain = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi
                .fn()
                .mockResolvedValue({ data: standings, error: null }),
            })),
          })),
        })),
      })),
    })),
  };
  const disciplinaryChain = {
    select: vi.fn(() => ({
      is: vi
        .fn()
        .mockResolvedValue({ data: disciplinary, error: null }),
    })),
  };
  return {
    from: vi.fn((t: string) => {
      if (t === "seasons") return seasonChain;
      if (t === "overlay_partner_logos") return partnersChain;
      if (t === "match_days") return matchDaysChain;
      if (t === "players") return playersChain;
      if (t === "matches") return matchesChain;
      if (t === "match_results") return resultsChain;
      if (t === "standings") return standingsChain;
      if (t === "disciplinary_actions") return disciplinaryChain;
      throw new Error(`unexpected from(${t})`);
    }),
  };
}

describe("collectBundleData", () => {
  it("returns organizer + tournament + sponsors + match days", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await collectBundleData(SEASON_ID, mkSb() as any);
    expect(data.meta.organizer).toBe("CADE Esports");
    expect(data.tournament.yearRange).toBe("2025-2026");
    expect(data.tournament.divisionName).toBe("Division 1 Elite");
    expect(data.sponsors).toHaveLength(2);
    expect(data.sponsors[0].partnerKey).toBe("wagyr");
    // display_label null falls back to label
    expect(data.sponsors[1].displayLabel).toBe("Gamepride");
    expect(data.matchDays).toHaveLength(1);
    expect(data.matchDays[0].venueName).toBe("Onile");
  });

  it("joins matchups with player names + result scores", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await collectBundleData(SEASON_ID, mkSb() as any);
    expect(data.matchups).toHaveLength(1);
    const m = data.matchups[0];
    expect(m.homePlayer).toBe("Faruk Doe");
    expect(m.awayPlayer).toBe("ANIFE"); // falls back to gamer_tag
    expect(m.homeScore).toBe(3);
    expect(m.awayScore).toBe(1);
    expect(m.matchDate).toBe("2026-05-16");
  });

  it("builds leaderboard rows in standings order", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await collectBundleData(SEASON_ID, mkSb() as any);
    expect(data.leaderboard).toHaveLength(2);
    expect(data.leaderboard[0].pos).toBe(1);
    expect(data.leaderboard[0].player).toBe("Faruk Doe");
    expect(data.leaderboard[0].pts).toBe(3);
    expect(data.leaderboard[0].form).toBe("W");
  });

  it("captures disciplinary rows with player name resolved", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await collectBundleData(SEASON_ID, mkSb() as any);
    expect(data.disciplinary).toHaveLength(1);
    expect(data.disciplinary[0].player).toBe("ANIFE");
    expect(data.disciplinary[0].sanctionType).toBe("warning");
  });
});

describe("buildBundleWorkbook", () => {
  const fakeData: BundleData = {
    meta: {
      organizer: "CADE Esports",
      league: "CADE League",
      product: "GameEvo",
      generatedAt: "2026-05-27T10:00:00Z",
      seasonId: SEASON_ID,
      warnings: [],
    },
    tournament: {
      seasonId: SEASON_ID,
      yearRange: "2025-2026",
      divisionName: "Division 1 Elite",
      startDate: "2025-09-01",
      endDate: "2026-06-30",
      status: "active",
    },
    sponsors: [
      {
        partnerKey: "wagyr",
        label: "Wagyr",
        displayLabel: "Wagyr",
        alt: "Wagyr",
        fileUrl: "/x.png",
        sortOrder: 0,
      },
    ],
    matchDays: [
      {
        id: "md-1",
        matchDate: "2026-05-16",
        arrivalCutoffTime: "16:00:00",
        matchStartTime: "17:00:00",
        venueName: "Onile",
        status: "scheduled",
        notes: null,
      },
    ],
    players: [{ id: "p1", name: "Faruk" }],
    matchups: [
      {
        matchId: "m1",
        matchDayId: "md-1",
        matchDate: "2026-05-16",
        scheduledTime: "17:00:00",
        matchSlot: 1,
        matchLane: 1,
        homePlayer: "Faruk",
        awayPlayer: "Anife",
        status: "completed",
        homeScore: 3,
        awayScore: 1,
        resultType: "normal",
        isWalkover: false,
        confirmedAt: "2026-05-16T18:00:00Z",
      },
    ],
    leaderboard: [
      {
        pos: 1,
        playerId: "p1",
        player: "Faruk",
        p: 1,
        w: 1,
        d: 0,
        l: 0,
        gf: 3,
        ga: 1,
        gd: 2,
        pts: 3,
        form: "W",
      },
    ],
    walkovers: [],
    disciplinary: [],
  };

  it("emits eight named sheets", () => {
    const wb = buildBundleWorkbook(fakeData);
    expect(wb.SheetNames).toEqual([
      "Tournament",
      "Sponsors",
      "Match Days",
      "Players",
      "Matchups",
      "Leaderboard",
      "Walkovers",
      "Disciplinary",
    ]);
  });

  it("Tournament sheet carries organizer + dates", () => {
    const wb = buildBundleWorkbook(fakeData);
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Tournament, {
      header: 1,
    });
    const flat = aoa.flat();
    expect(flat).toContain("CADE Esports");
    expect(flat).toContain("2025-2026");
    expect(flat).toContain("Division 1 Elite");
  });
});
