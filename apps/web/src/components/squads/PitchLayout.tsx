"use client";

import { FutCard } from "./FutCard";
import type { CardSearchResult } from "@/server/fcdb/search";

/**
 * Plan 30 (expanded) — SVG-free pitch layout.
 *
 * Formations are keyed by position-strings (`GK`, `RB`, `CB`, …) so a
 * stable slotIndex (0-10) maps to each formation's lineup role. The
 * absolute-position coordinates are percentages of the pitch area
 * (top=0 is opponent goal; bottom=100 is own goal).
 *
 * Switching formation preserves filled slots whose slotIndex exists in the
 * new formation AND whose position label matches. Slots that don't carry
 * over are cleared silently (the page has no toast machinery yet).
 *
 * 20 formations modelled after the FC/EAFC catalog, grouped here by
 * defender count so the dropdown can present them as back-three / back-four
 * / back-five sections.
 */

export type FormationKey =
  // Back-four
  | "433"
  | "442"
  | "4231"
  | "4141"
  | "41212"
  | "4222"
  | "424"
  | "4312"
  | "4321"
  | "4411"
  | "451"
  // Back-three
  | "352"
  | "343"
  | "3412"
  | "3511"
  | "3421"
  | "3142"
  // Back-five
  | "532"
  | "5212"
  | "541"
  | "523";

export type SlotPosition = {
  slotIndex: number;
  label: string; // ST, LM, etc.
  top: number; // 0-100
  left: number; // 0-100
};

