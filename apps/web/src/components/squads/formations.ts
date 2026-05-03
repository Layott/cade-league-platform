/**
 * Pure formation data + helpers, no "use client". Imported by
 * PitchLayout (client) AND by Server Components (page.tsx, broadcast endpoints).
 * Bug fix 2026-05-02: previously co-located in PitchLayout.tsx which carries
 * 'use client'; importing FORMATION_KEYS / getFormationSlots into a Server
 * Component left them as client references — runtime threw
 * 'TypeError: q.FORMATION_KEYS' on /player/squad?...&edit=1.
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
export const FORMATIONS: Record<FormationKey, SlotPosition[]> = {
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
  // 4-5-1 (Bug 10 fix 2026-05-01 — true 5-man midfield, no CAM, no
  // shape collision with 4-4-1-1).
  "451": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 72, left: 12 },
    { slotIndex: 2, label: "CB", top: 74, left: 34 },
    { slotIndex: 3, label: "CB", top: 74, left: 66 },
    { slotIndex: 4, label: "RB", top: 72, left: 88 },
    { slotIndex: 5, label: "LM", top: 44, left: 10 },
    { slotIndex: 6, label: "CM", top: 48, left: 30 },
    { slotIndex: 7, label: "CM", top: 50, left: 50 },
    { slotIndex: 8, label: "CM", top: 48, left: 70 },
    { slotIndex: 9, label: "RM", top: 44, left: 90 },
    { slotIndex: 10, label: "ST", top: 14, left: 50 },
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

// ─── BROADCAST OVERLAY FORMATIONS (19-player-squads) ──────────────────
//
// `FORMATIONS` is tuned for the /player/squad picker, which renders
// smaller cards inside an aspect-3/4 panel — its tight slot coordinates
// (e.g. CAM at top:28 stacked under ST at top:12 in 4-4-1-1) work because
// picker cards are visually small. The broadcast overlay
// `/overlay/v2/19-player-squads` renders 140w x 196h cards on a 920x820
// pitch (= 15.2% x 23.9% of pitch each), so any two slots whose centres
// differ by less than 15.2% horizontally AND less than 23.9% vertically
// produce visually overlapping cards.
//
// `OVERLAY_FORMATIONS` is a parallel slot map with widened gaps tuned
// for the broadcast card size. Same shape (FormationKey → 11 slots
// each `{slotIndex,label,top,left}` with identical slotIndex + label
// assignments). Tests in `formations.overlay.test.ts` assert that every
// pair of slots in every formation satisfies dx >= 15.2 OR dy >= 23.9.
//
// Spacing rules baked in:
//   * GK at (92,50) — anchor.
//   * Back-four: defenders at top:80 left:8/32/68/92 (no slot at 50).
//   * Back-three: side CBs at top:78, central CB pulled FORWARD to
//     top:68 left:50 so dy(GK 92, CB-mid 68) = 24 — preserves the
//     "back-three" silhouette without overlapping the GK card.
//   * Back-five: wing-backs at top:66 left:8/92, side CBs at top:78
//     left:28/72, central CB at top:68 left:50 (same forward-pull trick
//     as back-three).
//   * Stacked rows on a shared column maintain dy >= 24 (one card-height
//     plus margin).
//   * Stacked slots on a shared row maintain dx >= 17 between centres.
//   * 3-5-1-1 specifically must move CAM off column 50 (4 stacked tiers
//     above the central CB don't fit even with the forward-pull) — CAM
//     sits at left:34 to clear ST(50) horizontally.
//   * 4-1-2-1-2 narrow uses a 1-2 base (CDM 54,50 + flanking CMs 54,
//     24/76) instead of a tight diamond so the CAM can sit at top:30
//     above CDM(54) with the required 24% gap.
export const OVERLAY_FORMATIONS: Record<FormationKey, SlotPosition[]> = {
  // ─── BACK-FOUR ─────────────────────────────────────────────────────
  "433": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "CM", top: 56, left: 22 },
    { slotIndex: 6, label: "CM", top: 56, left: 50 },
    { slotIndex: 7, label: "CM", top: 56, left: 78 },
    // Wide attackers pulled inward 14→20 / 86→80 so cards clear the
    // top-left title-block + draft-photo zone (2026-05-03).
    { slotIndex: 8, label: "LW", top: 12, left: 20 },
    { slotIndex: 9, label: "ST", top: 8, left: 50 },
    { slotIndex: 10, label: "RW", top: 12, left: 80 },
  ],
  "442": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "LM", top: 56, left: 8 },
    { slotIndex: 6, label: "CM", top: 56, left: 32 },
    { slotIndex: 7, label: "CM", top: 56, left: 68 },
    { slotIndex: 8, label: "RM", top: 56, left: 92 },
    { slotIndex: 9, label: "ST", top: 8, left: 36 },
    { slotIndex: 10, label: "ST", top: 8, left: 64 },
  ],
  "4231": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "CDM", top: 56, left: 32 },
    { slotIndex: 6, label: "CDM", top: 56, left: 68 },
    { slotIndex: 7, label: "LM", top: 32, left: 8 },
    { slotIndex: 8, label: "CAM", top: 32, left: 50 },
    { slotIndex: 9, label: "RM", top: 32, left: 92 },
    { slotIndex: 10, label: "ST", top: 8, left: 50 },
  ],
  // 4-1-4-1 (balanced, single CDM shield, 4-man mid, lone ST)
  "4141": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "CDM", top: 58, left: 50 },
    { slotIndex: 6, label: "LM", top: 34, left: 8 },
    { slotIndex: 7, label: "CM", top: 34, left: 32 },
    { slotIndex: 8, label: "CM", top: 34, left: 68 },
    { slotIndex: 9, label: "RM", top: 34, left: 92 },
    { slotIndex: 10, label: "ST", top: 8, left: 50 },
  ],
  // 4-1-2-1-2 Narrow (1-2 base + CAM peak; flat-3 mid base)
  "41212": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "CDM", top: 54, left: 50 },
    { slotIndex: 6, label: "CM", top: 54, left: 24 },
    { slotIndex: 7, label: "CM", top: 54, left: 76 },
    { slotIndex: 8, label: "CAM", top: 30, left: 50 },
    { slotIndex: 9, label: "ST", top: 6, left: 34 },
    { slotIndex: 10, label: "ST", top: 6, left: 66 },
  ],
  // 4-2-2-2 (box midfield, two strikers)
  "4222": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "CDM", top: 56, left: 32 },
    { slotIndex: 6, label: "CDM", top: 56, left: 68 },
    { slotIndex: 7, label: "CAM", top: 30, left: 30 },
    { slotIndex: 8, label: "CAM", top: 30, left: 70 },
    { slotIndex: 9, label: "ST", top: 6, left: 38 },
    { slotIndex: 10, label: "ST", top: 6, left: 62 },
  ],
  // 4-2-4 (wide, attacking; two CMs behind four attackers)
  "424": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "CM", top: 56, left: 32 },
    { slotIndex: 6, label: "CM", top: 56, left: 68 },
    { slotIndex: 7, label: "LW", top: 12, left: 20 },
    { slotIndex: 8, label: "ST", top: 8, left: 40 },
    { slotIndex: 9, label: "ST", top: 8, left: 60 },
    { slotIndex: 10, label: "RW", top: 12, left: 80 },
  ],
  // 4-3-1-2 (flat 3 CMs, a CAM, two STs)
  "4312": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "CM", top: 56, left: 22 },
    { slotIndex: 6, label: "CM", top: 56, left: 50 },
    { slotIndex: 7, label: "CM", top: 56, left: 78 },
    { slotIndex: 8, label: "CAM", top: 30, left: 50 },
    { slotIndex: 9, label: "ST", top: 6, left: 32 },
    { slotIndex: 10, label: "ST", top: 6, left: 68 },
  ],
  // 4-3-2-1 "Christmas tree" (3 CMs, 2 CAMs, lone ST)
  "4321": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "CM", top: 56, left: 22 },
    { slotIndex: 6, label: "CM", top: 56, left: 50 },
    { slotIndex: 7, label: "CM", top: 56, left: 78 },
    { slotIndex: 8, label: "CAM", top: 30, left: 32 },
    { slotIndex: 9, label: "CAM", top: 30, left: 68 },
    { slotIndex: 10, label: "ST", top: 6, left: 50 },
  ],
  // 4-4-1-1 (flat 4-mid with CAM sitting off the ST)
  "4411": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "LM", top: 56, left: 8 },
    { slotIndex: 6, label: "CM", top: 56, left: 32 },
    { slotIndex: 7, label: "CM", top: 56, left: 68 },
    { slotIndex: 8, label: "RM", top: 56, left: 92 },
    { slotIndex: 9, label: "CAM", top: 32, left: 50 },
    { slotIndex: 10, label: "ST", top: 8, left: 50 },
  ],
  // 4-5-1 (true 5-man midfield, no CAM)
  "451": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LB", top: 80, left: 8 },
    { slotIndex: 2, label: "CB", top: 80, left: 32 },
    { slotIndex: 3, label: "CB", top: 80, left: 68 },
    { slotIndex: 4, label: "RB", top: 80, left: 92 },
    { slotIndex: 5, label: "LM", top: 50, left: 8 },
    { slotIndex: 6, label: "CM", top: 56, left: 28 },
    { slotIndex: 7, label: "CM", top: 56, left: 50 },
    { slotIndex: 8, label: "CM", top: 56, left: 72 },
    { slotIndex: 9, label: "RM", top: 50, left: 92 },
    { slotIndex: 10, label: "ST", top: 8, left: 50 },
  ],

  // ─── BACK-THREE ────────────────────────────────────────────────────
  // Central CB is dropped FORWARD to top:68 (vs side CBs at top:78) so
  // dy(GK 92, CB-mid 68) = 24 — without this trick, the central CB at
  // top:78 would overlap the GK card at top:92 (dy=14 < 23.9, dx=0).
  "352": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 78, left: 22 },
    { slotIndex: 2, label: "CB", top: 68, left: 50 },
    { slotIndex: 3, label: "CB", top: 78, left: 78 },
    { slotIndex: 4, label: "LM", top: 44, left: 8 },
    { slotIndex: 5, label: "CM", top: 44, left: 28 },
    { slotIndex: 6, label: "CM", top: 44, left: 50 },
    { slotIndex: 7, label: "CM", top: 44, left: 72 },
    { slotIndex: 8, label: "RM", top: 44, left: 92 },
    { slotIndex: 9, label: "ST", top: 8, left: 36 },
    { slotIndex: 10, label: "ST", top: 8, left: 64 },
  ],
  // 3-4-3 (wing-backs + front three)
  "343": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 78, left: 22 },
    { slotIndex: 2, label: "CB", top: 68, left: 50 },
    { slotIndex: 3, label: "CB", top: 78, left: 78 },
    { slotIndex: 4, label: "LM", top: 44, left: 8 },
    { slotIndex: 5, label: "CM", top: 44, left: 32 },
    { slotIndex: 6, label: "CM", top: 44, left: 68 },
    { slotIndex: 7, label: "RM", top: 44, left: 92 },
    { slotIndex: 8, label: "LW", top: 12, left: 20 },
    { slotIndex: 9, label: "ST", top: 8, left: 50 },
    { slotIndex: 10, label: "RW", top: 12, left: 80 },
  ],
  // 3-4-1-2 (wing-back 4-mid, CAM, two STs)
  "3412": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 78, left: 22 },
    { slotIndex: 2, label: "CB", top: 68, left: 50 },
    { slotIndex: 3, label: "CB", top: 78, left: 78 },
    { slotIndex: 4, label: "LM", top: 50, left: 8 },
    { slotIndex: 5, label: "CM", top: 50, left: 32 },
    { slotIndex: 6, label: "CM", top: 50, left: 68 },
    { slotIndex: 7, label: "RM", top: 50, left: 92 },
    { slotIndex: 8, label: "CAM", top: 26, left: 50 },
    { slotIndex: 9, label: "ST", top: 6, left: 30 },
    { slotIndex: 10, label: "ST", top: 6, left: 70 },
  ],
  // 3-5-1-1 (5-mid with elevated central CM, CAM offset off-50)
  // CAM is shifted to left:34 because 5 stacked tiers on column 50
  // (ST + CAM + central-CM + central-CB + GK) needs gaps totalling
  // 4 x 24 = 96% of the pitch, but the available top span is 92%.
  "3511": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 78, left: 22 },
    { slotIndex: 2, label: "CB", top: 68, left: 50 },
    { slotIndex: 3, label: "CB", top: 78, left: 78 },
    { slotIndex: 4, label: "LM", top: 50, left: 8 },
    { slotIndex: 5, label: "CM", top: 50, left: 28 },
    { slotIndex: 6, label: "CM", top: 44, left: 50 },
    { slotIndex: 7, label: "CM", top: 50, left: 72 },
    { slotIndex: 8, label: "RM", top: 50, left: 92 },
    { slotIndex: 9, label: "CAM", top: 24, left: 34 },
    { slotIndex: 10, label: "ST", top: 8, left: 50 },
  ],
  // 3-4-2-1 (wing-back 4-mid, two CAMs, lone ST)
  "3421": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 78, left: 22 },
    { slotIndex: 2, label: "CB", top: 68, left: 50 },
    { slotIndex: 3, label: "CB", top: 78, left: 78 },
    { slotIndex: 4, label: "LM", top: 50, left: 8 },
    { slotIndex: 5, label: "CM", top: 50, left: 32 },
    { slotIndex: 6, label: "CM", top: 50, left: 68 },
    { slotIndex: 7, label: "RM", top: 50, left: 92 },
    { slotIndex: 8, label: "CAM", top: 26, left: 32 },
    { slotIndex: 9, label: "CAM", top: 26, left: 68 },
    { slotIndex: 10, label: "ST", top: 6, left: 50 },
  ],
  // 3-1-4-2 (CDM anchor, 4 wide mids, two STs)
  "3142": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "CB", top: 78, left: 22 },
    { slotIndex: 2, label: "CB", top: 68, left: 50 },
    { slotIndex: 3, label: "CB", top: 78, left: 78 },
    { slotIndex: 4, label: "CDM", top: 44, left: 50 },
    { slotIndex: 5, label: "LM", top: 30, left: 8 },
    { slotIndex: 6, label: "CM", top: 30, left: 32 },
    { slotIndex: 7, label: "CM", top: 30, left: 68 },
    { slotIndex: 8, label: "RM", top: 30, left: 92 },
    { slotIndex: 9, label: "ST", top: 6, left: 36 },
    { slotIndex: 10, label: "ST", top: 6, left: 64 },
  ],

  // ─── BACK-FIVE ─────────────────────────────────────────────────────
  // Wing-backs at top:66 (well above side CBs at 78). Central CB
  // dropped FORWARD to top:68 (same trick as back-three) so it clears
  // the GK card at top:92 by 24%.
  "532": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LWB", top: 66, left: 8 },
    { slotIndex: 2, label: "CB", top: 78, left: 28 },
    { slotIndex: 3, label: "CB", top: 68, left: 50 },
    { slotIndex: 4, label: "CB", top: 78, left: 72 },
    { slotIndex: 5, label: "RWB", top: 66, left: 92 },
    { slotIndex: 6, label: "CM", top: 44, left: 28 },
    { slotIndex: 7, label: "CM", top: 44, left: 50 },
    { slotIndex: 8, label: "CM", top: 44, left: 72 },
    { slotIndex: 9, label: "ST", top: 8, left: 36 },
    { slotIndex: 10, label: "ST", top: 8, left: 64 },
  ],
  // 5-2-1-2 (double-pivot, CAM, two STs)
  "5212": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LWB", top: 66, left: 8 },
    { slotIndex: 2, label: "CB", top: 78, left: 28 },
    { slotIndex: 3, label: "CB", top: 68, left: 50 },
    { slotIndex: 4, label: "CB", top: 78, left: 72 },
    { slotIndex: 5, label: "RWB", top: 66, left: 92 },
    { slotIndex: 6, label: "CDM", top: 44, left: 32 },
    { slotIndex: 7, label: "CDM", top: 44, left: 68 },
    { slotIndex: 8, label: "CAM", top: 24, left: 50 },
    { slotIndex: 9, label: "ST", top: 8, left: 30 },
    { slotIndex: 10, label: "ST", top: 8, left: 70 },
  ],
  // 5-4-1
  "541": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LWB", top: 66, left: 8 },
    { slotIndex: 2, label: "CB", top: 78, left: 28 },
    { slotIndex: 3, label: "CB", top: 68, left: 50 },
    { slotIndex: 4, label: "CB", top: 78, left: 72 },
    { slotIndex: 5, label: "RWB", top: 66, left: 92 },
    { slotIndex: 6, label: "LM", top: 40, left: 8 },
    { slotIndex: 7, label: "CM", top: 44, left: 32 },
    { slotIndex: 8, label: "CM", top: 44, left: 68 },
    { slotIndex: 9, label: "RM", top: 40, left: 92 },
    { slotIndex: 10, label: "ST", top: 8, left: 50 },
  ],
  // 5-2-3 (wing-back + double-pivot + front three)
  "523": [
    { slotIndex: 0, label: "GK", top: 92, left: 50 },
    { slotIndex: 1, label: "LWB", top: 66, left: 8 },
    { slotIndex: 2, label: "CB", top: 78, left: 28 },
    { slotIndex: 3, label: "CB", top: 68, left: 50 },
    { slotIndex: 4, label: "CB", top: 78, left: 72 },
    { slotIndex: 5, label: "RWB", top: 66, left: 92 },
    { slotIndex: 6, label: "CM", top: 44, left: 32 },
    { slotIndex: 7, label: "CM", top: 44, left: 68 },
    { slotIndex: 8, label: "LW", top: 12, left: 20 },
    { slotIndex: 9, label: "ST", top: 8, left: 50 },
    { slotIndex: 10, label: "RW", top: 12, left: 80 },
  ],
};

export function getOverlayFormationSlots(
  formation: FormationKey,
): SlotPosition[] {
  return OVERLAY_FORMATIONS[formation];
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
