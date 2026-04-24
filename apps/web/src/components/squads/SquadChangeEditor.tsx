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
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import type { CardSearchResult } from "@/server/fcdb/search";

/**
 * Plan 10 extension — Friday 21:00-22:00 WAT change editor.
 *
 * Lets the player (a) switch formation, (b) rearrange the existing 11
 * starters between pitch slots, (c) replace AT MOST ONE starter with a new
 * card picked from FCDB. Any combination is valid.
 *
 * Unlike `SquadPickerBuilder` this component starts PRE-FILLED with the
 * approved submission's 11 items and enforces:
 *   - exactly 11 starters at all times
 *   - at most 1 "new" (FCDB-picked) card
 *   - no duplicates across slots
 */

export type SquadChangeEditorItem = {
  itemId: string; // squad_player_items.id
  slotIndex: number; // original slot in the approved submission (0..10)
  name: string;
  rating: number;
  position: string;
  itemType: string;
  nationalityFlag: string | null;
};

export type SquadChangeSubmitPayload = {
  newFormation: FormationKey | null;
  newSlotPlan:
    | Array<{ kind: "existing"; itemId: string } | { kind: "new" }>
    | null;
  playerOutItemId: string | null;
  playerOutName: string | null;
  playerIn: {
    name: string;
    rating: number;
    itemType:
      | "gold"
      | "silver"
      | "bronze"
      | "hero"
      | "icon"
      | "legend"
      | "special"
      | "other";
    value: number;
    nationalityFlag: string | null;
  } | null;
  authorizedByRefUserId: string;
};

export type SquadChangeEditorProps = {
  initialFormation: FormationKey;
  existingItems: SquadChangeEditorItem[]; // must have exactly 11 (slot 0..10)
  refOptions: Array<{ id: string; display_name: string }>;
  submitAction: (payload: SquadChangeSubmitPayload) => Promise<void>;
};

type SlotOccupant =
  | { kind: "existing"; item: SquadChangeEditorItem }
  | { kind: "new"; card: CardSearchResult }
  | null;

/** Convert an approved squad_player_items row into a CardSearchResult-
 *  shaped object good enough for <FutCard />. We don't have the full
 *  FCDB record (cardImageUrl, mainStats, etc.), but those fields are
 *  optional or null-tolerant in FutCard's rendering.
 */
function toCardShape(it: SquadChangeEditorItem): CardSearchResult {
  return {
    id: `existing:${it.itemId}`,
    slug: it.itemId,
    name: it.name,
    rating: it.rating,
    position: it.position,
    positionsAlt: [],
    club: null,
    league: null,
    nation: it.nationalityFlag,
    nationIso: it.nationalityFlag,
    itemType: it.itemType,
    priceCoins: null,
    cardImageUrl: null,
    cardBgUrl: null,
    variant: null,
    mainStats: null,
    weakFoot: null,
    skillMoves: null,
    metaRating: null,
  } as unknown as CardSearchResult;
}

