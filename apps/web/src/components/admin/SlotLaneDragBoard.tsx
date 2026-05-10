"use client";

import { useMemo, useState, useTransition } from "react";

/**
 * 2026-05-10 — drag-and-drop slot/lane assigner for /admin/match-days/[id].
 *
 * Replaces the per-fixture <input type="number"> + <select> bulk form with a
 * visual grid: an "unassigned" pool on the left + a numbered slot list on
 * the right (each row has a Primary + Secondary cell). Producers drag a
 * fixture chip from the pool (or from another slot) into the cell where
 * it belongs.
 *
 * Stays vanilla HTML5 drag-drop API — no new deps, ~150 lines, keyboard
 * fallback via the inline number input on each cell (kept as a slot/lane
 * editor for non-mouse contexts).
 *
 * Save flow: clicking "Save slot order" pushes the full assignments
 * array through the server action prop; on success the route revalidates
 * + the SSR page re-renders with the new state.
 */

export type FixtureChip = {
  matchId: string;
  homeLabel: string;
  awayLabel: string;
  /** Existing slot from DB; client edits override this. */
  initialSlot: number | null;
  /** Existing lane from DB. */
  initialLane: "primary" | "secondary" | null;
};

export type SlotLaneAssignment = {
  matchId: string;
  slot: number | null;
  lane: "primary" | "secondary" | null;
};

/**
 * Server Action prop. Accepts the existing FormData-shaped action defined
 * in `app/admin/match-days/[id]/actions.ts::setMatchSlotLanesAction`. The
 * component serialises its typed assignment list into the
 * `assignment[<matchId>][slot|lane]` repeated-key shape the action parses.
 */
type SaveAction = (formData: FormData) => Promise<void>;

type CellKey = `slot-${number}-${"primary" | "secondary"}` | "pool";

