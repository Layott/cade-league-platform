import { describe, it, expect } from "vitest";
import {
  ALLOWED_POSITIONS,
  FORMATION_KEYS,
  FORMATIONS,
  OVERLAY_FORMATIONS,
  getFormationSlots,
  getOverlayFormationSlots,
  type FormationKey,
} from "./formations";

const ALLOWED = new Set<string>(ALLOWED_POSITIONS as unknown as readonly string[]);

// Broadcast 19-player-squads overlay renders 140w x 196h cards on a
// 920x820 pitch (= 15.2% x 23.9% of pitch each). Two cards visually
// overlap iff their centres differ by LESS THAN 15.2% horizontally AND
// LESS THAN 23.9% vertically. dx >= 15.2 OR dy >= 23.9 ⇒ no overlap.
const CARD_W_PCT = 15.2;
const CARD_H_PCT = 23.9;

describe("OVERLAY_FORMATIONS catalog", () => {
  it("covers every FormationKey in FORMATION_KEYS", () => {
    for (const key of FORMATION_KEYS) {
      expect(OVERLAY_FORMATIONS).toHaveProperty(key);
    }
  });

  it.each(FORMATION_KEYS)("%s has exactly 11 slots", (key) => {
    const slots = getOverlayFormationSlots(key as FormationKey);
    expect(slots).toHaveLength(11);
  });

  it.each(FORMATION_KEYS)(
    "%s: every slot label is a valid FC position code",
    (key) => {
      const slots = getOverlayFormationSlots(key as FormationKey);
      for (const s of slots) {
        expect(s.label).toBeTruthy();
        expect(ALLOWED.has(s.label)).toBe(true);
      }
    },
  );

  it.each(FORMATION_KEYS)(
    "%s: slot indexes are 0..10, contiguous and unique",
    (key) => {
      const slots = getOverlayFormationSlots(key as FormationKey);
      const indexes = slots.map((s) => s.slotIndex).sort((a, b) => a - b);
      expect(indexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    },
  );

  it.each(FORMATION_KEYS)(
    "%s: slotIndex 0 is GK at left:50",
    (key) => {
      const slots = getOverlayFormationSlots(key as FormationKey);
      const gk = slots.find((s) => s.slotIndex === 0);
      expect(gk).toBeDefined();
      expect(gk!.label).toBe("GK");
      expect(gk!.left).toBe(50);
    },
  );

  it.each(FORMATION_KEYS)(
    "%s: every (top, left) is in [0, 100]",
    (key) => {
      const slots = getOverlayFormationSlots(key as FormationKey);
      for (const s of slots) {
        expect(s.top).toBeGreaterThanOrEqual(0);
        expect(s.top).toBeLessThanOrEqual(100);
        expect(s.left).toBeGreaterThanOrEqual(0);
        expect(s.left).toBeLessThanOrEqual(100);
      }
    },
  );

  it.each(FORMATION_KEYS)(
    "%s: preserves slot label assignments from FORMATIONS (overlay map only re-positions)",
    (key) => {
      const overlay = getOverlayFormationSlots(key as FormationKey);
      const picker = getFormationSlots(key as FormationKey);
      const overlayByIndex = new Map(overlay.map((s) => [s.slotIndex, s.label]));
      const pickerByIndex = new Map(picker.map((s) => [s.slotIndex, s.label]));
      for (const [idx, label] of pickerByIndex) {
        expect(overlayByIndex.get(idx)).toBe(label);
      }
    },
  );

  // CORE COLLISION TEST — every formation must place 11 cards (140x196
  // on a 920x820 pitch) so that no two cards overlap visually.
  it.each(FORMATION_KEYS)(
    "%s: no two slots produce a 140x196 card collision on a 920x820 pitch",
    (key) => {
      const slots = getOverlayFormationSlots(key as FormationKey);
      const collisions: string[] = [];
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const a = slots[i];
          const b = slots[j];
          const dx = Math.abs(a.left - b.left);
          const dy = Math.abs(a.top - b.top);
          // Overlap iff BOTH dx < cardWidth% AND dy < cardHeight%.
          const overlap = dx < CARD_W_PCT && dy < CARD_H_PCT;
          if (overlap) {
            collisions.push(
              `${key}: slot ${a.slotIndex} (${a.label} @ top:${a.top} left:${a.left}) ` +
                `collides with slot ${b.slotIndex} (${b.label} @ top:${b.top} left:${b.left}) ` +
                `— dx=${dx.toFixed(1)} (need >=${CARD_W_PCT}) dy=${dy.toFixed(1)} (need >=${CARD_H_PCT})`,
            );
          }
        }
      }
      expect(collisions, collisions.join("\n  ")).toEqual([]);
    },
  );

  // Sanity: the OVERLAY_FORMATIONS map must NOT be the same object as
  // FORMATIONS (catches any future refactor that accidentally aliases
  // the overlay map back to the picker map).
  it("OVERLAY_FORMATIONS is a distinct object from FORMATIONS", () => {
    expect(OVERLAY_FORMATIONS).not.toBe(FORMATIONS);
    // And at least one position must differ for at least one formation,
    // proving the map was actually re-tuned.
    let differs = false;
    for (const key of FORMATION_KEYS) {
      const o = OVERLAY_FORMATIONS[key];
      const p = FORMATIONS[key];
      for (let i = 0; i < o.length; i++) {
        if (o[i].top !== p[i].top || o[i].left !== p[i].left) {
          differs = true;
          break;
        }
      }
      if (differs) break;
    }
    expect(differs).toBe(true);
  });
});