export function SquadChangeEditor({
  initialFormation,
  existingItems,
  refOptions,
  submitAction,
}: SquadChangeEditorProps) {
  const [formation, setFormation] = useState<FormationKey>(initialFormation);

  // Seed the pitch with the 11 existing items at their original slot
  // indices. The user can rearrange / swap / replace afterwards.
  const [slots, setSlots] = useState<Record<number, SlotOccupant>>(() => {
    const out: Record<number, SlotOccupant> = {};
    for (let i = 0; i < 11; i++) out[i] = null;
    for (const it of existingItems) {
      if (it.slotIndex >= 0 && it.slotIndex <= 10) {
        out[it.slotIndex] = { kind: "existing", item: it };
      }
    }
    return out;
  });
  const [dialogTargetSlot, setDialogTargetSlot] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [authorizedByRefUserId, setAuthorizedByRefUserId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dragSourceRef = useRef<number | null>(null);

  // Are we currently holding a "new" card on the pitch?
  const hasNewCard = useMemo(
    () => Object.values(slots).some((s) => s?.kind === "new"),
    [slots],
  );

  // List of items currently NOT on the pitch (i.e. the one that was
  // displaced when the player replaced a slot with a new FCDB card).
  const benchedOriginals = useMemo(() => {
    const onPitch = new Set<string>();
    for (const s of Object.values(slots)) {
      if (s?.kind === "existing") onPitch.add(s.item.itemId);
    }
    return existingItems.filter((it) => !onPitch.has(it.itemId));
  }, [slots, existingItems]);

  const openSlotToReplace = useCallback((slot: SlotPosition) => {
    setDialogTargetSlot(slot.slotIndex);
    setDialogOpen(true);
  }, []);

  const handlePickReplacement = useCallback(
    (card: CardSearchResult) => {
      if (dialogTargetSlot === null) {
        setDialogOpen(false);
        return;
      }
      // Enforce the single-new-card rule: if a different slot already
      // holds a "new" card, reject this pick.
      const otherNewSlot = Object.entries(slots).find(
        ([idx, s]) => s?.kind === "new" && Number(idx) !== dialogTargetSlot,
      );
      if (otherNewSlot) {
        setError(
          "You can only replace ONE card per change window. Clear the existing replacement first.",
        );
        setDialogOpen(false);
        setDialogTargetSlot(null);
        return;
      }
      // Dup check: new card's slug must not match any other on-pitch slug
      // (existing cards' slug === their itemId, so collision only
      // triggers for literal same-player picks).
      const currentOccupant = slots[dialogTargetSlot];
      const dup = Object.entries(slots).some(([idx, s]) => {
        if (Number(idx) === dialogTargetSlot) return false;
        if (!s) return false;
        if (s.kind === "existing") return false; // different id space
        return s.card.slug === card.slug;
      });
      if (dup) {
        setError(`${card.name} is already in the squad.`);
        setDialogOpen(false);
        setDialogTargetSlot(null);
        return;
      }
      // Replace the slot. The previously-existing card there gets
      // removed from the pitch (it's visible in the "benched" section).
      setSlots((s) => ({ ...s, [dialogTargetSlot]: { kind: "new", card } }));
      setDialogOpen(false);
      setDialogTargetSlot(null);
      setError(null);
      // Suppress unused var for lint — we use currentOccupant conceptually
      // to document what's being displaced.
      void currentOccupant;
    },
    [dialogTargetSlot, slots],
  );

  const restoreOriginalToSlot = useCallback(
    (slotIndex: number, item: SquadChangeEditorItem) => {
      setSlots((s) => ({ ...s, [slotIndex]: { kind: "existing", item } }));
      setError(null);
    },
    [],
  );

  const clearReplacement = useCallback((slotIndex: number) => {
    setSlots((s) => {
      const next = { ...s };
      const cur = next[slotIndex];
      if (cur?.kind !== "new") return s;
      // When clearing the replacement we must restore the card that
      // was displaced. We look up the ORIGINAL occupant by slotIndex.
      const original = existingItems.find((it) => it.slotIndex === slotIndex);
      if (original) {
        next[slotIndex] = { kind: "existing", item: original };
      } else {
        next[slotIndex] = null;
      }
      return next;
    });
    setError(null);
  }, [existingItems]);

  // Drag & drop — swap two slots' occupants.
  const handleDragStart = useCallback((slotIndex: number) => {
    dragSourceRef.current = slotIndex;
  }, []);
  const handleDragEnd = useCallback(() => {
    dragSourceRef.current = null;
  }, []);
  const handleDrop = useCallback(
    (targetIndex: number) => {
      const src = dragSourceRef.current;
      dragSourceRef.current = null;
      if (src === null || src === targetIndex) return;
      setSlots((s) => {
        const next = { ...s };
        const srcOcc = next[src];
        const dstOcc = next[targetIndex];
        next[targetIndex] = srcOcc;
        next[src] = dstOcc;
        return next;
      });
    },
    [],
  );

  // Build the pitch-render shape expected by PitchLayout: a record of
  // CardSearchResult | null per slotIndex.
  const pitchSlots = useMemo(() => {
    const out: Record<number, CardSearchResult | null> = {};
    for (let i = 0; i < 11; i++) {
      const occ = slots[i];
      if (!occ) {
        out[i] = null;
        continue;
      }
      out[i] = occ.kind === "existing" ? toCardShape(occ.item) : occ.card;
    }
    return out;
  }, [slots]);

  // ─── formation switcher ────────────────────────────────────────────────
  const switchFormation = useCallback(
    (next: FormationKey) => {
      if (next === formation) return;
      // Formation change keeps every slot's occupant in the SAME slotIndex.
      // This is a simple model: the player is responsible for
      // rearranging via drag if the new formation's labels would put a
      // card in a nonsensical position. We surface the label beside each
      // card so the reshuffle is obvious.
      setFormation(next);
    },
    [formation],
  );

  // ─── compose submit payload ────────────────────────────────────────────
  /** Original pitch state (snapshot taken at mount). Used to detect
   *  whether the slot plan actually changed — if not, we send null to
   *  keep the DB shape tidy. */
  const originalPlan = useMemo(() => {
    const plan: Array<{ kind: "existing"; itemId: string } | { kind: "new" }> = [];
    for (let i = 0; i < 11; i++) {
      const original = existingItems.find((it) => it.slotIndex === i);
      if (original) plan.push({ kind: "existing", itemId: original.itemId });
    }
    return plan;
  }, [existingItems]);

  const currentPlan = useMemo(() => {
    const plan: Array<{ kind: "existing"; itemId: string } | { kind: "new" }> = [];
    for (let i = 0; i < 11; i++) {
      const occ = slots[i];
      if (!occ) continue;
      plan.push(
        occ.kind === "existing"
          ? { kind: "existing", itemId: occ.item.itemId }
          : { kind: "new" },
      );
    }
    return plan;
  }, [slots]);

  const planChanged = useMemo(() => {
    if (currentPlan.length !== originalPlan.length) return true;
    for (let i = 0; i < currentPlan.length; i++) {
      const a = currentPlan[i];
      const b = originalPlan[i];
      if (a.kind !== b.kind) return true;
      if (a.kind === "existing" && b.kind === "existing" && a.itemId !== b.itemId) {
        return true;
      }
    }
    return false;
  }, [currentPlan, originalPlan]);

  const formationChanged = formation !== initialFormation;

  // Identify the swap. When hasNewCard === true, the player-in payload
  // comes from the "new" occupant; playerOut is the ORIGINAL occupant of
  // the slot that now holds the "new" card. If the "new" card was
  // dropped into a slot that previously held an UNRELATED existing card
  // (via drag-shuffle), we still treat the ORIGINAL slot owner of that
  // slotIndex as the swapped-out card — matches the intuitive "replace
  // X at slot 5" semantics.
  const swapIntent = useMemo((): SquadChangeSubmitPayload["playerIn"] & {
    outItemId: string;
    outName: string;
  } | null => {
    const newSlotEntry = Object.entries(slots).find(
      ([, s]) => s?.kind === "new",
    );
    if (!newSlotEntry) return null;
    const [slotIdxStr, newOcc] = newSlotEntry;
    if (!newOcc || newOcc.kind !== "new") return null;
    const slotIdx = Number(slotIdxStr);
    // The swapped-out card = whichever existing item is no longer on the
    // pitch. Fallback to the original occupant of the "new"-slot.
    const out =
      benchedOriginals[0] ??
      existingItems.find((it) => it.slotIndex === slotIdx);
    if (!out) return null;
    const card = newOcc.card;
    return {
      outItemId: out.itemId,
      outName: out.name,
      name: card.name,
      rating: card.rating,
      itemType: (normalizeItemType(card.itemType) ?? "gold") as
        | "gold"
        | "silver"
        | "bronze"
        | "hero"
        | "icon"
        | "legend"
        | "special"
        | "other",
      value: card.priceCoins ?? 0,
      nationalityFlag: card.nationIso ?? card.nation,
    };
  }, [slots, benchedOriginals, existingItems]);

  function onSubmit() {
    if (!authorizedByRefUserId) {
      setError("Pick the authorizing referee before submitting.");
      return;
    }
    if (!formationChanged && !planChanged && !hasNewCard) {
      setError("No change to submit — pick a different formation, rearrange cards, or replace one.");
      return;
    }
    // Must still have 11 starters.
    const filled = Object.values(slots).filter((s) => s !== null).length;
    if (filled !== 11) {
      setError(`Squad must have exactly 11 starters (currently ${filled}).`);
      return;
    }
    setError(null);

    const payload: SquadChangeSubmitPayload = {
      newFormation: formationChanged ? formation : null,
      newSlotPlan: planChanged ? currentPlan : null,
      playerOutItemId: swapIntent?.outItemId ?? null,
      playerOutName: swapIntent?.outName ?? null,
      playerIn: swapIntent
        ? {
            name: swapIntent.name,
            rating: swapIntent.rating,
            itemType: swapIntent.itemType,
            value: swapIntent.value,
            nationalityFlag: swapIntent.nationalityFlag,
          }
        : null,
      authorizedByRefUserId,
    };

    startTransition(async () => {
      try {
        await submitAction(payload);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  const defs = getFormationSlots(formation);

  return (
    <div
      data-testid="squad-change-editor"
      className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]"
    >
      <div className="flex flex-col gap-4">
        <div
          data-testid="change-formation-switcher"
          className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-2"
        >
          <label
            htmlFor="change-formation-select"
            className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]"
          >
            Formation
          </label>
          <select
            id="change-formation-select"
            data-testid="change-formation-select"
            value={formation}
            onChange={(e) => switchFormation(e.target.value as FormationKey)}
            className="rounded-sm bg-[var(--ink-1)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--chalk-1)] focus:outline-none focus:ring-1 focus:ring-[var(--signal)]"
          >
            {FORMATION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.keys.map((f) => (
                  <option key={f} value={f}>
                    {formationLabel(f)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-[var(--chalk-3)]">
            {formationChanged ? (
              <span className="text-[var(--signal)]">
                Formation changed ({formationLabel(initialFormation)} →{" "}
                {formationLabel(formation)})
              </span>
            ) : (
              <span>Current: {formationLabel(initialFormation)}</span>
            )}
          </span>
        </div>

        <PitchLayout
          formation={formation}
          slots={pitchSlots}
          onSlotClick={openSlotToReplace}
          onCardDragStart={handleDragStart}
          onCardDrop={handleDrop}
          onCardDragEnd={handleDragEnd}
        />

        {hasNewCard ? (
          <div
            data-testid="new-card-pending"
            className="rounded-sm border border-[rgba(107,205,6,0.4)] bg-[rgba(107,205,6,0.08)] p-3 text-xs text-[var(--primary)]"
          >
            New card queued. Remember: you can only replace ONE card per
            Friday window.
          </div>
        ) : null}

        {benchedOriginals.length > 0 ? (
          <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Displaced cards
            </div>
            <p className="mt-1 text-[11px] text-[var(--chalk-3)]">
              These cards were bumped when you replaced a slot. Click a pitch
              slot to swap them back in.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {benchedOriginals.map((item) => (
                <div
                  key={item.itemId}
                  className="flex flex-col items-center gap-1"
                >
                  <FutCard
                    card={toCardShape(item)}
                    size="sm"
                    dataTestId={`benched-${item.itemId}`}
                  />
                  <button
                    type="button"
                    className="text-[9px] uppercase tracking-[0.14em] text-[var(--chalk-3)] hover:text-[var(--primary)]"
                    onClick={() => restoreOriginalToSlot(item.slotIndex, item)}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3 text-xs">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Starting XI preview
          </div>
          <div className="mt-1 font-mono text-[11px] text-[var(--chalk-0)]">
            {Object.values(slots).filter((s) => s !== null).length} / 11 filled
          </div>
          {defs.map((s) => {
            const occ = slots[s.slotIndex];
            const displayName = !occ
              ? "—"
              : occ.kind === "existing"
                ? occ.item.name
                : occ.card.name;
            const isNew = occ?.kind === "new";
            return (
              <div
                key={s.slotIndex}
                className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--ink-4)] pt-1"
              >
                <span className="font-mono text-[10px] text-[var(--chalk-3)]">
                  {s.label}
                </span>
                <span
                  className={`truncate text-[11px] ${isNew ? "text-[var(--primary)]" : "text-[var(--chalk-1)]"}`}
                >
                  {displayName}
                  {isNew ? " (NEW)" : ""}
                </span>
                {isNew ? (
                  <button
                    type="button"
                    onClick={() => clearReplacement(s.slotIndex)}
                    className="text-[9px] uppercase tracking-[0.14em] text-[var(--chalk-3)] hover:text-[var(--flare)]"
                  >
                    Undo
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3">
          <label
            htmlFor="change-ref-select"
            className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]"
          >
            Authorizing referee
          </label>
          <select
            id="change-ref-select"
            data-testid="change-ref-select"
            required
            value={authorizedByRefUserId}
            onChange={(e) => setAuthorizedByRefUserId(e.target.value)}
            className="mt-2 w-full rounded-sm bg-[var(--ink-1)] px-2 py-1 text-[11px] text-[var(--chalk-1)]"
          >
            <option value="">Select a referee…</option>
            {refOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.display_name}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <div
            data-testid="change-error"
            className="rounded-sm border border-[var(--flare)] bg-[rgba(255,91,59,0.08)] p-2 text-xs text-[var(--flare)]"
          >
            {error}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <PrimaryButton
            type="button"
            onClick={onSubmit}
            disabled={isPending}
            data-testid="change-submit"
          >
            {isPending ? "Submitting…" : "Record change"}
          </PrimaryButton>
          <SecondaryButton
            type="button"
            onClick={() => {
              setFormation(initialFormation);
              const reset: Record<number, SlotOccupant> = {};
              for (let i = 0; i < 11; i++) reset[i] = null;
              for (const it of existingItems) {
                if (it.slotIndex >= 0 && it.slotIndex <= 10) {
                  reset[it.slotIndex] = { kind: "existing", item: it };
                }
              }
              setSlots(reset);
              setError(null);
            }}
          >
            Reset
          </SecondaryButton>
        </div>
      </div>

      <CardSearchDialog
        open={dialogOpen}
        slotLabel={
          dialogTargetSlot === null
            ? ""
            : defs.find((d) => d.slotIndex === dialogTargetSlot)?.label ?? ""
        }
        onClose={() => {
          setDialogOpen(false);
          setDialogTargetSlot(null);
        }}
        onPick={handlePickReplacement}
      />
    </div>
  );
}

function normalizeItemType(raw: string | null | undefined): string | null {
  const s = (raw ?? "").toLowerCase();
  const allowed = [
    "gold",
    "silver",
    "bronze",
    "hero",
    "icon",
    "legend",
    "special",
    "other",
  ];
  if (allowed.includes(s)) return s;
  if (s === "totw" || s === "evolution") return "special";
  return null;
}