export function SlotLaneDragBoard({
  matchDayId,
  fixtures,
  saveAction,
}: {
  matchDayId: string;
  fixtures: FixtureChip[];
  saveAction: SaveAction;
}) {
  // Map matchId → {slot, lane}. null/null = pool.
  const [state, setState] = useState<
    Record<string, { slot: number | null; lane: "primary" | "secondary" | null }>
  >(() => {
    const out: Record<
      string,
      { slot: number | null; lane: "primary" | "secondary" | null }
    > = {};
    for (const f of fixtures) {
      out[f.matchId] = { slot: f.initialSlot, lane: f.initialLane };
    }
    return out;
  });

  // Highest slot currently used + at least 1. Producers can add more slots
  // via the "Add slot row" button; cap at 50 (matches server validator).
  const [maxSlot, setMaxSlot] = useState<number>(() => {
    const used = Object.values(state)
      .map((s) => s.slot ?? 0)
      .filter((n) => n > 0);
    return used.length > 0 ? Math.max(...used, 1) : Math.max(1, fixtures.length);
  });

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  // Look up which fixture occupies a given cell (slot, lane). Pool = no slot.
  const occupants = useMemo(() => {
    const map = new Map<CellKey, FixtureChip>();
    for (const f of fixtures) {
      const s = state[f.matchId];
      if (s.slot == null || s.lane == null) {
        // Pool members aren't single-occupant — skip.
        continue;
      }
      map.set(`slot-${s.slot}-${s.lane}`, f);
    }
    return map;
  }, [state, fixtures]);

  const poolFixtures = useMemo(
    () =>
      fixtures.filter((f) => {
        const s = state[f.matchId];
        return s.slot == null || s.lane == null;
      }),
    [state, fixtures],
  );

  function moveFixture(
    matchId: string,
    target: { slot: number | null; lane: "primary" | "secondary" | null },
  ) {
    setError(null);
    setSaved(false);
    setState((prev) => {
      const next = { ...prev };
      // If target is occupied, swap with the occupant (move occupant to
      // wherever this fixture currently sits, including pool).
      if (target.slot != null && target.lane != null) {
        const targetKey: CellKey = `slot-${target.slot}-${target.lane}`;
        const occupant = occupants.get(targetKey);
        const myCurrent = prev[matchId];
        if (occupant && occupant.matchId !== matchId) {
          next[occupant.matchId] = { slot: myCurrent.slot, lane: myCurrent.lane };
        }
      }
      next[matchId] = { slot: target.slot, lane: target.lane };
      return next;
    });
  }

  function onDragStart(matchId: string) {
    return (e: React.DragEvent) => {
      setDragId(matchId);
      e.dataTransfer.setData("text/plain", matchId);
      e.dataTransfer.effectAllowed = "move";
    };
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDropCell(target: { slot: number | null; lane: "primary" | "secondary" | null }) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragId;
      if (!id) return;
      moveFixture(id, target);
      setDragId(null);
    };
  }

  function clearFixture(matchId: string) {
    moveFixture(matchId, { slot: null, lane: null });
  }

  function save() {
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("matchDayId", matchDayId);
    for (const f of fixtures) {
      const a = state[f.matchId];
      fd.set(`assignment[${f.matchId}][slot]`, a.slot != null ? String(a.slot) : "");
      fd.set(
        `assignment[${f.matchId}][lane]`,
        a.lane != null ? a.lane : "",
      );
    }
    startTransition(async () => {
      try {
        await saveAction(fd);
        setSaved(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        if (msg.toLowerCase().includes("next_redirect")) return;
        setError(msg);
      }
    });
  }

  return (
    <div
      data-testid="slot-lane-dragboard"
      className="space-y-3 rounded-sm border border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.05)] p-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)]">
          Match-day set order
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-[var(--chalk-3)]">
            Drag fixtures into sets. Each set = two matches running simultaneously. Both get full overlay treatment.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saved ? (
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">
              Saved
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setMaxSlot((n) => Math.min(n + 1, 50))}
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
            data-testid="slot-add-btn"
          >
            + Add set
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--primary-ink)] hover:bg-[#82e21a] disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="slot-lane-save-btn"
          >
            {pending ? "Saving…" : "Save slot order"}
          </button>
        </div>
      </div>
      {error ? (
        <div className="rounded-sm border border-[rgba(254,3,109,0.6)] bg-[rgba(254,3,109,0.12)] p-2 text-[11px] text-[var(--flare)]" data-testid="slot-lane-error">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr]">
        {/* Pool — fixtures not yet placed */}
        <div
          onDragOver={onDragOver}
          onDrop={onDropCell({ slot: null, lane: null })}
          className="min-h-[200px] rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-2"
          data-testid="slot-pool"
        >
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Unassigned · {poolFixtures.length}
          </div>
          <div className="flex flex-col gap-1.5">
            {poolFixtures.map((f) => (
              <FixtureCard
                key={f.matchId}
                fixture={f}
                onDragStart={onDragStart(f.matchId)}
                isDragging={dragId === f.matchId}
                onClear={null}
              />
            ))}
            {poolFixtures.length === 0 ? (
              <span className="text-[10px] italic text-[var(--chalk-3)]">All fixtures placed</span>
            ) : null}
          </div>
        </div>

        {/* Slot grid */}
        <div className="space-y-1.5">
          {Array.from({ length: maxSlot }, (_, i) => i + 1).map((slot) => (
            <div
              key={slot}
              className="grid grid-cols-[40px_1fr_1fr] items-stretch gap-2"
              data-testid={`slot-row-${slot}`}
            >
              <div className="flex items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-3)] font-mono text-base font-bold tabular text-[var(--chalk-1)]">
                {slot}
              </div>
              <SlotCell
                slot={slot}
                lane="primary"
                fixture={occupants.get(`slot-${slot}-primary`) ?? null}
                onDragOver={onDragOver}
                onDrop={onDropCell({ slot, lane: "primary" })}
                onDragStart={(id) => onDragStart(id)}
                onClear={(id) => clearFixture(id)}
                isDragging={dragId}
              />
              <SlotCell
                slot={slot}
                lane="secondary"
                fixture={occupants.get(`slot-${slot}-secondary`) ?? null}
                onDragOver={onDragOver}
                onDrop={onDropCell({ slot, lane: "secondary" })}
                onDragStart={(id) => onDragStart(id)}
                onClear={(id) => clearFixture(id)}
                isDragging={dragId}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FixtureCard({
  fixture,
  onDragStart,
  isDragging,
  onClear,
}: {
  fixture: FixtureChip;
  onDragStart: (e: React.DragEvent) => void;
  isDragging: boolean;
  onClear: (() => void) | null;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      data-testid={`fixture-chip-${fixture.matchId}`}
      className={
        "group flex cursor-grab items-center justify-between gap-2 rounded-sm border bg-[var(--ink-1)] px-2 py-1.5 text-[11px] active:cursor-grabbing " +
        (isDragging
          ? "border-[var(--primary)] opacity-40"
          : "border-[var(--ink-4)] hover:border-[var(--primary)]")
      }
    >
      <span className="truncate font-semibold text-[var(--chalk-0)]">
        {fixture.homeLabel}
        <span className="mx-1 text-[var(--chalk-3)]">vs</span>
        {fixture.awayLabel}
      </span>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Remove from slot"
          className="rounded-sm border border-[var(--ink-4)] px-1 text-[10px] font-bold text-[var(--chalk-3)] opacity-0 transition-opacity hover:border-[var(--flare)] hover:text-[var(--flare)] group-hover:opacity-100"
          data-testid={`fixture-clear-${fixture.matchId}`}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function SlotCell({
  slot,
  lane,
  fixture,
  onDragOver,
  onDrop,
  onDragStart,
  onClear,
  isDragging,
}: {
  slot: number;
  lane: "primary" | "secondary";
  fixture: FixtureChip | null;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragStart: (matchId: string) => (e: React.DragEvent) => void;
  onClear: (matchId: string) => void;
  isDragging: string | null;
}) {
  // Lane colour = visual distinction between the two simultaneous matches
  // in the same set. Both matches get full broadcast / overlay treatment;
  // this is purely a "which of the two" marker for admin readability.
  const laneColor =
    lane === "primary"
      ? "border-[rgba(107,205,6,0.5)] bg-[rgba(107,205,6,0.06)]"
      : "border-[rgba(254,3,109,0.45)] bg-[rgba(254,3,109,0.05)]";
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid={`slot-cell-${slot}-${lane}`}
      className={
        "flex min-h-[44px] flex-col justify-center rounded-sm border p-1.5 " + laneColor
      }
    >
      <div
        className={
          "mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] " +
          (lane === "primary" ? "text-[var(--primary)]" : "text-[var(--flare)]")
        }
      >
        {lane === "primary" ? "Match A" : "Match B"}
      </div>
      {fixture ? (
        <FixtureCard
          fixture={fixture}
          onDragStart={onDragStart(fixture.matchId)}
          isDragging={isDragging === fixture.matchId}
          onClear={() => onClear(fixture.matchId)}
        />
      ) : (
        <div className="text-[10px] italic text-[var(--chalk-3)]">drop fixture here</div>
      )}
    </div>
  );
}
