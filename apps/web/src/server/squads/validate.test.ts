import { describe, it, expect } from "vitest";
import { evaluateRules, type ItemForValidation, type RuleSet } from "./validate";

function mkItem(over: Partial<ItemForValidation> = {}): ItemForValidation {
  return {
    name: "Test",
    rating: 80,
    position: "ST",
    value: 100_000,
    itemType: "gold",
    nationalityFlag: "GB",
    slotIndex: 1,
    ...over,
  };
}

function startingXi(flag: string | null = "GB"): ItemForValidation[] {
  return Array.from({ length: 11 }, (_, i) =>
    mkItem({ slotIndex: i, nationalityFlag: flag, name: `XI-${i}` }),
  );
}

const RULE: RuleSet = {
  maxBudgetCoins: 10_000_000,
  minNigerianItems: 1,
  bannedItemTypes: ["evolution", "season_pass", "objective"],
};

describe("evaluateRules", () => {
  it("passes when XI filled, under budget, 1 Nigerian, no banned items", () => {
    const items = startingXi("GB");
    // Replace slot 5 with an NG item.
    items[5] = mkItem({ slotIndex: 5, nationalityFlag: "NG", name: "Okoye" });
    const out = evaluateRules(items, RULE);
    expect(out.ok).toBe(true);
    expect(out.violations).toEqual([]);
  });

  it("flags budget_exceeded when non-GK sum > max", () => {
    const items = startingXi("NG");
    // 10 non-GK items × 2M = 20M, above 10M cap.
    for (let i = 1; i < 11; i++) items[i] = mkItem({ ...items[i], value: 2_000_000 });
    const out = evaluateRules(items, RULE);
    expect(out.ok).toBe(false);
    expect(out.violations.some((v) => v.code === "budget_exceeded")).toBe(true);
  });

  it("excludes GK (slot 0) from budget calculation", () => {
    const items = startingXi("NG");
    // GK is wildly expensive, but remaining 10 sum to well under cap.
    items[0] = mkItem({ slotIndex: 0, value: 50_000_000, name: "GK" });
    for (let i = 1; i < 11; i++) items[i] = mkItem({ ...items[i], value: 500_000 });
    const out = evaluateRules(items, RULE);
    expect(out.violations.find((v) => v.code === "budget_exceeded")).toBeUndefined();
  });

  it("flags missing_nigerian_items when zero Nigerian in XI but 1 required", () => {
    const items = startingXi("GB");
    const out = evaluateRules(items, RULE);
    const v = out.violations.find((x) => x.code === "missing_nigerian_items");
    expect(v).toBeDefined();
    expect(v && (v as { actualCount: number }).actualCount).toBe(0);
  });

  it("flags banned_item_type per offending row", () => {
    const items = startingXi("NG");
    items[3] = mkItem({
      ...items[3],
      itemType: "evolution" as never, // cast: schema rejects at I/O, evaluator is permissive
    });
    const out = evaluateRules(items, {
      ...RULE,
      bannedItemTypes: ["evolution"],
    });
    expect(out.violations.some((v) => v.code === "banned_item_type")).toBe(true);
  });

  it("flags starting_xi_incomplete when fewer than 11 XI slots filled", () => {
    const items: ItemForValidation[] = [
      mkItem({ slotIndex: 0, nationalityFlag: "NG" }),
      mkItem({ slotIndex: 1 }),
      mkItem({ slotIndex: 2 }),
    ];
    const out = evaluateRules(items, RULE);
    expect(out.violations.some((v) => v.code === "starting_xi_incomplete")).toBe(true);
  });

  it("empty items array → multiple violations (XI incomplete + missing Nigerian)", () => {
    const out = evaluateRules([], RULE);
    expect(out.ok).toBe(false);
    expect(out.violations.length).toBeGreaterThanOrEqual(2);
  });

  it("matches case-insensitive 'ng' flag string as Nigerian", () => {
    const items = startingXi("ng");
    const out = evaluateRules(items, RULE);
    expect(out.violations.find((v) => v.code === "missing_nigerian_items")).toBeUndefined();
  });
});
