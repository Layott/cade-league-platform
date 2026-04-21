import { describe, it, expect } from "vitest";
import {
  parsedMatchStatsSchema,
  parsedStatsBlockSchema,
  reviewInputSchema,
  rejectInputSchema,
  uploadInputSchema,
  emptyParsedMatchStats,
} from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

describe("parsedStatsBlockSchema", () => {
  it("accepts a full block with valid integers", () => {
    const ok = parsedStatsBlockSchema.parse({
      possessionPct: 54,
      shots: 11,
      shotsOnTarget: 7,
      passes: 412,
      passAccuracyPct: 89,
      tackles: 9,
      interceptions: 5,
      fouls: 4,
      ballRecoveries: 22,
      goals: 3,
      assists: 1,
    });
    expect(ok.possessionPct).toBe(54);
    expect(ok.goals).toBe(3);
  });

  it("survives all-null values (unreadable screenshot)", () => {
    const parsed = parsedStatsBlockSchema.parse({
      possessionPct: null,
      shots: null,
      shotsOnTarget: null,
      passes: null,
      passAccuracyPct: null,
      tackles: null,
      interceptions: null,
      fouls: null,
      ballRecoveries: null,
      goals: null,
      assists: null,
    });
    expect(parsed.possessionPct).toBeNull();
    expect(parsed.assists).toBeNull();
  });

  it("rejects possessionPct > 100", () => {
    const base = parsedStatsBlockSchema.parse({
      possessionPct: 0,
      shots: null,
      shotsOnTarget: null,
      passes: null,
      passAccuracyPct: null,
      tackles: null,
      interceptions: null,
      fouls: null,
      ballRecoveries: null,
      goals: null,
      assists: null,
    });
    const bad = { ...base, possessionPct: 150 };
    expect(() => parsedStatsBlockSchema.parse(bad)).toThrow();
  });

  it("rejects passAccuracyPct = -1", () => {
    const base = parsedStatsBlockSchema.parse({
      possessionPct: null,
      shots: null,
      shotsOnTarget: null,
      passes: null,
      passAccuracyPct: 50,
      tackles: null,
      interceptions: null,
      fouls: null,
      ballRecoveries: null,
      goals: null,
      assists: null,
    });
    const bad = { ...base, passAccuracyPct: -1 };
    expect(() => parsedStatsBlockSchema.parse(bad)).toThrow();
  });
});

describe("parsedMatchStatsSchema", () => {
  it("round-trips an empty default value", () => {
    const empty = emptyParsedMatchStats();
    const parsed = parsedMatchStatsSchema.parse(empty);
    expect(parsed).toEqual(empty);
  });

  it("defaults sourceNotes to empty string", () => {
    const parsed = parsedMatchStatsSchema.parse({
      homePlayerDisplayName: "A",
      awayPlayerDisplayName: "B",
      homeScore: 1,
      awayScore: 0,
      homeStats: emptyParsedMatchStats().homeStats,
      awayStats: emptyParsedMatchStats().awayStats,
    });
    expect(parsed.sourceNotes).toBe("");
  });
});

describe("uploadInputSchema", () => {
  it("rejects files over 10MB", () => {
    expect(() =>
      uploadInputSchema.parse({
        matchId: UUID_A,
        storagePath: "matches/x/y.png",
        fileSizeBytes: 11 * 1024 * 1024,
        mimeType: "image/png",
      })
    ).toThrow();
  });

  it("rejects unknown mime type", () => {
    expect(() =>
      uploadInputSchema.parse({
        matchId: UUID_A,
        storagePath: "matches/x/y.gif",
        fileSizeBytes: 100,
        mimeType: "image/gif",
      })
    ).toThrow();
  });
});

describe("reviewInputSchema", () => {
  it("accepts well-formed input", () => {
    const parsed = reviewInputSchema.parse({
      screenshotId: UUID_A,
      correctedJson: emptyParsedMatchStats(),
      homePlayerId: UUID_B,
      awayPlayerId: UUID_C,
    });
    expect(parsed.screenshotId).toBe(UUID_A);
  });
});

describe("rejectInputSchema", () => {
  it("requires reason ≥ 3 chars", () => {
    expect(() =>
      rejectInputSchema.parse({ screenshotId: UUID_A, reason: "" })
    ).toThrow();
  });

  it("accepts a valid reason", () => {
    const parsed = rejectInputSchema.parse({
      screenshotId: UUID_A,
      reason: "blurry crop",
    });
    expect(parsed.reason).toBe("blurry crop");
  });
});
