"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import type { DraftRow } from "@/server/squads/draft";

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

/**
 * 2026-05-01 — bug 6. Edit-mode hydration shape. When the page renders the
 * picker for an existing pending submission, it builds an `InitialSquad`
 * from the live `squad_player_items` rows + an inferred / persisted
 * formation key. The picker treats `initialSquad` as the strongest seed
 * (overrides `initialDraft` when present) so a player who hits "Edit
 * squad" sees their actual XI, not a half-saved autosave.
 */
export type InitialSquadSlot = {
  slotIndex: number;
  card: CardSearchResult;
};
export type InitialSquad = {
  formation: string;
  slots: InitialSquadSlot[];
  subs: Array<CardSearchResult | null>;
};

export type SquadPickerBuilderProps = {
  weekStartDate: string;
  rule: LiveTotalsRule | null;
  /**
   * Optional pin: when provided, the builder threads this match-day id
   * through to the server action so the resulting submission row is stamped
   * `match_day_id = matchDayId`. Required for the per-match-day submit flow
   * introduced 2026-04-29 (`/player/squad?matchDay=<id>`).
   */
  matchDayId?: string;
  /**
   * Server Action — must be a real "use server" function reference, NOT an
   * inline arrow that wraps one. Wrapping an action in a sync arrow at the
   * call site (e.g. `submitAction={(p) => action({ ...p, x })}`) violates
   * the Next.js Server Action serialization rule and triggers "Functions
   * cannot be passed directly to Client Components" at runtime. To bind
   * extra args (like matchDayId) use the separate prop above.
   */
  submitAction: (payload: {
    weekStartDate: string;
    slots: Array<{ slotIndex: number; fcdbPlayerId: string; positionInLineup: string }>;
    matchDayId?: string;
    // Bug 10 (2026-05-01) — formation for broadcast overlay.
    formation?: string;
  }) => Promise<void>;
  /**
   * Hydrated picker state from a previously-autosaved draft. NULL on first
   * visit (no draft yet). The picker seeds its formation / slots / subs /
   * screenshot state from this on mount via lazy `useState` initializers
   * — subsequent edits debounce a `saveDraftAction` call to repersist.
   */
  initialDraft?: DraftRow | null;
  /**
   * 2026-05-01 — Edit mode hydration. When a player clicks "Edit squad"
   * on a still-pending submission, the page passes the already-submitted
   * formation + slots + subs through this prop. Takes precedence over
   * `initialDraft` so a partial autosave doesn't clobber the live
   * submission. Null on the new-submission path.
   */
  initialSquad?: InitialSquad | null;
  /**
   * Server Action — autosave the in-flight pick state. Called after every
   * change with an 800ms debounce. The action returns a structured `{ok}`
   * envelope; the picker logs failures to console.warn but never blocks
   * UI interactions on a failed save (matches Plan 30 + 47 patterns).
   */
  saveDraftAction?: (input: {
    weekStartDate: string;
    matchDayId?: string | null;
    formation: string;
    slots: Array<{
      slotIndex: number;
      fcdbPlayerId: string;
      positionInLineup: string;
      cardSnapshot: CardSearchResult;
    }>;
    subs: Array<CardSearchResult | null>;
    screenshotPath: string | null;
  }) => Promise<{ ok: boolean; error?: string; updatedAt?: string }>;
  /**
   * 2026-05-01 — bug 6. Clear-the-roster button calls this server action
   * to soft-delete any persisted draft for (player, week, match-day) so
   * the page re-renders with a clean slate on the next visit. NULL-safe:
   * the picker still resets its in-memory state regardless of whether the
   * action exists or succeeds.
   */
  clearDraftAction?: (input: {
    weekStartDate: string;
    matchDayId?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
};

export function SquadPickerBuilder({
  weekStartDate,
  rule,
  matchDayId,
  submitAction,
  initialDraft,
  initialSquad,
  saveDraftAction,
  clearDraftAction,
}: SquadPickerBuilderProps) {
  // Lazy initializers seed from `initialSquad` (edit mode — strongest
  // signal, the live submission) when present, otherwise from
  // `initialDraft` (autosave hydration). Missing / malformed fields fall
  // back to empty defaults — the JSON columns are intentionally schemaless
  // (see server/squads/draft.ts).
  const [formation, setFormation] = useState<FormationKey>(() => {
    const fSquad = initialSquad?.formation;
    if (isFormationKey(fSquad)) return fSquad;
    const fDraft = initialDraft?.formation;
    return isFormationKey(fDraft) ? fDraft : "433";
  });
  const [slots, setSlots] = useState<Record<number, CardSearchResult | null>>(
    () =>
      initialSquad
        ? seedSlotsFromInitialSquad(initialSquad)
        : seedSlotsFromDraft(initialDraft),
  );
  const [subs, setSubs] = useState<Array<CardSearchResult | null>>(
    () =>
      initialSquad
        ? seedSubsFromInitialSquad(initialSquad)
        : seedSubsFromDraft(initialDraft),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<
    | { kind: "slot"; slot: SlotPosition }
    | { kind: "sub"; index: number }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Drag-to-reorder source. Lifted here so drops can cross the pitch <->
  // subs bench boundary. Cleared on drag-end regardless of drop.
  const dragSourceRef = useRef<
    | { kind: "slot"; index: number }
    | { kind: "sub"; index: number }
    | null
  >(null);

  // Debounced autosave (~800ms). Fires whenever any field the player can
  // change moves: formation, slots, or subs. Skipped on the very first
  // effect run (which would re-save the hydrated initialDraft for no
  // reason) via `firstAutosaveRunRef`. A failed save is logged but never
  // blocks UI — autosave is best-effort.
  const firstAutosaveRunRef = useRef(true);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!saveDraftAction) return;
    if (firstAutosaveRunRef.current) {
      firstAutosaveRunRef.current = false;
      return;
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      const defs = getFormationSlots(formation);
      const slotPayload = defs
        .map((s) => {
          const card = slots[s.slotIndex];
          if (!card) return null;
          return {
            slotIndex: s.slotIndex,
            fcdbPlayerId: card.id,
            positionInLineup: s.label,
            cardSnapshot: card,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      saveDraftAction({
        weekStartDate,
        matchDayId: matchDayId ?? null,
        formation,
        slots: slotPayload,
        subs,
        screenshotPath: null,
      })
        .then((res) => {
          if (!res.ok) {
            console.warn("squad draft autosave failed:", res.error);
          }
        })
        .catch((err) => {
          console.warn("squad draft autosave threw:", err);
        });
    }, 800);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [
    formation,
    slots,
    subs,
    weekStartDate,
    matchDayId,
    saveDraftAction,
  ]);

  const filledCount = useMemo(
    () => Object.values(slots).filter((c) => !!c).length,
    [slots],
  );
  const allStartersFilled = filledCount === 11;

  /**
   * 2026-05-07 — Nigerian-in-XI client gate. Mirrors the server-side
   * `validate.ts::isNigerian` predicate so the submit button blocks
   * locally rather than waiting for a server round-trip. Counts ONLY
   * non-GK starters (slot 1..10) — GK + bench cards do not satisfy
   * the rule, matching the server's behaviour. Without this gate the
   * picker happily POSTs an all-non-Nigerian XI and surfaces the
   * 400/422 error after the round-trip; with it, the rule is visible
   * at submit-time + the button is disabled until satisfied.
   */
  const NG_FUTBIN_NATION_ID_CLIENT = 133; // matches server default; admin can override via env on server
  const isNigerianCard = useCallback((c: CardSearchResult): boolean => {
    if (
      c.futbinNationId != null &&
      c.futbinNationId === NG_FUTBIN_NATION_ID_CLIENT
    ) {
      return true;
    }
    const iso = (c.nationIso ?? "").toUpperCase();
    if (iso === "NG" || iso === "NGA") return true;
    return (c.nation ?? "").trim().toLowerCase() === "nigeria";
  }, []);

  const nigerianStarterCount = useMemo(() => {
    let n = 0;
    for (const [k, c] of Object.entries(slots)) {
      const slot = Number(k);
      if (!c) continue;
      if (slot === 0) continue; // GK excluded — same carve-out as server.
      if (isNigerianCard(c)) n += 1;
    }
    return n;
  }, [slots, isNigerianCard]);

  const minNigerian = rule?.minNigerianItems ?? 0;
  const shortNigerian = nigerianStarterCount < minNigerian;

  const openSlot = useCallback((slot: SlotPosition) => {
    setDialogTarget({ kind: "slot", slot });
    setDialogOpen(true);
  }, []);

  /**
   * Remap filled slots when the formation changes. Strategy:
   *   Pass 1: match by exact position label ("CB" → "CB", "CAM" → "CAM").
   *   Pass 2: match remaining by position family (attackers ↔ attackers,
   *           midfielders ↔ midfielders, defenders ↔ defenders, GK ↔ GK).
   *   Pass 3: fill any still-empty destination slot with whatever cards
   *           are left, preserving order.
   * Result: NO cards are dropped from the pitch on formation swap. If the
   * new formation has 11 slots and we had ≤11 filled, every card lands
   * somewhere on the pitch. Leftovers (rare — only if we had >11 via drag
   * shenanigans) spill to subs, then to a freshly grown bench tail.
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

      const family = (label: string): "GK" | "DEF" | "MID" | "ATK" => {
        const L = label.toUpperCase();
        if (L === "GK") return "GK";
        if (/^(LB|RB|CB|LWB|RWB)$/.test(L)) return "DEF";
        if (/^(CDM|CM|CAM|LM|RM)$/.test(L)) return "MID";
        return "ATK"; // LW / RW / LF / RF / CF / ST
      };

      const consumed = new Set<number>();

      // Pass 1: exact-label match.
      nextDefs.forEach((slot) => {
        const matchIdx = filled.findIndex(
          (f, i) => !consumed.has(i) && f.label === slot.label,
        );
        if (matchIdx >= 0) {
          remapped[slot.slotIndex] = filled[matchIdx].card;
          consumed.add(matchIdx);
        }
      });

      // Pass 2: family match for destination slots that are still empty.
      nextDefs.forEach((slot) => {
        if (remapped[slot.slotIndex]) return;
        const fam = family(slot.label);
        const matchIdx = filled.findIndex(
          (f, i) => !consumed.has(i) && family(f.label) === fam,
        );
        if (matchIdx >= 0) {
          remapped[slot.slotIndex] = filled[matchIdx].card;
          consumed.add(matchIdx);
        }
      });

      // Pass 3: fill any remaining empty destination slots with remaining
      // cards in original order. Keeps every card on the pitch even when
      // no family match exists (e.g. all-attacker team, new formation
      // heavy on midfielders — a card still lands rather than vanishing).
      nextDefs.forEach((slot) => {
        if (remapped[slot.slotIndex]) return;
        const matchIdx = filled.findIndex((_, i) => !consumed.has(i));
        if (matchIdx >= 0) {
          remapped[slot.slotIndex] = filled[matchIdx].card;
          consumed.add(matchIdx);
        }
      });

      // Only overflow cards (had >11 filled somehow) spill to subs.
      const leftover = filled.filter((_, i) => !consumed.has(i)).map((x) => x.card);
      if (leftover.length > 0) {
        setSubs((currentSubs) => {
          const nextSubs = [...currentSubs];
          for (const card of leftover) {
            const emptyIdx = nextSubs.findIndex((s) => s === null);
            if (emptyIdx >= 0) nextSubs[emptyIdx] = card;
            else nextSubs.push(card); // grow bench rather than drop
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
      // One-per-player rule: block adding a card whose player (slug) is
      // already on the pitch or bench — regardless of variant. Two
      // Mbappés (gold + TOTY) = same slug, same real-world player,
      // blocked. Skip-check when dropping INTO a slot currently holding
      // the SAME player (a replace, no duplication).
      const existingTargetCard =
        dialogTarget.kind === "slot"
          ? slots[dialogTarget.slot.slotIndex] ?? null
          : subs[dialogTarget.index] ?? null;
      const allCurrent = [
        ...Object.values(slots).filter((c): c is CardSearchResult => !!c),
        ...subs.filter((c): c is CardSearchResult => !!c),
      ];
      const dup = allCurrent.find(
        (c) =>
          c.slug === card.slug &&
          c.id !== existingTargetCard?.id, // allow replacing at the same slot
      );
      if (dup) {
        setError(
          `${card.name} is already in your squad — only one card per player is allowed.`,
        );
        setDialogOpen(false);
        setDialogTarget(null);
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
      setError(null);
    },
    [dialogTarget, slots, subs],
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

  /**
   * 2026-05-01 — bug 6. Clear-roster button. Confirms with the player,
   * resets every in-memory picker field (formation back to 4-3-3, every
   * slot empty, every sub null, captain unset), and best-effort calls
   * `clearDraftAction` to soft-delete the persisted draft so a return
   * visit doesn't rehydrate stale picks. The action is fire-and-forget —
   * a failed network call never blocks the UI reset.
   */
  const onClearRoster = useCallback(() => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Clear all picks and restart? This will remove your formation, starting XI, and subs for this match day.",
      );
      if (!ok) return;
    }
    setFormation("433");
    setSlots(emptySlots());
    setSubs(Array.from({ length: MAX_SUBS }, () => null));
    setError(null);
    setDialogOpen(false);
    setDialogTarget(null);
    if (clearDraftAction) {
      clearDraftAction({
        weekStartDate,
        matchDayId: matchDayId ?? null,
      })
        .then((res) => {
          if (!res.ok) {
            console.warn("squad draft clear failed:", res.error);
          }
        })
        .catch((err) => {
          console.warn("squad draft clear threw:", err);
        });
    }
  }, [clearDraftAction, weekStartDate, matchDayId]);

  function onSubmit() {
    if (!allStartersFilled) {
      setError("Fill all 11 starting slots before submitting.");
      return;
    }
    if (shortNigerian) {
      setError(
        `Starting XI needs ${minNigerian} Nigerian player${
          minNigerian === 1 ? "" : "s"
        } (currently ${nigerianStarterCount}). Bench Nigerians do not count — move at least one to the pitch.`,
      );
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
          slots: [...starterRows, ...subRows],
          matchDayId: matchDayId ?? undefined,
          // Bug 10 (2026-05-01) — pass picker formation through.
          formation,
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
          <div className="ml-auto">
            <button
              type="button"
              onClick={onClearRoster}
              disabled={isPending}
              data-testid="picker-clear-roster-btn"
              className="rounded-sm border border-[var(--flare)] bg-transparent px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--flare)] transition-colors hover:bg-[rgba(255,91,59,0.08)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear roster
            </button>
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
          {shortNigerian && allStartersFilled ? (
            <div
              data-testid="picker-nigerian-warning"
              className="rounded-sm border border-[var(--flare)] bg-[rgba(255,91,59,0.08)] p-2 text-xs text-[var(--flare)]"
            >
              Starting XI needs {minNigerian} Nigerian player
              {minNigerian === 1 ? "" : "s"} (currently {nigerianStarterCount}).
              Bench Nigerians do not satisfy this rule — move one onto the
              pitch.
            </div>
          ) : null}
          <PrimaryButton
            type="button"
            onClick={onSubmit}
            disabled={!allStartersFilled || shortNigerian || isPending}
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

const FORMATION_KEYS: ReadonlyArray<FormationKey> = FORMATION_GROUPS.flatMap(
  (g) => g.keys,
);
function isFormationKey(v: unknown): v is FormationKey {
  return (
    typeof v === "string" && (FORMATION_KEYS as readonly string[]).includes(v)
  );
}

function seedSlotsFromDraft(
  draft: DraftRow | null | undefined,
): Record<number, CardSearchResult | null> {
  const out = emptySlots();
  if (!draft || !Array.isArray(draft.slots)) return out;
  for (const s of draft.slots) {
    if (
      s &&
      typeof s.slotIndex === "number" &&
      s.slotIndex >= 0 &&
      s.slotIndex < 11 &&
      s.card
    ) {
      out[s.slotIndex] = s.card as CardSearchResult;
    }
  }
  return out;
}

function seedSubsFromDraft(
  draft: DraftRow | null | undefined,
): Array<CardSearchResult | null> {
  const base: Array<CardSearchResult | null> = Array.from(
    { length: MAX_SUBS },
    () => null,
  );
  if (!draft || !Array.isArray(draft.subs)) return base;
  for (let i = 0; i < MAX_SUBS; i++) {
    const c = draft.subs[i];
    if (c && typeof c === "object" && typeof (c as CardSearchResult).id === "string") {
      base[i] = c as CardSearchResult;
    }
  }
  return base;
}

function seedSlotsFromInitialSquad(
  initial: InitialSquad,
): Record<number, CardSearchResult | null> {
  const out = emptySlots();
  for (const s of initial.slots) {
    if (s && s.card && s.slotIndex >= 0 && s.slotIndex < 11) {
      out[s.slotIndex] = s.card;
    }
  }
  return out;
}

function seedSubsFromInitialSquad(
  initial: InitialSquad,
): Array<CardSearchResult | null> {
  const base: Array<CardSearchResult | null> = Array.from(
    { length: MAX_SUBS },
    () => null,
  );
  for (let i = 0; i < MAX_SUBS; i++) {
    const c = initial.subs[i];
    if (c && typeof c === "object" && typeof (c as CardSearchResult).id === "string") {
      base[i] = c;
    }
  }
  return base;
}
