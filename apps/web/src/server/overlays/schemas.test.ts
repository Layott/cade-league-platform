import { describe, it, expect } from "vitest";
import {
  scorebarSchema,
  lowerThirdSchema,
  standingsWidgetSchema,
  playerCardSchema,
  punishmentTickerSchema,
  introSchema,
  outroSchema,
  // Plan 16
  soundSlotSchema,
  stingerIntroSchema,
  stingerNormalSchema,
  stingerGoalSchema,
  stingerWinnerSchema,
  layout4PipSchema,
  layout2PipSchema,
  layoutBrbFullSchema,
  layoutBrbBasicSchema,
  layoutTimerSchema,
  layoutAnimatedBgSchema,
  layoutCastersChatSchema,
  h2h2Schema,
  h2h3Schema,
  h2h5Schema,
  leaderboardAnimatedSchema,
  scoreBugSchema,
  upNextBugSchema,
  matchScoresDaySchema,
  startingSoonBasicSchema,
  startingSoonTimerSchema,
  streamEndedSchema,
  topScorersSchema,
  orgsRosterSchema,
  coachIntrosSchema,
  playerPenaltiesSchema,
} from "./schemas";

describe("overlay payload schemas", () => {
  it("scorebar round-trip: names + integer scores 0-99", () => {
    const parsed = scorebarSchema.parse({
      homeName: "Anon-01",
      awayName: "Anon-02",
      homeScore: 3,
      awayScore: 1,
    });
    expect(parsed).toMatchObject({ homeScore: 3, awayScore: 1 });
  });

  it("scorebar rejects negative score", () => {
    expect(() =>
      scorebarSchema.parse({
        homeName: "a",
        awayName: "b",
        homeScore: -1,
        awayScore: 0,
      }),
    ).toThrow();
  });

  it("lower_third stats optional but valid when present", () => {
    const p = lowerThirdSchema.parse({
      playerId: "11111111-1111-4111-8111-111111111111",
      displayName: "Dapo",
      gamerTag: "DAPO_10",
      jerseyNumber: 10,
      stats: { gp: 5, w: 3, d: 1, l: 1, pts: 10 },
    });
    expect(p.stats?.pts).toBe(10);
  });

  it("standings_widget rows required non-empty, max 20", () => {
    expect(() =>
      standingsWidgetSchema.parse({ topN: 3, rows: [] }),
    ).toThrow();
    const rows = Array.from({ length: 20 }, (_, i) => ({
      rank: i + 1,
      displayName: `P${i}`,
      pts: 0,
      gd: 0,
    }));
    const ok = standingsWidgetSchema.parse({ topN: 20, rows });
    expect(ok.rows.length).toBe(20);
  });

  it("player_card accepts no photoUrl", () => {
    const p = playerCardSchema.parse({
      playerId: "11111111-1111-4111-8111-111111111111",
      displayName: "Dapo",
      gamerTag: "DAPO_10",
      seasonStats: { gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
    });
    expect(p.photoUrl).toBeUndefined();
  });

  it("punishment_ticker items min 1", () => {
    expect(() =>
      punishmentTickerSchema.parse({ items: [] }),
    ).toThrow();
    const ok = punishmentTickerSchema.parse({
      items: [
        {
          playerName: "Dapo",
          sanction: "warning",
          magnitude: "-1 pt",
          issuedAt: "2026-04-20",
        },
      ],
    });
    expect(ok.items.length).toBe(1);
  });

  it("intro requires both labels", () => {
    expect(() => introSchema.parse({ matchDayLabel: "MD 1" })).toThrow();
    expect(
      introSchema.parse({
        matchDayLabel: "MD 1",
        seasonLabel: "Elite 25/26",
      }),
    ).toMatchObject({ matchDayLabel: "MD 1" });
  });

  it("outro footer optional", () => {
    const p = outroSchema.parse({ matchDayLabel: "MD 1" });
    expect(p.footer).toBeUndefined();
  });
});

describe("Plan 16 — soundSlot field", () => {
  it("accepts known slots + null + undefined", () => {
    expect(soundSlotSchema.parse("stinger-goal")).toBe("stinger-goal");
    expect(soundSlotSchema.parse(null)).toBeNull();
    expect(soundSlotSchema.parse(undefined)).toBeUndefined();
  });

  it("rejects unknown slot strings", () => {
    expect(() => soundSlotSchema.parse("not-a-real-slot")).toThrow();
  });

  it("stinger_normal payload may be empty ({})", () => {
    expect(stingerNormalSchema.parse({})).toEqual({});
    expect(stingerNormalSchema.parse({ soundSlot: "stinger-normal" })).toEqual({
      soundSlot: "stinger-normal",
    });
  });

  it("stinger_intro requires seasonLabel", () => {
    expect(() => stingerIntroSchema.parse({})).toThrow();
    const p = stingerIntroSchema.parse({ seasonLabel: "Elite 25/26" });
    expect(p.seasonLabel).toBe("Elite 25/26");
  });

  it("stinger_goal allows all optional fields absent", () => {
    const p = stingerGoalSchema.parse({});
    expect(p.scorerDisplayName).toBeUndefined();
  });

  it("stinger_winner requires winnerDisplayName", () => {
    expect(() => stingerWinnerSchema.parse({})).toThrow();
    const p = stingerWinnerSchema.parse({ winnerDisplayName: "DAPO" });
    expect(p.winnerDisplayName).toBe("DAPO");
  });
});

describe("Plan 16 — layout schemas", () => {
  it("layout_4pip enforces exactly 4 cells", () => {
    expect(() =>
      layout4PipSchema.parse({
        cells: [{ displayName: "A" }, { displayName: "B" }],
      }),
    ).toThrow();
    const p = layout4PipSchema.parse({
      cells: [
        { displayName: "A" },
        { displayName: "B" },
        { displayName: "C" },
        { displayName: "D" },
      ],
    });
    expect(p.cells.length).toBe(4);
  });

  it("layout_2pip enforces exactly 2 cells", () => {
    expect(() =>
      layout2PipSchema.parse({ cells: [{ displayName: "A" }] }),
    ).toThrow();
  });

  it("layout_brb_full accepts all optional fields", () => {
    const p = layoutBrbFullSchema.parse({});
    expect(p.adVideoUrl).toBeUndefined();
  });

  it("layout_brb_basic defaults message to nothing", () => {
    const p = layoutBrbBasicSchema.parse({});
    expect(p.message).toBeUndefined();
  });

  it("layout_timer requires ISO expiresAt", () => {
    expect(() => layoutTimerSchema.parse({ expiresAt: "tomorrow" })).toThrow();
    const p = layoutTimerSchema.parse({ expiresAt: "2026-04-25T12:00:00Z" });
    expect(p.expiresAt).toBe("2026-04-25T12:00:00Z");
  });

  it("layout_animated_bg allows intensity override", () => {
    const p = layoutAnimatedBgSchema.parse({ intensity: "high" });
    expect(p.intensity).toBe("high");
  });

  it("layout_casters_chat defaults chat to []", () => {
    const p = layoutCastersChatSchema.parse({});
    expect(p.chat).toEqual([]);
  });
});

describe("Plan 16 — matchup h2h schemas", () => {
  it("h2h_2 enforces length 2", () => {
    expect(() =>
      h2h2Schema.parse({ players: [{ displayName: "A" }] }),
    ).toThrow();
    const p = h2h2Schema.parse({
      players: [{ displayName: "A" }, { displayName: "B" }],
    });
    expect(p.players.length).toBe(2);
  });

  it("h2h_3 enforces length 3", () => {
    expect(() =>
      h2h3Schema.parse({ players: [{ displayName: "A" }] }),
    ).toThrow();
  });

  it("h2h_5 accepts 3..5 players (collapsible)", () => {
    const p = h2h5Schema.parse({
      players: [
        { displayName: "A" },
        { displayName: "B" },
        { displayName: "C" },
      ],
    });
    expect(p.players.length).toBe(3);
    expect(() => h2h5Schema.parse({ players: [{ displayName: "A" }] })).toThrow();
  });
});

describe("Plan 16 — data display schemas", () => {
  it("leaderboard_animated supports rank delta", () => {
    const p = leaderboardAnimatedSchema.parse({
      topN: 3,
      rows: [
        { rank: 1, displayName: "A", pts: 9, gd: 4, delta: 1 },
        { rank: 2, displayName: "B", pts: 6, gd: 2, delta: -1 },
        { rank: 3, displayName: "C", pts: 3, gd: 0 },
      ],
    });
    expect(p.rows[0].delta).toBe(1);
  });

  it("score_bug requires exactly 2 players", () => {
    expect(() =>
      scoreBugSchema.parse({ players: [{ displayName: "A", score: 0 }] }),
    ).toThrow();
  });

  it("up_next_bug requires ISO kickoffAt", () => {
    const p = upNextBugSchema.parse({
      home: { displayName: "A" },
      away: { displayName: "B" },
      kickoffAt: "2026-04-25T12:00:00Z",
    });
    expect(p.kickoffAt).toBe("2026-04-25T12:00:00Z");
  });

  it("match_scores_day defaults rows to []", () => {
    const p = matchScoresDaySchema.parse({ matchDayLabel: "MD 1" });
    expect(p.rows).toEqual([]);
  });
});

describe("Plan 16 — full-screen + stats schemas", () => {
  it("starting_soon_basic subtitle optional", () => {
    expect(startingSoonBasicSchema.parse({})).toEqual({});
  });

  it("starting_soon_timer requires startsAt", () => {
    expect(() => startingSoonTimerSchema.parse({})).toThrow();
  });

  it("stream_ended socials optional", () => {
    expect(streamEndedSchema.parse({})).toEqual({});
  });

  it("top_scorers caps at 10 rows", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      rank: i + 1,
      displayName: `P${i}`,
      goals: i,
    }));
    expect(() => topScorersSchema.parse({ rows })).toThrow();
  });

  it("orgs_roster requires org.name", () => {
    expect(() => orgsRosterSchema.parse({ org: {} })).toThrow();
    const p = orgsRosterSchema.parse({ org: { name: "Cade Esports" } });
    expect(p.org.name).toBe("Cade Esports");
  });

  it("coach_intros accepts minimal coach-only payload", () => {
    const p = coachIntrosSchema.parse({ coach: { displayName: "Coach K" } });
    expect(p.players).toEqual([]);
  });

  it("player_penalties restricts sanctionType enum", () => {
    expect(() =>
      playerPenaltiesSchema.parse({
        rows: [{ displayName: "A", count: 1, sanctionType: "invalid" }],
      }),
    ).toThrow();
    const p = playerPenaltiesSchema.parse({
      rows: [{ displayName: "A", count: 1, sanctionType: "fine" }],
    });
    expect(p.rows[0].sanctionType).toBe("fine");
  });
});
