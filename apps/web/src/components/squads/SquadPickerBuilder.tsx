"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { FutCard } from "./FutCard";
import {
  PitchLayout,
  formationLabel,
  getFormationSlots,
  FORMATION_GROUPS,
  type FormationKey,
  type SlotPosition,
} from "./PitchLayout";
import { CardSearchDialog } from "./CardSearchDialog";
import { LiveTotalsBar, type LiveTotalsRule } from "./LiveTotalsBar";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import type { CardSearchResult } from "@/server/fcdb/search";

/**
 * Plan 30 — top-level picker UI component.
 *
 * Owns:
 *   - Formation (4-3-3 default)
 *   - Slot map (slotIndex → CardSearchResult | null)
 *   - Subs bench array (up to 7)
 *   - Dialog open/slot target state
 *   - Submission pipeline (screenshot upload via Plan 10 action, then picker submit)
 *
 * Props let the page pass in the current rule + the existing draft (for the
 * edit case). When `locked=true` the page renders a read-only preview
 * instead of mounting this component — we don't branch read-only here.
 */

const MAX_SUBS = 7;

export type SquadPickerBuilderProps = {
  weekStartDate: string;
  rule: LiveTotalsRule | null;
  submitAction: (payload: {
    weekStartDate: string;
    futbinScreenshotPath: string;
    slots: Array<{ slotIndex: number; fcdbPlayerId: string; positionInLineup: string }>;
  }) => Promise<void>;
  requestUploadUrlAction: (input: { extension: "png" | "jpg" | "webp" }) => Promise<{
    path: string;
    signedUrl: string;
    token?: string;
    weekStartDate: string;
  }>;
};

