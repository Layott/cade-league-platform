import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FCPlayerCandidate } from "@/server/fcdb";

// Hoist mocks for findPlayer + perms so the module-under-test sees them at
// import time (lessons.md — vi.mock factories must hoist; use vi.hoisted
// for any shared mock fn references).
const { findPlayerMock, requirePermAsyncMock } = vi.hoisted(() => ({
  findPlayerMock: vi.fn(),
  requirePermAsyncMock: vi.fn(),
}));

vi.mock("@/server/fcdb", async () => {
  const actual = await vi.importActual<typeof import("@/server/fcdb")>(
    "@/server/fcdb",
  );
  return { ...actual, findPlayer: findPlayerMock };
});

vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: requirePermAsyncMock,
  PermissionError: class PermissionError extends Error {},
}));

import { reviewSquadAgainstFCDB, acceptFcdbCandidate } from "./fcdb_review";

function mkCand(over: Partial<FCPlayerCandidate> = {}): FCPlayerCandidate {
  return {
    id: "fc-" + Math.random().toString(36).slice(2, 8),
    source_dataset: "kaggle",
    source_row_id: "1",
    name: "Lionel Messi",
    short_name: "L. Messi",
    slug: "lionel_messi",
    rating: 90,
    position: "RW",
    alt_positions: ["CAM"],
    club: "Inter Miami",
    league: "MLS",
    nation: "Argentina",
    nation_iso: "AR",
    age: 38,
    height_cm: 169,
    weight_kg: 67,
    preferred_foot: "Left",
    weak_foot: 4,
    skill_moves: 4,
    body_type: "Lean",
    work_rate_atk: "Medium",
    work_rate_def: "Low",
    attributes: {},
    item_type: "normal",
    value_coins_estimate: null,
    imported_at: "2026-04-22T00:00:00Z",
    created_at: "2026-04-22T00:00:00Z",
    updated_at: "2026-04-22T00:00:00Z",
    deleted_at: null,
    score: 0,
    ...over,
  };
}

type ItemRow = {
  id: string;
  submission_id: string;
  name: string;
  rating: number;
  position: string;
  value: number;
  item_type: string;
  nationality_flag: string | null;
  slot_index: number;
};

/**
 * Minimal Supabase client mock. The module-under-test uses three tables:
 *   - squad_player_items (select for the submission)
 *   - fc26_players       (select 1 to detect empty FCDB; select id for FK)
 *   - squad_player_items (update for acceptFcdbCandidate)
 * We dispatch on the table name + first-call shape.
 */
function mkSb(opts: {
  items?: ItemRow[];
  itemsErr?: { message: string } | null;
  fcdbCount?: number;             // > 0 → non-empty
  fcdbProbeErr?: { message: string } | null;
  itemById?: ItemRow | null;
  fcPlayerById?: { id: string } | null;
  updateErr?: { message: string } | null;
}) {
  const updateCalls: Array<{ resolved_fc_player_id: string }> = [];
  const sb = {
    updateCalls,
    from: vi.fn((table: string) => {
      if (table === "squad_player_items") {
        return {
          select: vi.fn((cols?: string) => {
            // Single-row "is item live" lookup uses .maybeSingle().
            if (cols && cols.includes("submission_id") && !cols.includes("name")) {
              return {
                eq: vi.fn(() => ({
                  is: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: opts.itemById ?? null,
                      error: null,
                    }),
                  })),
                })),
              };
            }
            // Bulk items load by submission_id.
            return {
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({
                    data: opts.items ?? [],
                    error: opts.itemsErr ?? null,
                  }),
                })),
              })),
            };
          }),
          update: vi.fn((payload: { resolved_fc_player_id: string }) => {
            updateCalls.push(payload);
            return {
              eq: vi.fn().mockResolvedValue({ error: opts.updateErr ?? null }),
            };
          }),
        };
      }
      if (table === "fc26_players") {
        return {
          select: vi.fn((_cols?: string, options?: { count?: string; head?: boolean }) => {
            if (options?.count) {
              // Probe path — head + count.
              return {
                is: vi.fn().mockResolvedValue({
                  count: opts.fcdbCount ?? 0,
                  error: opts.fcdbProbeErr ?? null,
                }),
              };
            }
            // FK validation lookup.
            return {
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: opts.fcPlayerById ?? null,
                    error: null,
                  }),
                })),
              })),
            };
          }),
        };
      }
      throw new Error(`unmocked table: ${table}`);
    }),
  };
  return sb;
}

const ACTOR = { userId: "u-ref", roles: ["referee"] };
const SUB_ID = "sub-1";