// 0-based slotIndex mapping. GK = 0 always; defenders cluster at the back
// (top ~70-92), midfielders in the middle band (top ~32-58), attackers up
// top (top ~10-24). Shape-per-formation below; every entry has 11 slots,
// every slot has a non-empty label, and every (top,left) pair is unique
// within that formation (asserted by the unit tests).
const FORMATIONS: Record<FormationKey, SlotPosition[]> = {
  // ─── BACK-FOUR ─────────────────────────────────────────────────────────
  "433": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "CM", top: 48, left: 22 },
    { slotIndex: 6, label: "CM", top: 52, left: 50 },
    { slotIndex: 7, label: "CM", top: 48, left: 78 },
    { slotIndex: 8, label: "LW", top: 20, left: 16 },
    { slotIndex: 9, label: "ST", top: 14, left: 50 },
    { slotIndex: 10, label: "RW", top: 20, left: 84 },
  ],
  "442": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "LM", top: 48, left: 12 },
    { slotIndex: 6, label: "CM", top: 50, left: 36 },
    { slotIndex: 7, label: "CM", top: 50, left: 64 },
    { slotIndex: 8, label: "RM", top: 48, left: 88 },
    { slotIndex: 9, label: "ST", top: 16, left: 36 },
    { slotIndex: 10, label: "ST", top: 16, left: 64 },
  ],
  "4231": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "CDM", top: 56, left: 36 },
    { slotIndex: 6, label: "CDM", top: 56, left: 64 },
    { slotIndex: 7, label: "LM", top: 32, left: 14 },
    { slotIndex: 8, label: "CAM", top: 32, left: 50 },
    { slotIndex: 9, label: "RM", top: 32, left: 86 },
    { slotIndex: 10, label: "ST", top: 14, left: 50 },
  ],
  // 4-1-4-1 (balanced, single CDM shield, 4-man mid, lone ST)
  "4141": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "CDM", top: 58, left: 50 },
    { slotIndex: 6, label: "LM", top: 36, left: 12 },
    { slotIndex: 7, label: "CM", top: 38, left: 36 },
    { slotIndex: 8, label: "CM", top: 38, left: 64 },
    { slotIndex: 9, label: "RM", top: 36, left: 88 },
    { slotIndex: 10, label: "ST", top: 14, left: 50 },
  ],
  // 4-1-2-1-2 Narrow (diamond midfield)
  "41212": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "CDM", top: 58, left: 50 },
    { slotIndex: 6, label: "CM", top: 44, left: 28 },
    { slotIndex: 7, label: "CM", top: 44, left: 72 },
    { slotIndex: 8, label: "CAM", top: 28, left: 50 },
    { slotIndex: 9, label: "ST", top: 14, left: 38 },
    { slotIndex: 10, label: "ST", top: 14, left: 62 },
  ],
  // 4-2-2-2 (box midfield, two strikers)
  "4222": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "CDM", top: 56, left: 34 },
    { slotIndex: 6, label: "CDM", top: 56, left: 66 },
    { slotIndex: 7, label: "CAM", top: 30, left: 30 },
    { slotIndex: 8, label: "CAM", top: 30, left: 70 },
    { slotIndex: 9, label: "ST", top: 14, left: 38 },
    { slotIndex: 10, label: "ST", top: 14, left: 62 },
  ],
  // 4-2-4 (wide, attacking; two CMs behind four attackers)
  "424": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "CM", top: 50, left: 36 },
    { slotIndex: 6, label: "CM", top: 50, left: 64 },
    { slotIndex: 7, label: "LW", top: 22, left: 14 },
    { slotIndex: 8, label: "ST", top: 14, left: 38 },
    { slotIndex: 9, label: "ST", top: 14, left: 62 },
    { slotIndex: 10, label: "RW", top: 22, left: 86 },
  ],
  // 4-3-1-2 (flat 3 CMs, a CAM, two STs)
  "4312": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "CM", top: 52, left: 22 },
    { slotIndex: 6, label: "CM", top: 54, left: 50 },
    { slotIndex: 7, label: "CM", top: 52, left: 78 },
    { slotIndex: 8, label: "CAM", top: 30, left: 50 },
    { slotIndex: 9, label: "ST", top: 14, left: 38 },
    { slotIndex: 10, label: "ST", top: 14, left: 62 },
  ],
  // 4-3-2-1 "Christmas tree" (3 CMs, 2 CAMs, lone ST)
  "4321": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "CM", top: 54, left: 22 },
    { slotIndex: 6, label: "CM", top: 56, left: 50 },
    { slotIndex: 7, label: "CM", top: 54, left: 78 },
    { slotIndex: 8, label: "CAM", top: 30, left: 34 },
    { slotIndex: 9, label: "CAM", top: 30, left: 66 },
    { slotIndex: 10, label: "ST", top: 12, left: 50 },
  ],
  // 4-4-1-1 (flat 4-mid with CAM sitting off the ST)
  "4411": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "LM", top: 48, left: 12 },
    { slotIndex: 6, label: "CM", top: 50, left: 36 },
    { slotIndex: 7, label: "CM", top: 50, left: 64 },
    { slotIndex: 8, label: "RM", top: 48, left: 88 },
    { slotIndex: 9, label: "CAM", top: 28, left: 50 },
    { slotIndex: 10, label: "ST", top: 12, left: 50 },
  ],
  // 4-5-1 (attacking variant — wide mids push up alongside a CAM)
  "451": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "LM", top: 40, left: 12 },
    { slotIndex: 6, label: "CM", top: 52, left: 34 },
    { slotIndex: 7, label: "CM", top: 52, left: 66 },
    { slotIndex: 8, label: "RM", top: 40, left: 88 },
    { slotIndex: 9, label: "CAM", top: 28, left: 50 },
    { slotIndex: 10, label: "ST", top: 12, left: 50 },
  ],

  // ─── BACK-THREE ────────────────────────────────────────────────────────
  "352": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 74, left: 22 },
    { slotIndex: 2, label: "CB", top: 76, left: 50 },
    { slotIndex: 3, label: "CB", top: 74, left: 78 },
    { slotIndex: 4, label: "LM", top: 46, left: 10 },
    { slotIndex: 5, label: "CM", top: 52, left: 30 },
    { slotIndex: 6, label: "CM", top: 54, left: 50 },
    { slotIndex: 7, label: "CM", top: 52, left: 70 },
    { slotIndex: 8, label: "RM", top: 46, left: 90 },
    { slotIndex: 9, label: "ST", top: 18, left: 36 },
    { slotIndex: 10, label: "ST", top: 18, left: 64 },
  ],
  // 3-4-3 (wing-backs + front three)
  "343": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 74, left: 22 },
    { slotIndex: 2, label: "CB", top: 76, left: 50 },
    { slotIndex: 3, label: "CB", top: 74, left: 78 },
    { slotIndex: 4, label: "LM", top: 46, left: 10 },
    { slotIndex: 5, label: "CM", top: 50, left: 36 },
    { slotIndex: 6, label: "CM", top: 50, left: 64 },
    { slotIndex: 7, label: "RM", top: 46, left: 90 },
    { slotIndex: 8, label: "LW", top: 20, left: 16 },
    { slotIndex: 9, label: "ST", top: 14, left: 50 },
    { slotIndex: 10, label: "RW", top: 20, left: 84 },
  ],
  // 3-4-1-2 (wing-back 4-mid, CAM, two STs)
  "3412": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 74, left: 22 },
    { slotIndex: 2, label: "CB", top: 76, left: 50 },
    { slotIndex: 3, label: "CB", top: 74, left: 78 },
    { slotIndex: 4, label: "LM", top: 48, left: 10 },
    { slotIndex: 5, label: "CM", top: 52, left: 36 },
    { slotIndex: 6, label: "CM", top: 52, left: 64 },
    { slotIndex: 7, label: "RM", top: 48, left: 90 },
    { slotIndex: 8, label: "CAM", top: 30, left: 50 },
    { slotIndex: 9, label: "ST", top: 14, left: 38 },
    { slotIndex: 10, label: "ST", top: 14, left: 62 },
  ],
  // 3-5-1-1 (5-mid, CAM behind ST)
  "3511": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 74, left: 22 },
    { slotIndex: 2, label: "CB", top: 76, left: 50 },
    { slotIndex: 3, label: "CB", top: 74, left: 78 },
    { slotIndex: 4, label: "LM", top: 46, left: 10 },
    { slotIndex: 5, label: "CM", top: 54, left: 30 },
    { slotIndex: 6, label: "CM", top: 56, left: 50 },
    { slotIndex: 7, label: "CM", top: 54, left: 70 },
    { slotIndex: 8, label: "RM", top: 46, left: 90 },
    { slotIndex: 9, label: "CAM", top: 28, left: 50 },
    { slotIndex: 10, label: "ST", top: 12, left: 50 },
  ],
  // 3-4-2-1 (wing-back 4-mid, two CAMs, lone ST)
  "3421": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 74, left: 22 },
    { slotIndex: 2, label: "CB", top: 76, left: 50 },
    { slotIndex: 3, label: "CB", top: 74, left: 78 },
    { slotIndex: 4, label: "LM", top: 48, left: 10 },
    { slotIndex: 5, label: "CM", top: 52, left: 36 },
    { slotIndex: 6, label: "CM", top: 52, left: 64 },
    { slotIndex: 7, label: "RM", top: 48, left: 90 },
    { slotIndex: 8, label: "CAM", top: 28, left: 30 },
    { slotIndex: 9, label: "CAM", top: 28, left: 70 },
    { slotIndex: 10, label: "ST", top: 12, left: 50 },
  ],
  // 3-1-4-2 (CDM anchor, 4 mids, two STs)
  "3142": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 74, left: 22 },
    { slotIndex: 2, label: "CB", top: 76, left: 50 },
    { slotIndex: 3, label: "CB", top: 74, left: 78 },
    { slotIndex: 4, label: "CDM", top: 60, left: 50 },
    { slotIndex: 5, label: "LM", top: 40, left: 12 },
    { slotIndex: 6, label: "CM", top: 42, left: 36 },
    { slotIndex: 7, label: "CM", top: 42, left: 64 },
    { slotIndex: 8, label: "RM", top: 40, left: 88 },
    { slotIndex: 9, label: "ST", top: 14, left: 38 },
    { slotIndex: 10, label: "ST", top: 14, left: 62 },
  ],

  // ─── BACK-FIVE ─────────────────────────────────────────────────────────
  // 5-3-2
  "532": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LWB", top: 66, left: 8 },
    { slotIndex: 2, label: "CB", top: 74, left: 28 },
    { slotIndex: 3, label: "CB", top: 76, left: 50 },
    { slotIndex: 4, label: "CB", top: 74, left: 72 },
    { slotIndex: 5, label: "RWB", top: 66, left: 92 },
    { slotIndex: 6, label: "CM", top: 46, left: 28 },
    { slotIndex: 7, label: "CM", top: 48, left: 50 },
    { slotIndex: 8, label: "CM", top: 46, left: 72 },
    { slotIndex: 9, label: "ST", top: 16, left: 38 },
    { slotIndex: 10, label: "ST", top: 16, left: 62 },
  ],
  // 5-2-1-2 (double-pivot, CAM, two STs)
  "5212": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LWB", top: 66, left: 8 },
    { slotIndex: 2, label: "CB", top: 74, left: 28 },
    { slotIndex: 3, label: "CB", top: 76, left: 50 },
    { slotIndex: 4, label: "CB", top: 74, left: 72 },
    { slotIndex: 5, label: "RWB", top: 66, left: 92 },
    { slotIndex: 6, label: "CDM", top: 52, left: 34 },
    { slotIndex: 7, label: "CDM", top: 52, left: 66 },
    { slotIndex: 8, label: "CAM", top: 30, left: 50 },
    { slotIndex: 9, label: "ST", top: 14, left: 38 },
    { slotIndex: 10, label: "ST", top: 14, left: 62 },
  ],
  // 5-4-1
  "541": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LWB", top: 66, left: 8 },
    { slotIndex: 2, label: "CB", top: 74, left: 28 },
    { slotIndex: 3, label: "CB", top: 76, left: 50 },
    { slotIndex: 4, label: "CB", top: 74, left: 72 },
    { slotIndex: 5, label: "RWB", top: 66, left: 92 },
    { slotIndex: 6, label: "LM", top: 42, left: 14 },
    { slotIndex: 7, label: "CM", top: 44, left: 36 },
    { slotIndex: 8, label: "CM", top: 44, left: 64 },
    { slotIndex: 9, label: "RM", top: 42, left: 86 },
    { slotIndex: 10, label: "ST", top: 14, left: 50 },
  ],
  // 5-2-3 (wing-back + double-pivot + front three)
  "523": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LWB", top: 66, left: 8 },
    { slotIndex: 2, label: "CB", top: 74, left: 28 },
    { slotIndex: 3, label: "CB", top: 76, left: 50 },
    { slotIndex: 4, label: "CB", top: 74, left: 72 },
    { slotIndex: 5, label: "RWB", top: 66, left: 92 },
    { slotIndex: 6, label: "CM", top: 48, left: 36 },
    { slotIndex: 7, label: "CM", top: 48, left: 64 },
    { slotIndex: 8, label: "LW", top: 20, left: 16 },
    { slotIndex: 9, label: "ST", top: 14, left: 50 },
    { slotIndex: 10, label: "RW", top: 20, left: 84 },
  ],
};