export function SquadPickerBuilder({
  weekStartDate,
  rule,
  submitAction,
  requestUploadUrlAction,
}: SquadPickerBuilderProps) {
  const [formation, setFormation] = useState<FormationKey>("433");
  const [slots, setSlots] = useState<Record<number, CardSearchResult | null>>(
    () => emptySlots(),
  );
  const [subs, setSubs] = useState<Array<CardSearchResult | null>>(
    () => Array.from({ length: MAX_SUBS }, () => null),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<
    | { kind: "slot"; slot: SlotPosition }
    | { kind: "sub"; index: number }
    | null
  >(null);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Drag-to-reorder source. Lifted here so drops can cross the pitch <->
  // subs bench boundary. Cleared on drag-end regardless of drop.
  const dragSourceRef = useRef<
    | { kind: "slot"; index: number }
    | { kind: "sub"; index: number }
    | null
  >(null);

  const filledCount = useMemo(
    () => Object.values(slots).filter((c) => !!c).length,
    [slots],
  );
  const allStartersFilled = filledCount === 11;

  const openSlot = useCallback((slot: SlotPosition) => {
    setDialogTarget({ kind: "slot", slot });
    setDialogOpen(true);
  }, []);

  /**
   * Remap filled slots when the formation changes. Strategy: for each
   * destination slot (in order), find the first unconsumed source slot that
   * shares the same position label. Remaining filled cards that don't match
   * are dropped onto the subs bench if space is available; otherwise cleared.
   */
  const switchFormation = useCallback(
    (next: FormationKey) => {
      if (next === formation) return;
      const prevDefs = getFormationSlots(formation);
      const nextDefs = getFormationSlots(next);

      const filled = prevDefs
        .map((d) => ({ label: d.label, card: slots[d.slotIndex] ?? null }))
        .filter((x) => x.card !== null) as Array<{
        label: string;
        card: CardSearchResult;
      }>;

      const remapped: Record<number, CardSearchResult | null> = {};
      for (let i = 0; i < 11; i++) remapped[i] = null;

      const consumed = new Set<number>();
      nextDefs.forEach((slot) => {
        const matchIdx = filled.findIndex(
          (f, i) => !consumed.has(i) && f.label === slot.label,
        );
        if (matchIdx >= 0) {
          remapped[slot.slotIndex] = filled[matchIdx].card;
          consumed.add(matchIdx);
        }
      });

      // Push unmatched cards onto the subs bench (first empty slots).
      const leftover = filled.filter((_, i) => !consumed.has(i)).map((x) => x.card);
      if (leftover.length > 0) {
        setSubs((currentSubs) => {
          const nextSubs = [...currentSubs];
          for (const card of leftover) {
            const emptyIdx = nextSubs.findIndex((s) => s === null);
            if (emptyIdx === -1) break;
            nextSubs[emptyIdx] = card;
          }
          return nextSubs;
        });
      }

      setSlots(remapped);
      setFormation(next);
    },
    [formation, slots],
  );

  const openSub = useCallback((index: number) => {
    setDialogTarget({ kind: "sub", index });
    setDialogOpen(true);
  }, []);

  const handlePick = useCallback(
    (card: CardSearchResult) => {
      if (!dialogTarget) {
        setDialogOpen(false);
        return;
      }
      if (dialogTarget.kind === "slot") {
        setSlots((s) => ({ ...s, [dialogTarget.slot.slotIndex]: card }));
      } else {
        setSubs((s) => {
          const next = [...s];
          next[dialogTarget.index] = card;
          return next;
        });
      }
      setDialogOpen(false);
      setDialogTarget(null);
    },
    [dialogTarget],
  );

  const clearSlot = useCallback((slotIndex: number) => {
    setSlots((s) => ({ ...s, [slotIndex]: null }));
  }, []);

  const clearSub = useCallback((index: number) => {
    setSubs((s) => {
      const next = [...s];
      next[index] = null;
      return next;
    });
  }, []);

  // Drag & drop. Supports both intra-starting-XI swaps and crossing
  // starter <-> sub. Dropping onto an empty slot moves the card; onto a
  // filled slot swaps. No-op when source === target or source is null.
  const handleDragStart = useCallback(
    (kind: "slot" | "sub", index: number) => {
      dragSourceRef.current = { kind, index };
    },
    [],
  );
  const handleDragEnd = useCallback(() => {
    dragSourceRef.current = null;
  }, []);
  const handleDrop = useCallback(
    (targetKind: "slot" | "sub", targetIndex: number) => {
      const src = dragSourceRef.current;
      dragSourceRef.current = null;
      if (!src) return;
      if (src.kind === targetKind && src.index === targetIndex) return;
      const srcCard =
        src.kind === "slot" ? slots[src.index] ?? null : subs[src.index] ?? null;
      const dstCard =
        targetKind === "slot" ? slots[targetIndex] ?? null : subs[targetIndex] ?? null;
      if (!srcCard) return;
      // Build next states.
      const nextSlots = { ...slots };
      const nextSubs = [...subs];
      const writeAt = (kind: "slot" | "sub", idx: number, c: CardSearchResult | null) => {
        if (kind === "slot") nextSlots[idx] = c;
        else nextSubs[idx] = c;
      };
      writeAt(targetKind, targetIndex, srcCard);
      writeAt(src.kind, src.index, dstCard); // dst may be null — acts as a move
      setSlots(nextSlots);
      setSubs(nextSubs);
    },
    [slots, subs],
  );

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setUploading(true);
    try {
      const extRaw = f.name.split(".").pop()?.toLowerCase() ?? "png";
      const extension = (["png", "jpg", "jpeg", "webp"].includes(extRaw)
        ? extRaw === "jpeg"
          ? "jpg"
          : extRaw
        : "png") as "png" | "jpg" | "webp";
      const signed = await requestUploadUrlAction({ extension });
      const put = await fetch(signed.signedUrl, {
        method: "PUT",
        body: f,
        headers: { "Content-Type": f.type || "application/octet-stream" },
      });
      if (!put.ok) {
        throw new Error(`upload failed: ${put.status}`);
      }
      setScreenshotPath(signed.path);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function onSubmit() {
    if (!allStartersFilled) {
      setError("Fill all 11 starting slots before submitting.");
      return;
    }
    if (!screenshotPath) {
      setError("Upload your Futbin screenshot before submitting.");
      return;
    }
    setError(null);

    // Build the picker payload. Use the formation's per-slot label as the
    // positionInLineup so the server records the lineup role (e.g. "RB")
    // rather than the card's canonical position.
    const defs = getFormationSlots(formation);
    const starterRows = defs.map((s) => ({
      slotIndex: s.slotIndex,
      fcdbPlayerId: slots[s.slotIndex]!.id,
      positionInLineup: s.label,
    }));
    const subRows: Array<{
      slotIndex: number;
      fcdbPlayerId: string;
      positionInLineup: string;
    }> = [];
    subs.forEach((c, i) => {
      if (!c) return;
      subRows.push({
        slotIndex: 11 + i,
        fcdbPlayerId: c.id,
        positionInLineup: c.position,
      });
    });

    startTransition(async () => {
      try {
        await submitAction({
          weekStartDate,
          futbinScreenshotPath: screenshotPath,
          slots: [...starterRows, ...subRows],
        });
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  const dialogSlotLabel =
    dialogTarget?.kind === "slot"
      ? dialogTarget.slot.label
      : dialogTarget?.kind === "sub"
        ? "SUB"
        : "";

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-4">
        <div
          data-testid="formation-switcher"
          className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-2"
        >
          <label
            htmlFor="formation-select"
            className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]"
          >
            Formation
          </label>
          <select
            id="formation-select"
            data-testid="formation-select"
            value={formation}
            onChange={(e) => switchFormation(e.target.value as FormationKey)}
            className="rounded-sm bg-[var(--ink-1)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--chalk-1)] focus:outline-none focus:ring-1 focus:ring-[var(--signal)]"
          >
            {FORMATION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.keys.map((f) => (
                  <option key={f} value={f} data-testid={`formation-option-${f}`}>
                    {formationLabel(f)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {/* Hidden buttons preserve the historical data-testid for legacy
              tests that click `formation-433` / `formation-442` etc. */}
          <div className="sr-only" aria-hidden="true">
            {FORMATION_GROUPS.flatMap((g) => g.keys).map((f) => (
              <button
                key={f}
                type="button"
                data-testid={`formation-${f}`}
                onClick={() => switchFormation(f)}
              >
                {formationLabel(f)}
              </button>
            ))}
          </div>
        </div>

        <PitchLayout
          formation={formation}
          slots={slots}
          onSlotClick={openSlot}
          onCardDragStart={(idx) => handleDragStart("slot", idx)}
          onCardDrop={(idx) => handleDrop("slot", idx)}
          onCardDragEnd={handleDragEnd}
        />

        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Subs (optional)
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {subs.map((c, i) => {
              const isDraggable = !!c;
              return (
                <div
                  key={i}
                  className="flex flex-col items-center gap-1"
                  draggable={isDraggable}
                  onDragStart={
                    isDraggable
                      ? (e) => {
                          e.dataTransfer.effectAllowed = "move";
                          try { e.dataTransfer.setData("text/plain", `sub:${i}`); } catch {}
                          handleDragStart("sub", i);
                        }
                      : undefined
                  }
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                  onDrop={(e) => { e.preventDefault(); handleDrop("sub", i); }}
                >
                  <FutCard
                    card={c}
                    size="sm"
                    onClick={() => openSub(i)}
                    dataTestId={`sub-slot-${i}`}
                  />
                  {c ? (
                    <button
                      type="button"
                      onClick={() => clearSub(i)}
                      className="text-[9px] uppercase tracking-[0.14em] text-[var(--chalk-3)] hover:text-[var(--flare)]"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Futbin screenshot (required for submission)
          </label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onFileChange}
            disabled={uploading || isPending}
            className="mt-2 text-sm text-[var(--chalk-1)]"
            data-testid="picker-file-input"
          />
          {uploading ? (
            <p className="mt-1 text-xs text-[var(--chalk-3)]">Uploading…</p>
          ) : null}
          {screenshotPath ? (
            <p
              className="mt-1 text-xs text-[var(--signal)]"
              data-testid="picker-upload-ok"
            >
              Screenshot uploaded.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <LiveTotalsBar
          slots={slots}
          subs={subs}
          rule={rule}
          formation={formation}
        />

        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3 text-xs">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Starting XI
          </div>
          <div className="mt-1 font-mono text-sm text-[var(--chalk-0)]">
            {filledCount} / 11 filled
          </div>
          {getFormationSlots(formation).map((s) => {
            const c = slots[s.slotIndex];
            return (
              <div
                key={s.slotIndex}
                className="mt-1 flex items-center justify-between border-t border-[var(--ink-4)] pt-1"
              >
                <span className="font-mono text-[10px] text-[var(--chalk-3)]">
                  {s.label}
                </span>
                <span className="truncate text-[11px] text-[var(--chalk-1)]">
                  {c ? c.name : "—"}
                </span>
                {c ? (
                  <button
                    type="button"
                    onClick={() => clearSlot(s.slotIndex)}
                    className="text-[9px] uppercase tracking-[0.14em] text-[var(--chalk-3)] hover:text-[var(--flare)]"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {error ? (
          <div
            data-testid="picker-error"
            className="rounded-sm border border-[var(--flare)] bg-[rgba(255,91,59,0.08)] p-2 text-xs text-[var(--flare)]"
          >
            {error}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <PrimaryButton
            type="button"
            onClick={onSubmit}
            disabled={!allStartersFilled || !screenshotPath || isPending || uploading}
            data-testid="picker-submit-btn"
          >
            Submit squad
          </PrimaryButton>
          <SecondaryButton
            type="button"
            onClick={() => {
              setSlots(emptySlots());
              setSubs(Array.from({ length: MAX_SUBS }, () => null));
            }}
            disabled={isPending}
          >
            Reset
          </SecondaryButton>
        </div>
      </div>

      <CardSearchDialog
        open={dialogOpen}
        slotLabel={dialogSlotLabel}
        onClose={() => {
          setDialogOpen(false);
          setDialogTarget(null);
        }}
        onPick={handlePick}
      />
    </div>
  );
}

function emptySlots(): Record<number, CardSearchResult | null> {
  const out: Record<number, CardSearchResult | null> = {};
  for (let i = 0; i < 11; i++) out[i] = null;
  return out;
}