function mkItem(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "it-" + Math.random().toString(36).slice(2, 8),
    submission_id: SUB_ID,
    name: "Lionel Messi",
    rating: 90,
    position: "RW",
    value: 1_000_000,
    item_type: "gold",
    nationality_flag: "AR",
    slot_index: 0,
    ...over,
  };
}

describe("reviewSquadAgainstFCDB", () => {
  beforeEach(() => {
    findPlayerMock.mockReset();
    requirePermAsyncMock.mockReset();
  });

  it("flags every row as unknown when FCDB has 0 live rows", async () => {
    const items = [
      mkItem({ id: "i1", slot_index: 0 }),
      mkItem({ id: "i2", slot_index: 1, name: "Erling Haaland" }),
    ];
    const sb = mkSb({ items, fcdbCount: 0 });
    const out = await reviewSquadAgainstFCDB(sb as never, SUB_ID);
    expect(out.summary.fcdbEmpty).toBe(true);
    expect(out.summary.unknown).toBe(2);
    expect(out.summary.resolved).toBe(0);
    expect(out.items).toHaveLength(2);
    expect(out.items[0].status).toBe("unknown");
    expect(out.items[0].reason).toMatch(/FCDB/);
    // findPlayer must NOT be called when FCDB empty (saves N round-trips).
    expect(findPlayerMock).not.toHaveBeenCalled();
  });

  it("classifies a clean single exact-slug + rating-match hit as resolved", async () => {
    const items = [mkItem({ id: "i1", name: "Lionel Messi", rating: 90 })];
    const sb = mkSb({ items, fcdbCount: 17000 });
    findPlayerMock.mockResolvedValueOnce([mkCand({ rating: 90 })]);
    const out = await reviewSquadAgainstFCDB(sb as never, SUB_ID);
    expect(out.items[0].status).toBe("resolved");
    expect(out.items[0].candidate?.slug).toBe("lionel_messi");
    expect(out.items[0].alternatives).toEqual([]);
    expect(out.summary.resolved).toBe(1);
  });

  it("re-classifies multi-hit exact-slug result as ambiguous (vs Plan 21's fuzzy)", async () => {
    const items = [mkItem({ id: "i1", name: "Lionel Messi" })];
    const sb = mkSb({ items, fcdbCount: 17000 });
    findPlayerMock.mockResolvedValueOnce([
      mkCand({ id: "fc-a", rating: 90 }),
      mkCand({ id: "fc-b", rating: 91 }),
      mkCand({ id: "fc-c", rating: 92 }),
    ]);
    const out = await reviewSquadAgainstFCDB(sb as never, SUB_ID);
    expect(out.items[0].status).toBe("ambiguous");
    expect(out.items[0].alternatives).toHaveLength(2);
    expect(out.summary.ambiguous).toBe(1);
  });

  it("classifies trigram-only hit as fuzzy with similarity surfaced", async () => {
    const items = [mkItem({ id: "i1", name: "Lionel Messi" })];
    const sb = mkSb({ items, fcdbCount: 17000 });
    findPlayerMock.mockResolvedValueOnce([
      mkCand({ name: "Lionnel Messi", slug: "lionnel_messi", sim: 0.85 }),
    ]);
    const out = await reviewSquadAgainstFCDB(sb as never, SUB_ID);
    expect(out.items[0].status).toBe("fuzzy");
    expect(out.items[0].similarity).toBeCloseTo(0.85);
  });

  it("classifies single-hit-with-rating-mismatch as fuzzy (not resolved)", async () => {
    const items = [mkItem({ id: "i1", name: "Lionel Messi", rating: 90 })];
    const sb = mkSb({ items, fcdbCount: 17000 });
    // findPlayer's ±1 filter lets 89 through; review.ts demotes to fuzzy.
    findPlayerMock.mockResolvedValueOnce([mkCand({ rating: 89 })]);
    const out = await reviewSquadAgainstFCDB(sb as never, SUB_ID);
    expect(out.items[0].status).toBe("fuzzy");
  });

  it("classifies empty findPlayer result as unknown when FCDB non-empty", async () => {
    const items = [mkItem({ id: "i1", name: "Madeup Person" })];
    const sb = mkSb({ items, fcdbCount: 17000 });
    findPlayerMock.mockResolvedValueOnce([]);
    const out = await reviewSquadAgainstFCDB(sb as never, SUB_ID);
    expect(out.items[0].status).toBe("unknown");
    expect(out.items[0].candidate).toBeUndefined();
    expect(out.summary.unknown).toBe(1);
  });

  it("preserves slot_index ordering across mixed statuses", async () => {
    const items = [
      mkItem({ id: "i1", slot_index: 0, name: "Some Goalkeeper", rating: 88 }),
      mkItem({ id: "i2", slot_index: 1, name: "Halland", rating: 84 }),
      mkItem({ id: "i3", slot_index: 2, name: "Madeup Person" }),
      mkItem({ id: "i4", slot_index: 3, name: "Lionel Messi" }),
    ];
    const sb = mkSb({ items, fcdbCount: 17000 });
    findPlayerMock
      .mockResolvedValueOnce([mkCand({ rating: 88, slug: "some_goalkeeper", name: "Some Goalkeeper" })])
      .mockResolvedValueOnce([mkCand({ id: "fc-x", rating: 84, sim: 0.6, name: "Hally", slug: "hally" })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        mkCand({ id: "fc-m1", rating: 90 }),
        mkCand({ id: "fc-m2", rating: 91 }),
      ]);
    const out = await reviewSquadAgainstFCDB(sb as never, SUB_ID);
    expect(out.items.map((r) => [r.slotIndex, r.status])).toEqual([
      [0, "resolved"],
      [1, "fuzzy"],
      [2, "unknown"],
      [3, "ambiguous"],
    ]);
    expect(out.summary).toEqual({
      total: 4,
      resolved: 1,
      fuzzy: 1,
      ambiguous: 1,
      unknown: 1,
      fcdbEmpty: false,
    });
  });

  it("forwards name + rating + position + club to findPlayer", async () => {
    const items = [
      mkItem({ id: "i1", name: "Some Player", rating: 90, position: "ST" }),
    ];
    const sb = mkSb({ items, fcdbCount: 100 });
    findPlayerMock.mockResolvedValueOnce([]);
    await reviewSquadAgainstFCDB(sb as never, SUB_ID);
    expect(findPlayerMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "Some Player",
        rating: 90,
        position: "ST",
      }),
    );
  });

  it("returns empty result + summary zeros when submission has 0 items", async () => {
    const sb = mkSb({ items: [], fcdbCount: 100 });
    const out = await reviewSquadAgainstFCDB(sb as never, SUB_ID);
    expect(out.items).toEqual([]);
    expect(out.summary.total).toBe(0);
    expect(out.summary.fcdbEmpty).toBe(false);
    expect(findPlayerMock).not.toHaveBeenCalled();
  });

  it("bubbles a hard error from the items load", async () => {
    const sb = mkSb({ items: [], itemsErr: { message: "boom" }, fcdbCount: 1 });
    await expect(reviewSquadAgainstFCDB(sb as never, SUB_ID)).rejects.toThrow(
      /boom/,
    );
  });
});

