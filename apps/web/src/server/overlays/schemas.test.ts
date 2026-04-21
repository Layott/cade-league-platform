import { describe, it, expect } from "vitest";
import {
  scorebarSchema,
  lowerThirdSchema,
  standingsWidgetSchema,
  playerCardSchema,
  punishmentTickerSchema,
  introSchema,
  outroSchema,
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
