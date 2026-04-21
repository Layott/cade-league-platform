import { describe, it, expect, vi, beforeEach } from "vitest";
import { upsertRule, getRuleForSeason } from "./rules";

vi.mock("@/lib/perms-db", () => ({
  requirePermAsync: vi.fn(),
  PermissionError: class extends Error {},
}));

import { requirePermAsync } from "@/lib/perms-db";

const UUID_SEASON = "66666666-6666-4666-8666-666666666666";

function mkSb(opts: {
  existing?: unknown | null;
  updatedRow?: unknown;
  insertedRow?: unknown;
}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: opts.existing ?? null, error: null }),
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: opts.updatedRow,
              error: null,
            }),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: opts.insertedRow,
            error: null,
          }),
        })),
      })),
    })),
  };
}

const ACTOR = { userId: "u-adm", roles: ["admin"] };

beforeEach(() => {
  (requirePermAsync as unknown as { mockReset: () => void }).mockReset();
  (requirePermAsync as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
    undefined,
  );
});

describe("upsertRule", () => {
  it("creates a new row when none exists", async () => {
    const sb = mkSb({
      existing: null,
      insertedRow: {
        id: "r-1",
        season_id: UUID_SEASON,
        max_budget_coins: 10_000_000,
        min_nigerian_items: 1,
        banned_item_types: ["evolution"],
        notes: null,
      },
    });
    const row = await upsertRule(sb as never, ACTOR, {
      seasonId: UUID_SEASON,
      maxBudgetCoins: 10_000_000,
      minNigerianItems: 1,
      bannedItemTypes: ["evolution"],
    });
    expect(row.max_budget_coins).toBe(10_000_000);
  });

  it("updates an existing row", async () => {
    const sb = mkSb({
      existing: {
        id: "r-1",
        season_id: UUID_SEASON,
        max_budget_coins: 5_000_000,
        min_nigerian_items: 1,
        banned_item_types: [],
        notes: null,
      },
      updatedRow: {
        id: "r-1",
        season_id: UUID_SEASON,
        max_budget_coins: 12_000_000,
        min_nigerian_items: 1,
        banned_item_types: [],
        notes: null,
      },
    });
    const row = await upsertRule(sb as never, ACTOR, {
      seasonId: UUID_SEASON,
      maxBudgetCoins: 12_000_000,
      minNigerianItems: 1,
      bannedItemTypes: [],
    });
    expect(row.max_budget_coins).toBe(12_000_000);
  });

  it("bubbles permission error when non-admin calls upsert", async () => {
    (requirePermAsync as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
      new Error("missing permission: squads.rules_edit"),
    );
    const sb = mkSb({});
    await expect(
      upsertRule(sb as never, { userId: "u", roles: ["player"] }, {
        seasonId: UUID_SEASON,
        maxBudgetCoins: 1,
        minNigerianItems: 0,
        bannedItemTypes: [],
      }),
    ).rejects.toThrow(/squads.rules_edit/);
  });
});

describe("getRuleForSeason", () => {
  it("returns the row when present", async () => {
    const sb = mkSb({
      existing: {
        id: "r-1",
        season_id: UUID_SEASON,
        max_budget_coins: 1,
        min_nigerian_items: 0,
        banned_item_types: [],
        notes: null,
      },
    });
    const row = await getRuleForSeason(sb as never, UUID_SEASON);
    expect(row?.id).toBe("r-1");
  });
});