describe("acceptFcdbCandidate", () => {
  beforeEach(() => {
    findPlayerMock.mockReset();
    requirePermAsyncMock.mockReset();
    requirePermAsyncMock.mockResolvedValue(undefined);
  });

  it("rejects when actor lacks squads.validate", async () => {
    requirePermAsyncMock.mockRejectedValueOnce(
      new Error("missing permission: squads.validate"),
    );
    const sb = mkSb({});
    await expect(
      acceptFcdbCandidate(sb as never, ACTOR, "it-1", "fc-1"),
    ).rejects.toThrow(/squads.validate/);
  });

  it("rejects when squad item is not found / soft-deleted", async () => {
    const sb = mkSb({ itemById: null });
    await expect(
      acceptFcdbCandidate(sb as never, ACTOR, "missing", "fc-1"),
    ).rejects.toThrow(/item not found/i);
  });

  it("rejects when fc26_players candidate is not found / soft-deleted", async () => {
    const sb = mkSb({
      itemById: mkItem({ id: "it-1" }),
      fcPlayerById: null,
    });
    await expect(
      acceptFcdbCandidate(sb as never, ACTOR, "it-1", "fc-missing"),
    ).rejects.toThrow(/fcdb candidate not found/i);
  });

  it("happy path — UPDATE called with resolved_fc_player_id", async () => {
    const sb = mkSb({
      itemById: mkItem({ id: "it-1" }),
      fcPlayerById: { id: "fc-1" },
    });
    await acceptFcdbCandidate(sb as never, ACTOR, "it-1", "fc-1");
    expect(sb.updateCalls).toHaveLength(1);
    expect(sb.updateCalls[0]).toEqual({ resolved_fc_player_id: "fc-1" });
  });

  it("bubbles UPDATE errors", async () => {
    const sb = mkSb({
      itemById: mkItem({ id: "it-1" }),
      fcPlayerById: { id: "fc-1" },
      updateErr: { message: "constraint" },
    });
    await expect(
      acceptFcdbCandidate(sb as never, ACTOR, "it-1", "fc-1"),
    ).rejects.toThrow(/constraint/);
  });
});