// Allowed FC-position codes (used by tests to assert labels are sensible).
export const ALLOWED_POSITIONS = [
  "GK",
  "LB",
  "LWB",
  "CB",
  "RB",
  "RWB",
  "CDM",
  "CM",
  "CAM",
  "LM",
  "LW",
  "RM",
  "RW",
  "LF",
  "RF",
  "ST",
  "CF",
] as const;

export type PositionCode = (typeof ALLOWED_POSITIONS)[number];

export const FORMATION_KEYS: FormationKey[] = [
  "433",
  "442",
  "4231",
  "4141",
  "41212",
  "4222",
  "424",
  "4312",
  "4321",
  "4411",
  "451",
  "352",
  "343",
  "3412",
  "3511",
  "3421",
  "3142",
  "532",
  "5212",
  "541",
  "523",
];

/**
 * Formations grouped by defender count (back-three / back-four / back-five)
 * so the dropdown can render them in a coherent order.
 */
export const FORMATION_GROUPS: {
  label: string;
  defenders: 3 | 4 | 5;
  keys: FormationKey[];
}[] = [
  {
    label: "Back four",
    defenders: 4,
    keys: ["433", "442", "4231", "4141", "41212", "4222", "424", "4312", "4321", "4411", "451"],
  },
  {
    label: "Back three",
    defenders: 3,
    keys: ["352", "343", "3412", "3511", "3421", "3142"],
  },
  {
    label: "Back five",
    defenders: 5,
    keys: ["532", "5212", "541", "523"],
  },
];

