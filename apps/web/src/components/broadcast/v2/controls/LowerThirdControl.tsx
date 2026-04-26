"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ReTriggerHideButtons } from "../ReTriggerHideButtons";
import { SecondaryButton } from "@/components/admin/buttons";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Plan 51 — Lower Third control. ONE control card per slot (1, 2, 3).
 *
 * The legacy `lower_third` overlay is the only multi-instance template
 * (per `server/broadcast/v2/off_routing.ts`). Each of the 3 simultaneous
 * slot anchors (BL / BC / BR) maps to `instance_slot` 1..3 in
 * `overlay_active_instances`.
 *
 * After 2026-04-26 the control room renders THREE separate `LowerThirdControl`
 * instances (one per slot) instead of one combined card. Each instance:
 *   - owns its own name + role inputs + presets;
 *   - has its own `Trigger` + `Hide` buttons that fire / clear ONLY this slot;
 *   - has its own iframe preview that postMessages with this slot baked in,
 *     so the preview shows that slot's anchor populated independently.
 *
 * Server-side, `triggerOverlayOffAction` already routes by `instanceSlot`
 * so hitting "Hide" on Card 2 leaves slots 1 + 3 untouched in the DB.
 *
 * Presets persist in `localStorage['cade-lt-presets']` and are SHARED across
 * the 3 cards — that's the original behavior + matches operator expectation
 * (a preset is a name+role pair, slot-agnostic).
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
  /** Which of the 3 simultaneous slots this card drives. */
  slot: 1 | 2 | 3;
  /** Whether THIS slot is currently live. */
  active?: boolean;
  /** Optional header label override; defaults to `Lower Third ${slot}`. */
  cardLabel?: string;
};

export function LowerThirdControl({
  sessionId,
  viewToken,
  slot,
  active = false,
  cardLabel,
}: LowerThirdControlProps) {
  const [state, setState] = useState<SlotState>(DEFAULT_SLOTS[slot]);
  const [presets, setPresets] = useState<LtPreset[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setPresets(readPresets());
  }, []);

  const onIframeReady = useCallback(
    (el: HTMLIFrameElement | null) => {
      iframeRef.current = el;
      // When the iframe finishes mounting, push the current slot data so
      // the preview reflects whatever the operator has typed in this card.
      // The overlay HTML will only render the matching slot anchor.
      if (el) {
        postToFrame(el, {
          type: "update",
          slot,
          data: { name: state.name, role: state.role },
        });
      }
    },
    [slot, state.name, state.role],
  );

  const updateSlot = (partial: Partial<SlotState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  };

  const sendPreviewSlot = () => {
    postToFrame(iframeRef.current, {
      type: "update",
      slot,
      data: { name: state.name, role: state.role },
    });
  };

  const saveAsPreset = () => {
    const proposed = window.prompt(
      `Preset name for slot ${slot}?`,
      state.name || `Preset ${Date.now()}`,
    );
    if (!proposed) return;
    const next = [...presets];
    const idx = next.findIndex((p) => p.name === proposed);
    const entry: LtPreset = {
      name: proposed,
      slotData: { name: state.name, role: state.role },
    };
    if (idx >= 0) next[idx] = entry;
    else next.push(entry);
    writePresets(next);
    setPresets(next);
  };

  const loadPreset = (presetName: string) => {
    if (!presetName) return;
    const preset = presets.find((p) => p.name === presetName);
    if (!preset) return;
    updateSlot(preset.slotData);
  };

  // Build the v2 + legacy-schema-compatible payload for this slot.
  const payload = JSON.stringify({
    playerId: PLACEHOLDER_PLAYER_IDS[slot],
    displayName: state.name || `Slot ${slot}`,
    gamerTag: state.role || "—",
    jerseyNumber: slot,
  });

  // Optimistic — postMessage the lower-third slot payload synchronously
  // on Trigger click so the operator sees the entry animation in <50ms
  // instead of waiting for the realtime round-trip. The v2 overlay HTML
  // accepts `{name, role}` for slot rendering (matches the inline preview
  // path used during typing).
  const optimisticTrigger = useCallback(() => {
    postToFrame(iframeRef.current, {
      type: "show",
      slot,
      data: { name: state.name, role: state.role },
    });
  }, [slot, state.name, state.role]);

  const optimisticHide = useCallback(() => {
    postToFrame(iframeRef.current, { type: "hide", slot });
  }, [slot]);

  const headerLabel = cardLabel ?? `Lower Third ${slot}`;

  return (
    <ControlCard
      overlayKey="08-lower-third"
      sessionId={sessionId}
      viewToken={viewToken}
      labelOverride={headerLabel}
      instanceSuffix={`slot-${slot}`}
      onIframeReady={onIframeReady}
      liveBadge={active}
      editPanel={
        <div
          className="rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-1)]/40 p-2"
          data-testid={`v2-lt-slot-${slot}`}
          data-active={active ? "true" : "false"}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--signal)]">
              Slot {slot}
            </span>
            {active ? (
              <span
                data-testid={`v2-lt-live-${slot}`}
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
                value={state.name}
                onChange={(e) => updateSlot({ name: e.target.value })}
                onBlur={sendPreviewSlot}
                data-testid={`v2-lt-name-${slot}`}
                className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[12px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Role
              <input
                type="text"
                value={state.role}
                onChange={(e) => updateSlot({ role: e.target.value })}
                onBlur={sendPreviewSlot}
                data-testid={`v2-lt-role-${slot}`}
                className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[12px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Load preset
              <select
                onChange={(e) => loadPreset(e.target.value)}
                data-testid={`v2-lt-preset-load-${slot}`}
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
                onClick={saveAsPreset}
                data-testid={`v2-lt-preset-save-${slot}`}
                className="w-full"
              >
                Save preset
              </SecondaryButton>
            </div>
          </div>
        </div>
      }
      triggerSlot={
        <ReTriggerHideButtons
          overlayKey="08-lower-third"
          sessionId={sessionId}
          active={active}
          instanceSlot={slot}
          testIdSuffix="08-lower-third"
          triggerLabel="Trigger"
          hideLabel="Hide"
          triggerButtonTestId={`v2-lt-trigger-${slot}`}
          hideButtonTestId={`v2-lt-hide-${slot}`}
          onOptimisticTrigger={optimisticTrigger}
          onOptimisticHide={optimisticHide}
          payloadFields={
            <input type="hidden" name="payload" value={payload} />
          }
        />
      }
    />
  );
}
