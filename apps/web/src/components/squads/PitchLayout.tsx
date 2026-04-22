"use client";

import { FutCard } from "./FutCard";
import type { CardSearchResult } from "@/server/fcdb/search";

/**
 * Plan 30 — SVG-free pitch layout.
 *
 * Formations are keyed by position-strings (`GK`, `RB`, `CB1`, …) so a
 * stable slotIndex (0-10) maps to each formation's lineup role. The
 * absolute-position coordinates are percentages of the pitch area.
 *
 * Switching formation preserves filled slots whose slotIndex exists in the
 * new formation. Slots that don't exist in the new formation fall off and
 * are re-added to the subs bench.
 */

export type FormationKey = "433" | "442" | "4231" | "352";

export type SlotPosition = {
  slotIndex: number;
  label: string; // ST, LM, etc.
  top: number; // 0-100
  left: number; // 0-100
};

// 0-based slotIndex mapping. GK = 0 always; defenders cluster at the back.
const FORMATIONS: Record<FormationKey, SlotPosition[]> = {
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
};

export function getFormationSlots(formation: FormationKey): SlotPosition[] {
  return FORMATIONS[formation];
}

export function formationLabel(formation: FormationKey): string {
  if (formation === "433") return "4-3-3";
  if (formation === "442") return "4-4-2";
  if (formation === "4231") return "4-2-3-1";
  return "3-5-2";
}

export type PitchLayoutProps = {
  formation: FormationKey;
  slots: Record<number, CardSearchResult | null>;
  onSlotClick: (slot: SlotPosition) => void;
};

export function PitchLayout({ formation, slots, onSlotClick }: PitchLayoutProps) {
  const defs = FORMATIONS[formation];
  return (
    <div
      data-testid="pitch-layout"
      data-formation={formation}
      className="relative mx-auto aspect-[3/4] w-full max-w-[560px] overflow-hidden rounded-sm border border-[var(--ink-4)] bg-gradient-to-b from-[#0d2417] via-[#0a1c12] to-[#081a10]"
    >
      {/* field markings (pure CSS) */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* halfway line */}
        <div className="absolute left-[5%] right-[5%] top-[50%] border-t border-white/15" />
        {/* center circle */}
        <div className="absolute left-1/2 top-1/2 h-[18%] w-[18%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
        {/* penalty boxes */}
        <div className="absolute left-[22%] right-[22%] top-[2%] h-[14%] border-b border-l border-r border-white/15" />
        <div className="absolute left-[22%] right-[22%] bottom-[2%] h-[14%] border-l border-r border-t border-white/15" />
      </div>

      {defs.map((s) => {
        const card = slots[s.slotIndex] ?? null;
        return (
          <div
            key={s.slotIndex}
            style={{
              top: `${s.top}%`,
              left: `${s.left}%`,
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
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