export function getFormationSlots(formation: FormationKey): SlotPosition[] {
  return FORMATIONS[formation];
}

const LABELS: Record<FormationKey, string> = {
  "433": "4-3-3",
  "442": "4-4-2",
  "4231": "4-2-3-1",
  "4141": "4-1-4-1",
  "41212": "4-1-2-1-2",
  "4222": "4-2-2-2",
  "424": "4-2-4",
  "4312": "4-3-1-2",
  "4321": "4-3-2-1",
  "4411": "4-4-1-1",
  "451": "4-5-1",
  "352": "3-5-2",
  "343": "3-4-3",
  "3412": "3-4-1-2",
  "3511": "3-5-1-1",
  "3421": "3-4-2-1",
  "3142": "3-1-4-2",
  "532": "5-3-2",
  "5212": "5-2-1-2",
  "541": "5-4-1",
  "523": "5-2-3",
};

export function formationLabel(formation: FormationKey): string {
  return LABELS[formation];
}

export type PitchLayoutProps = {
  formation: FormationKey;
  slots: Record<number, CardSearchResult | null>;
  onSlotClick: (slot: SlotPosition) => void;
  // Drag-to-reorder (optional — omit for read-only uses). Caller lifts
  // the drag state up so drops from the subs bench can also land on the
  // pitch and vice-versa.
  onCardDragStart?: (slotIndex: number) => void;
  onCardDrop?: (slotIndex: number) => void;
  onCardDragEnd?: () => void;
};

