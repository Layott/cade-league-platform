"use client";

import { FutCard } from "./FutCard";
import type { CardSearchResult } from "@/server/fcdb/search";

// Bug fix 2026-05-02: data + helpers extracted to ./formations (no "use client")
// so Server Components can import them safely. Re-exported here for back-compat
// with existing client-side imports.
import {
  FORMATIONS,
  type FormationKey,
  type SlotPosition,
  ALLOWED_POSITIONS as _ALLOWED_POSITIONS,
  FORMATION_KEYS as _FORMATION_KEYS,
  FORMATION_GROUPS as _FORMATION_GROUPS,
  getFormationSlots as _getFormationSlots,
  formationLabel as _formationLabel,
} from "./formations";

export type { FormationKey, SlotPosition, PositionCode } from "./formations";
export const ALLOWED_POSITIONS = _ALLOWED_POSITIONS;
export const FORMATION_KEYS = _FORMATION_KEYS;
export const FORMATION_GROUPS = _FORMATION_GROUPS;
export const getFormationSlots = _getFormationSlots;
export const formationLabel = _formationLabel;

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
  /**
   * 2026-05-15 — per-slot remove. Renders an × badge on filled pitch
   * cards; click clears just that slot without triggering the slot's
   * primary `onSlotClick`. Omit for read-only renders.
   */
  onSlotClear?: (slotIndex: number) => void;
};

export function PitchLayout({ formation, slots, onSlotClick, onCardDragStart, onCardDrop, onCardDragEnd, onSlotClear }: PitchLayoutProps) {
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
                onRemove={
                  card && onSlotClear ? () => onSlotClear(s.slotIndex) : undefined
                }
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
