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
  /** Futbin-internal nation registry ID. When populated (Futbin-sourced
   *  cards, post-scraper patch), takes precedence over `nationalityFlag`
   *  string matching for the Nigerian-count rule — fixes the case where
   *  Futbin rows have empty `nation_iso` + a non-English `nation` field. */
  futbinNationId?: number | null;
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
 * Nigerian flag marker. Accepts either ISO-2/ISO-3 codes ("NG" / "NGA")
 * OR the full country name ("Nigeria") as a fallback, since Futbin's
 * /26/players list doesn't always populate nation_iso — it carries the
 * nation via a CDN icon id in those cases. submit_picker.ts feeds the
 * best-available string (iso ?? nation) into this validator.
 *
 * When a Futbin-internal nation ID is present (captured from the CDN
 * icon URL by the scrapers), it's the authoritative signal — since
 * historical Kaggle rows without ISO codes would otherwise fail the
 * text match. The env-driven constant lets the ID shift across FC
 * years without a code change.
 */
const NG_FLAG_VALUES = new Set(["ng", "nga", "nigeria"]);

/**
 * Futbin's FC26 Nigeria nation_id. Best-guess default is 133 (Nigeria's
 * ID in prior FIFA years — Futbin's internal registry is stable across
 * FIFA 22/23/24, but FC26 may differ). Override via env once confirmed
 * empirically (run KNOWLEDGE/extracted/_find_futbin_nation_id.js after
 * the first post-patch scrape).
 */
export const NG_FUTBIN_NATION_ID: number = (() => {
  const raw = process.env.NG_FUTBIN_NATION_ID;
  if (!raw) return 133;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 133;
})();

function isNigerian(item: Pick<ItemForValidation, "nationalityFlag" | "futbinNationId">): boolean {
  // ID match wins — authoritative when present because the scrapers
  // pull it straight from Futbin's CDN-keyed nation icon.
  if (item.futbinNationId != null && item.futbinNationId === NG_FUTBIN_NATION_ID) {
    return true;
  }
  const flag = item.nationalityFlag;
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

  // 2. Minimum Nigerian items in starting XI (slot 1..10). The goalkeeper
  //    (slot 0) is explicitly excluded from the Nigerian-minimum rule —
  //    same carve-out used for the budget check above.
  const startingXi = items.filter((i) => i.slotIndex >= 0 && i.slotIndex <= 10);
  const nigerianCount = startingXi
    .filter((i) => i.slotIndex !== 0 && isNigerian(i))
    .length;
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
