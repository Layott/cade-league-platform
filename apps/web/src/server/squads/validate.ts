import type { ItemType } from "./schemas";

/**
 * Plan 10 — pure rule evaluation. No Supabase access; trivially unit-testable.
 *
 * Input shape deliberately lowercased + stable across callers: both the
 * server submit path and the /admin/squads/[id] detail view call this, as
 * does the player-facing /player/squad preview panel.
 */

export type RuleSet = {
  maxBudgetCoins: number;
  minNigerianItems: number;
  bannedItemTypes: readonly string[];
};

export type ItemForValidation = {
  name: string;
  rating: number;
  position: string;
  value: number;
  itemType: ItemType;
  nationalityFlag?: string | null;
  slotIndex: number;
};

export type Violation =
  | {
      code: "budget_exceeded";
      totalValue: number;
      maxBudgetCoins: number;
    }
  | {
      code: "missing_nigerian_items";
      actualCount: number;
      required: number;
    }
  | {
      code: "banned_item_type";
      itemName: string;
      itemType: string;
      slotIndex: number;
    }
  | {
      code: "starting_xi_incomplete";
      filledSlots: number;
      required: 11;
    };

/**
 * Nigerian flag marker. Futbin uses ISO-2 country codes in most exports;
 * the league rulebook's "Nigerian item" requirement covers any flag
 * matching one of these strings (case-insensitive).
 */
const NG_FLAG_VALUES = new Set(["ng", "nga"]);

function isNigerian(flag: string | null | undefined): boolean {
  if (!flag) return false;
  return NG_FLAG_VALUES.has(flag.trim().toLowerCase());
}

export function evaluateRules(
  items: readonly ItemForValidation[],
  rule: RuleSet,
): { ok: boolean; violations: Violation[] } {
  const violations: Violation[] = [];

  // 1. Budget (GK excluded). Convention: slot_index 0 is GK.
  //    Keeping the sum simple in Phase 1B — rule says 10M coins, GK excluded.
  const nonGkValue = items
    .filter((i) => i.slotIndex !== 0)
    .reduce((s, i) => s + (Number.isFinite(i.value) ? i.value : 0), 0);
  if (nonGkValue > rule.maxBudgetCoins) {
    violations.push({
      code: "budget_exceeded",
      totalValue: nonGkValue,
      maxBudgetCoins: rule.maxBudgetCoins,
    });
  }

  // 2. Minimum Nigerian items in starting XI (slot 0..10).
  const startingXi = items.filter((i) => i.slotIndex >= 0 && i.slotIndex <= 10);
  const nigerianCount = startingXi.filter((i) => isNigerian(i.nationalityFlag)).length;
  if (nigerianCount < rule.minNigerianItems) {
    violations.push({
      code: "missing_nigerian_items",
      actualCount: nigerianCount,
      required: rule.minNigerianItems,
    });
  }

  // 3. Banned item types — emits one violation per offending row.
  const banned = new Set(rule.bannedItemTypes.map((t) => t.toLowerCase()));
  for (const it of items) {
    if (banned.has(it.itemType.toLowerCase())) {
      violations.push({
        code: "banned_item_type",
        itemName: it.name,
        itemType: it.itemType,
        slotIndex: it.slotIndex,
      });
    }
  }

  // 4. Starting XI must be 11 filled slots.
  const startingXiCount = startingXi.length;
  if (startingXiCount < 11) {
    violations.push({
      code: "starting_xi_incomplete",
      filledSlots: startingXiCount,
      required: 11,
    });
  }

  return { ok: violations.length === 0, violations };
}
