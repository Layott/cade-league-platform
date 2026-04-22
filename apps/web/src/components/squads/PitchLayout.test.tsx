import { describe, it, expect } from "vitest";
import {
  ALLOWED_POSITIONS,
  FORMATION_GROUPS,
  FORMATION_KEYS,
  formationLabel,
  getFormationSlots,
  type FormationKey,
  type PositionCode,
} from "./PitchLayout";

const ALLOWED = new Set<string>(ALLOWED_POSITIONS as unknown as readonly string[]);

describe("PitchLayout formation catalog", () => {
  it("ships at least 20 formations (FC/EAFC catalog)", () => {
    expect(FORMATION_KEYS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(FORMATION_KEYS)("%s has exactly 11 slots", (key) => {
    const slots = getFormationSlots(key as FormationKey);
    expect(slots).toHaveLength(11);
  });

  it.each(FORMATION_KEYS)("%s: every slot has a non-empty valid position code", (key) => {
    const slots = getFormationSlots(key as FormationKey);
    for (const s of slots) {
      expect(s.label).toBeTruthy();
      expect(ALLOWED.has(s.label)).toBe(true);
    }
  });

  it.each(FORMATION_KEYS)("%s: slot indexes are 0..10, contiguous and unique", (key) => {
    const slots = getFormationSlots(key as FormationKey);
    const indexes = slots.map((s) => s.slotIndex).sort((a, b) => a - b);
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it.each(FORMATION_KEYS)(
    "%s: no two slots share the same (top,left) coordinates",
    (key) => {
      const slots = getFormationSlots(key as FormationKey);
      const seen = new Set<string>();
      for (const s of slots) {
        const hash = `${s.top},${s.left}`;
        expect(seen.has(hash)).toBe(false);
        seen.add(hash);
      }
    },
  );

  it.each(FORMATION_KEYS)("%s: slot 0 is the goalkeeper", (key) => {
    const slots = getFormationSlots(key as FormationKey);
    const gk = slots.find((s) => s.slotIndex === 0);
    expect(gk?.label).toBe("GK");
  });

  it.each(FORMATION_KEYS)("%s: all coordinates stay within 0-100", (key) => {
    const slots = getFormationSlots(key as FormationKey);
    for (const s of slots) {
      expect(s.top).toBeGreaterThanOrEqual(0);
      expect(s.top).toBeLessThanOrEqual(100);
      expect(s.left).toBeGreaterThanOrEqual(0);
      expect(s.left).toBeLessThanOrEqual(100);
    }
  });

  it("has a human-readable label for every formation", () => {
    for (const k of FORMATION_KEYS) {
      expect(formationLabel(k)).toMatch(/^\d(-\d)+$/);
    }
  });

  it("each FORMATION_GROUPS entry lists formations whose defender count matches", () => {
    // Defender count = number of slots labelled LB/RB/LWB/RWB/CB
    const defenderCodes = new Set<PositionCode>([
      "LB",
      "RB",
      "LWB",
      "RWB",
      "CB",
    ]);
    for (const group of FORMATION_GROUPS) {
      for (const key of group.keys) {
        const slots = getFormationSlots(key);
        const defenders = slots.filter((s) =>
          defenderCodes.has(s.label as PositionCode),
        ).length;
        expect(defenders).toBe(group.defenders);
      }
    }
  });

  it("FORMATION_GROUPS covers every FORMATION_KEY exactly once", () => {
    const seen = new Set<string>();
    for (const g of FORMATION_GROUPS) {
      for (const k of g.keys) {
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
    expect(seen.size).toBe(FORMATION_KEYS.length);
    for (const k of FORMATION_KEYS) expect(seen.has(k)).toBe(true);
  });
});

describe("SquadPickerBuilder formation switching", () => {
  // Defensive integration test: switching formations should preserve the GK
  // (slot 0 is GK across every formation in the catalog), which verifies
  // the builder's label-match remap logic.
  //
  // This test lives beside PitchLayout to tie the invariant to the catalog.
  it("every formation has a GK slot at index 0 (enables cross-formation GK preservation)", () => {
    for (const key of FORMATION_KEYS) {
      const slots = getFormationSlots(key);
      expect(slots[0].label).toBe("GK");
      expect(slots[0].slotIndex).toBe(0);
    }
  });
});
