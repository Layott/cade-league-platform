import { describe, it, expect, vi } from "vitest";
import { applyReview, rejectReview, ConflictError } from "./review";
import { emptyParsedMatchStats } from "./schemas";

const UUID_S = "11111111-1111-4111-8111-111111111111";
const UUID_HOME = "22222222-2222-4222-8222-222222222222";
const UUID_AWAY = "33333333-3333-4333-8333-333333333333";
const UUID_ACTOR = "44444444-4444-4444-8444-444444444444";

type ScreenshotRow = {
  id: string;
  match_id: string;
  parse_status: string;
  parsed_by_engine: string | null;
};

type ResultRow = {
  home_score: number;
  away_score: number;
  confirmed_at: string | null;
} | null;

function mkSb(opts: {
  screenshot: ScreenshotRow | null;
  matchResult?: ResultRow;
  upsertError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const upsertMock = vi
    .fn()
    .mockResolvedValue({ error: opts.upsertError ?? null });
  const updateEqMock = vi
    .fn()
    .mockResolvedValue({ error: opts.updateError ?? null });
  return {
    upsertMock,
    updateEqMock,
    sb: {
      from: vi.fn((table: string) => {
        if (table === "match_stat_screenshots") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: opts.screenshot,
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: updateEqMock,
            })),
          };
        }
        if (table === "match_results") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: opts.matchResult ?? null,
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }
        if (table === "player_match_stats") {
          return { upsert: upsertMock };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    },
  };
}

function goodInput(overrides: Partial<ReturnType<typeof emptyParsedMatchStats>> = {}) {
  const corrected = { ...emptyParsedMatchStats(), ...overrides };
  corrected.homeScore = corrected.homeScore ?? 2;
  corrected.awayScore = corrected.awayScore ?? 1;
  corrected.homeStats.goals = corrected.homeStats.goals ?? 2;
  corrected.awayStats.goals = corrected.awayStats.goals ?? 1;
  return {
    screenshotId: UUID_S,
    correctedJson: corrected,
    homePlayerId: UUID_HOME,
    awayPlayerId: UUID_AWAY,
  };
}

describe("applyReview — happy path", () => {
  it("upserts two player_match_stats rows and flips screenshot to confirmed", async () => {
    const { sb, upsertMock, updateEqMock } = mkSb({
      screenshot: {
        id: UUID_S,
        match_id: "match-1",
        parse_status: "parsed",
        parsed_by_engine: "claude-opus-4-7",
      },
    });

    const out = await applyReview(
      sb as never,
      UUID_ACTOR,
      goodInput(),
    );

    expect(out.writtenRowCount).toBe(2);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [rows, options] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows[0].player_id).toBe(UUID_HOME);
    expect(rows[1].player_id).toBe(UUID_AWAY);
    expect(options).toEqual({ onConflict: "match_id,player_id" });

    // Screenshot update fired
    expect(updateEqMock).toHaveBeenCalledTimes(1);
  });
});

describe("applyReview — idempotency", () => {
  it("calling twice with same input still writes via upsert (ON CONFLICT)", async () => {
    const { sb, upsertMock } = mkSb({
      screenshot: {
        id: UUID_S,
        match_id: "match-1",
        parse_status: "parsed",
        parsed_by_engine: "claude-opus-4-7",
      },
    });
    await applyReview(sb as never, UUID_ACTOR, goodInput());
    await applyReview(sb as never, UUID_ACTOR, goodInput());
    // Two calls, each with the upsert; DB ensures only one row per (match,player).
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });
});

describe("applyReview — partial correction preserves non-edited fields", () => {
  it("forwards the admin-edited stats block into custom_metrics", async () => {
    const { sb, upsertMock } = mkSb({
      screenshot: {
        id: UUID_S,
        match_id: "m-1",
        parse_status: "parsed",
        parsed_by_engine: "claude-opus-4-7",
      },
    });
    const input = goodInput();
    input.correctedJson.homeStats.passes = 999; // admin edit
    input.correctedJson.homeStats.possessionPct = 51;
    await applyReview(sb as never, UUID_ACTOR, input);

    const [rows] = upsertMock.mock.calls[0];
    expect(rows[0].custom_metrics.passes).toBe(999);
    expect(rows[0].custom_metrics.possessionPct).toBe(51);
    // away side unchanged null
    expect(rows[1].custom_metrics.tackles).toBeNull();
  });
});

describe("applyReview — score contradiction guard", () => {
  it("throws ConflictError when corrected score disagrees with confirmed match_result", async () => {
    const { sb } = mkSb({
      screenshot: {
        id: UUID_S,
        match_id: "m-1",
        parse_status: "parsed",
        parsed_by_engine: "claude-opus-4-7",
      },
      matchResult: {
        home_score: 3,
        away_score: 1,
        confirmed_at: "2026-05-04T12:00:00Z",
      },
    });
    const input = goodInput();
    input.correctedJson.homeScore = 2; // mismatch vs 3
    input.correctedJson.awayScore = 1;
    await expect(
      applyReview(sb as never, UUID_ACTOR, input)
    ).rejects.toThrow(/score_mismatch/);
  });

  it("allows match when corrected score equals confirmed match_result", async () => {
    const { sb, upsertMock } = mkSb({
      screenshot: {
        id: UUID_S,
        match_id: "m-1",
        parse_status: "parsed",
        parsed_by_engine: "claude-opus-4-7",
      },
      matchResult: {
        home_score: 2,
        away_score: 1,
        confirmed_at: "2026-05-04T12:00:00Z",
      },
    });
    await applyReview(sb as never, UUID_ACTOR, goodInput());
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });
});

describe("applyReview — terminal state guard", () => {
  it("rejects when screenshot already confirmed", async () => {
    const { sb } = mkSb({
      screenshot: {
        id: UUID_S,
        match_id: "m-1",
        parse_status: "confirmed",
        parsed_by_engine: "manual",
      },
    });
    await expect(
      applyReview(sb as never, UUID_ACTOR, goodInput())
    ).rejects.toThrow(ConflictError);
  });
});

describe("rejectReview", () => {
  it("requires a reason ≥ 3 chars", async () => {
    const { sb } = mkSb({
      screenshot: {
        id: UUID_S,
        match_id: "m-1",
        parse_status: "parsed",
        parsed_by_engine: "claude-opus-4-7",
      },
    });
    await expect(
      rejectReview(sb as never, UUID_ACTOR, {
        screenshotId: UUID_S,
        reason: "",
      })
    ).rejects.toThrow();
  });

  it("flips screenshot to rejected and stores reason, writes nothing to player_match_stats", async () => {
    const { sb, upsertMock, updateEqMock } = mkSb({
      screenshot: {
        id: UUID_S,
        match_id: "m-1",
        parse_status: "parsed",
        parsed_by_engine: "claude-opus-4-7",
      },
    });
    await rejectReview(sb as never, UUID_ACTOR, {
      screenshotId: UUID_S,
      reason: "blurry crop, unreadable",
    });
    expect(updateEqMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