export function PitchLayout({ formation, slots, onSlotClick, onCardDragStart, onCardDrop, onCardDragEnd }: PitchLayoutProps) {
  const defs = FORMATIONS[formation];
  return (
    <div
      data-testid="pitch-layout"
      data-formation={formation}
      className="relative mx-auto aspect-[3/4] w-full max-w-[560px] overflow-hidden rounded-sm border border-[var(--ink-4)] bg-gradient-to-b from-[#0d2417] via-[#0a1c12] to-[#081a10]"
    >
      {/* field markings (pure CSS) — CADE pink edge stroke replaces the
           neutral white/15 rules so the pitch reads as brand canvas. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* halfway line */}
        <div className="absolute left-[5%] right-[5%] top-[50%] border-t border-[rgba(254,3,109,0.45)]" />
        {/* center circle */}
        <div className="absolute left-1/2 top-1/2 h-[18%] w-[18%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(254,3,109,0.45)]" />
        {/* penalty boxes */}
        <div className="absolute left-[22%] right-[22%] top-[2%] h-[14%] border-b border-l border-r border-[rgba(254,3,109,0.45)]" />
        <div className="absolute left-[22%] right-[22%] bottom-[2%] h-[14%] border-l border-r border-t border-[rgba(254,3,109,0.45)]" />
      </div>

      {defs.map((s) => {
        const card = slots[s.slotIndex] ?? null;
        const isDraggable = !!card && !!onCardDragStart;
        return (
          <div
            key={s.slotIndex}
            style={{
              top: `${s.top}%`,
              left: `${s.left}%`,
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            draggable={isDraggable}
            onDragStart={
              isDraggable
                ? (e) => {
                    e.dataTransfer.effectAllowed = "move";
                    // Some browsers require setData to start the drag at all.
                    try { e.dataTransfer.setData("text/plain", `slot:${s.slotIndex}`); } catch {}
                    onCardDragStart?.(s.slotIndex);
                  }
                : undefined
            }
            onDragEnd={onCardDragEnd}
            onDragOver={
              onCardDrop
                ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
                : undefined
            }
            onDrop={
              onCardDrop
                ? (e) => { e.preventDefault(); onCardDrop(s.slotIndex); }
                : undefined
            }
            data-slot-droppable={onCardDrop ? s.slotIndex : undefined}
          >
            <div className="flex flex-col items-center gap-0.5">
              <FutCard
                card={card}
                onClick={() => onSlotClick(s)}
                size="sm"
                dataTestId={`pitch-slot-${s.slotIndex}`}
              />
              <span className="rounded-sm bg-black/40 px-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/80">
                {s.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
