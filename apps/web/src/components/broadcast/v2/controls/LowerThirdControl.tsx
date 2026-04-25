"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ReTriggerHideButtons } from "../ReTriggerHideButtons";
import { SecondaryButton } from "@/components/admin/buttons";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Plan 51 — Lower Third control (3 simultaneous slots).
 *
 * The legacy `lower_third` overlay is the only multi-instance template
 * (per `server/broadcast/v2/off_routing.ts`). Each of the 3 slots maps
 * to `instance_slot` 1..3 in `overlay_active_instances`.
 *
 * EDITABLE control — each of the 3 slots gets its OWN ReTriggerHideButtons
 * pair (Trigger + Hide). Trigger always re-fires the current payload for
 * that slot (clear-then-trigger), so editing a slot's name/role and
 * re-clicking replays the entry animation with the fresh values. Hide
 * clears that slot without re-firing. Slot active state is shown via a
 * "Live" pill on each slot card.
 *
 * Presets persist in `localStorage['cade-lt-presets']`. Save = stash
 * current name+role under a user-supplied label. Load = pop into the
 * inputs (does NOT auto-trigger; operator still clicks the button).
 */

type LtPreset = {
  name: string;
  slotData: { name: string; role: string };
};

const LT_PRESET_KEY = "cade-lt-presets";

// Synthesize a deterministic UUID-shaped string per slot. Real player
// IDs would come from the players table; we only need a valid UUID
// shape so the Zod `playerId: z.string().uuid()` validator passes.
const PLACEHOLDER_PLAYER_IDS: Record<1 | 2 | 3, string> = {
  1: "00000000-0000-4000-8000-000000000001",
  2: "00000000-0000-4000-8000-000000000002",
  3: "00000000-0000-4000-8000-000000000003",
};

type SlotState = { name: string; role: string };
const DEFAULT_SLOTS: Record<1 | 2 | 3, SlotState> = {
  1: { name: "JOSH", role: "HEAD CASTER" },
  2: { name: "ADE", role: "CO-CASTER" },
  3: { name: "MITCH", role: "ANALYST" },
};

function readPresets(): LtPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LT_PRESET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LtPreset[]) : [];
  } catch {
    return [];
  }
}

function writePresets(arr: LtPreset[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LT_PRESET_KEY, JSON.stringify(arr));
  } catch {
    // swallow — quota exceeded / private mode
  }
}

export type LowerThirdControlProps = SimpleControlProps & {
  /**
   * Per-slot active flags from the server. Index 0 = slot 1, 1 = slot 2,
   * 2 = slot 3. Defaults to all-inactive when not supplied (e.g. tests).
   */
  slotsActive?: [boolean, boolean, boolean];
};

export function LowerThirdControl({
  sessionId,
  viewToken,
  slotsActive = [false, false, false],
}: LowerThirdControlProps) {
  const [slots, setSlots] = useState<Record<1 | 2 | 3, SlotState>>(
    DEFAULT_SLOTS,
  );
  const [presets, setPresets] = useState<LtPreset[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setPresets(readPresets());
  }, []);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const updateSlot = (n: 1 | 2 | 3, partial: Partial<SlotState>) => {
    setSlots((prev) => ({ ...prev, [n]: { ...prev[n], ...partial } }));
  };

  const sendPreviewSlot = (n: 1 | 2 | 3) => {
    postToFrame(iframeRef.current, {
      type: "update",
      slot: n,
      data: { name: slots[n].name, role: slots[n].role },
    });
  };

  const saveAsPreset = (n: 1 | 2 | 3) => {
    const proposed = window.prompt(
      `Preset name for slot ${n}?`,
      slots[n].name || `Preset ${Date.now()}`,
    );
    if (!proposed) return;
    const next = [...presets];
    const idx = next.findIndex((p) => p.name === proposed);
    const entry: LtPreset = {
      name: proposed,
      slotData: { name: slots[n].name, role: slots[n].role },
    };
    if (idx >= 0) next[idx] = entry;
    else next.push(entry);
    writePresets(next);
    setPresets(next);
  };

  const loadPreset = (n: 1 | 2 | 3, presetName: string) => {
    if (!presetName) return;
    const preset = presets.find((p) => p.name === presetName);
    if (!preset) return;
    updateSlot(n, preset.slotData);
  };

  // Build the v2 + legacy-schema-compatible payload for slot n.
  function payloadForSlot(n: 1 | 2 | 3): string {
    return JSON.stringify({
      playerId: PLACEHOLDER_PLAYER_IDS[n],
      displayName: slots[n].name || `Slot ${n}`,
      gamerTag: slots[n].role || "—",
      jerseyNumber: n,
    });
  }

  return (
    <ControlCard
      overlayKey="08-lower-third"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      liveBadge={slotsActive.some(Boolean)}
      editPanel={
        <div className="space-y-3">
          {([1, 2, 3] as const).map((n) => (
            <div
              key={n}
              className="rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/40 p-2"
              data-testid={`v2-lt-slot-${n}`}
              data-active={slotsActive[n - 1] ? "true" : "false"}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--signal)]">
                  Slot {n}
                </span>
                {slotsActive[n - 1] ? (
                  <span
                    data-testid={`v2-lt-live-${n}`}
                    className="inline-flex items-center gap-1 rounded-sm border border-[rgba(255,91,59,0.55)] bg-[rgba(255,91,59,0.15)] px-1.5 py-[1px] font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-[var(--flare)]"
                    title="Slot is currently live"
                  >
                    <span
                      className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--flare)] animate-pulse"
                      aria-hidden="true"
                    />
                    Live
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Name
                  <input
                    type="text"
                    value={slots[n].name}
                    onChange={(e) => updateSlot(n, { name: e.target.value })}
                    onBlur={() => sendPreviewSlot(n)}
                    data-testid={`v2-lt-name-${n}`}
                    className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[12px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Role
                  <input
                    type="text"
                    value={slots[n].role}
                    onChange={(e) => updateSlot(n, { role: e.target.value })}
                    onBlur={() => sendPreviewSlot(n)}
                    data-testid={`v2-lt-role-${n}`}
                    className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[12px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
                  />
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Load preset
                  <select
                    onChange={(e) => loadPreset(n, e.target.value)}
                    data-testid={`v2-lt-preset-load-${n}`}
                    className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[11px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
                  >
                    <option value="">— Select preset —</option>
                    {presets.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <SecondaryButton
                    type="button"
                    size="sm"
                    onClick={() => saveAsPreset(n)}
                    data-testid={`v2-lt-preset-save-${n}`}
                    className="w-full"
                  >
                    Save preset
                  </SecondaryButton>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <ReTriggerHideButtons
                  overlayKey="08-lower-third"
                  sessionId={sessionId}
                  active={slotsActive[n - 1]}
                  instanceSlot={n}
                  testIdSuffix="08-lower-third"
                  triggerLabel="Trigger"
                  hideLabel="Hide"
                  triggerButtonTestId={`v2-lt-trigger-${n}`}
                  hideButtonTestId={`v2-lt-hide-${n}`}
                  payloadFields={
                    <input
                      type="hidden"
                      name="payload"
                      value={payloadForSlot(n)}
                    />
                  }
                />
              </div>
            </div>
          ))}
        </div>
      }
      triggerSlot={
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--chalk-3)]">
          Use per-slot Trigger / Hide buttons above. Trigger re-fires
          with current values; Hide clears.
        </p>
      }
    />
  );
}
