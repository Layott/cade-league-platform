"use client";

import { useBuilderStore, type AnimPhase } from "@/state/builder/store";
import type {
  BezierEasing,
  Element,
  Keyframe,
  TimelineProperty,
} from "@/server/overlays/builder/types";
import { EasingPresetDropdown } from "./EasingPresetDropdown";
import { BezierHandle } from "./BezierHandle";

/**
 * Wave 3B (Task 12) — KeyframeInspector.
 *
 * Right-rail inline inspector inside the TimelinePanel body. Reads the
 * store's `selectedKeyframeId` and surfaces the matching keyframe's
 * editable fields:
 *
 *   - Property label (read-only) + time-in-ms numeric input.
 *   - Value editor switched by property kind:
 *       - `color`     → native `<input type="color">`.
 *       - `filter`    → plain text input (CSS filter string).
 *       - everything else → numeric input with per-property step
 *         (0.05 for opacity, 0.1 for scale*, 1 for x/y/rotation).
 *   - EasingPresetDropdown (T11) — segment-out easing one-click presets.
 *   - BezierHandle (T10) preview — fine-tune control points when the
 *     selected keyframe has an outgoing segment. Hidden for the last
 *     keyframe in its track (no segment to ease out of).
 *   - Delete button — removes the keyframe and clears the selection.
 *
 * Edits dispatch through the store:
 *   - timeMs / value → `updateKeyframe(elementId, phase, property, kfId, patch)`.
 *   - easing preset  → handled inside `EasingPresetDropdown` via `setBezierEasing`.
 *   - delete         → `removeKeyframe` + `selectKeyframe(null)`.
 *
 * When `selectedKeyframeId` is `null` (or the id no longer matches any
 * keyframe in the current phase — e.g. the operator switched phases
 * while the panel was open) the component renders an empty-state
 * placeholder. Selection is intentionally NOT auto-cleared when the
 * phase changes; TimelineTracks owns that side of the contract.
 */
export function KeyframeInspector({
  phase,
  element,
}: {
  phase: AnimPhase;
  element: Element;
}) {
  const selectedId = useBuilderStore((s) => s.selectedKeyframeId);
  const updateKeyframe = useBuilderStore((s) => s.updateKeyframe);
  const removeKeyframe = useBuilderStore((s) => s.removeKeyframe);
  const selectKeyframe = useBuilderStore((s) => s.selectKeyframe);

  if (!selectedId) {
    return (
      <div
        data-testid="keyframe-inspector-empty"
        className="flex h-full items-center justify-center p-4 text-center text-xs text-white/50"
      >
        Select a keyframe to inspect.
      </div>
    );
  }

  // Find the keyframe + its owning track in the current phase. The
  // selection slot is a flat id so we walk every track. Tracks are
  // small (max 8 per element, ≤dozens of keyframes) so the linear
  // scan stays cheap.
  const tracks = element.animation?.[phase]?.advancedTimeline ?? [];
  let found:
    | {
        property: TimelineProperty;
        kf: Keyframe;
        nextKf: Keyframe | null;
      }
    | null = null;
  for (const t of tracks) {
    // Sort defensively so the "next" keyframe is the temporal
    // neighbour, not just the array neighbour. The store keeps tracks
    // sorted on insert + update, but a hand-edited fixture or future
    // reducer regression shouldn't desync the BezierHandle preview.
    const sorted = [...t.keyframes].sort((a, b) => a.timeMs - b.timeMs);
    const idx = sorted.findIndex((k) => k.id === selectedId);
    if (idx === -1) continue;
    found = {
      property: t.property,
      kf: sorted[idx]!,
      nextKf: idx < sorted.length - 1 ? sorted[idx + 1]! : null,
    };
    break;
  }

  if (!found) {
    return (
      <div
        data-testid="keyframe-inspector-not-found"
        className="flex h-full items-center justify-center p-4 text-center text-xs text-white/50"
      >
        Keyframe not found in this phase.
      </div>
    );
  }

  const { property, kf, nextKf } = found;

  return (
    <div
      data-testid="keyframe-inspector"
      className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-xs text-white/80"
    >
      <div
        data-testid="keyframe-inspector-header"
        className="flex items-baseline justify-between gap-2 border-b border-white/10 pb-2"
      >
        <span
          data-testid="keyframe-inspector-property"
          className="text-[10px] font-semibold uppercase tracking-wide text-white/60"
        >
          {property}
        </span>
        <span className="text-[10px] text-white/40 tabular-nums">
          {kf.timeMs}ms
        </span>
      </div>

      <label
        className="flex flex-col gap-1"
        data-testid="keyframe-inspector-time-label"
      >
        <span className="text-[10px] uppercase tracking-wide text-white/50">
          Time (ms)
        </span>
        <input
          type="number"
          min={0}
          step={1}
          value={kf.timeMs}
          aria-label="time"
          data-testid="keyframe-inspector-time-input"
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return;
            const n = Number(raw);
            if (!Number.isFinite(n)) return;
            updateKeyframe(element.id, phase, property, kf.id, {
              timeMs: Math.max(0, n),
            });
          }}
          className="w-full rounded border border-white/10 bg-zinc-900 px-2 py-1 text-white focus:outline-none focus:ring-1 focus:ring-[#6bcd06]"
        />
      </label>

      <ValueEditor
        property={property}
        value={kf.value}
        onChange={(v) =>
          updateKeyframe(element.id, phase, property, kf.id, { value: v })
        }
      />

      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-white/50">
          Easing out
        </span>
        <EasingPresetDropdown
          elementId={element.id}
          phase={phase}
          property={property}
          keyframeId={kf.id}
          easingOut={kf.easingOut}
        />
      </div>

      {nextKf ? (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-white/50">
            Curve preview
          </span>
          {/* BezierHandle positions itself absolutely against the segment
              left edge in real timeline px, so we wrap it in a
              relatively-positioned, fixed-width frame so the preview
              renders inside the inspector regardless of the segment's
              true timeline origin. The handle's drag math reads the
              segment's px width (toTimeMs − fromTimeMs at pxPerSecond),
              so we pass fromTimeMs=0 + a synthetic toTimeMs that keeps
              the visible width in the 0..PREVIEW_WIDTH band. */}
          <BezierPreviewFrame
            elementId={element.id}
            phase={phase}
            property={property}
            fromKeyframeId={kf.id}
            fromTimeMs={kf.timeMs}
            toTimeMs={nextKf.timeMs}
            easingOut={kf.easingOut}
          />
        </div>
      ) : (
        <div
          data-testid="keyframe-inspector-no-segment"
          className="rounded border border-dashed border-white/10 px-2 py-1 text-[10px] text-white/40"
        >
          Last keyframe — no outgoing segment.
        </div>
      )}

      <button
        type="button"
        data-testid="keyframe-inspector-delete"
        aria-label="Delete keyframe"
        onClick={() => {
          removeKeyframe(element.id, phase, property, kf.id);
          selectKeyframe(null);
        }}
        className="mt-auto w-full rounded bg-red-900/40 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-900/60 focus:outline-none focus:ring-1 focus:ring-red-400"
      >
        Delete keyframe
      </button>
    </div>
  );
}

/**
 * Typed value editor. Switches between three input shapes based on the
 * track property:
 *
 *   - `color`  — native `<input type="color">`; assumes the keyframe
 *     value is a 7-char hex string (`#rrggbb`). Non-hex string values
 *     still render the picker, browser falls back to its default.
 *   - `filter` — plain text input; lets the operator type a raw CSS
 *     filter string (e.g. `blur(4px) brightness(1.2)`). Validation lives
 *     in the save-time validator, not here.
 *   - default  — numeric input with a per-property step:
 *       opacity → 0.05, scaleX/scaleY → 0.1, x/y/rotation → 1.
 *     `Number.isFinite` guard so a transient empty / `-` keystroke does
 *     not write `NaN` into the store.
 */
function ValueEditor({
  property,
  value,
  onChange,
}: {
  property: TimelineProperty;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  if (property === "color") {
    return (
      <label
        className="flex flex-col gap-1"
        data-testid="keyframe-inspector-value-label"
      >
        <span className="text-[10px] uppercase tracking-wide text-white/50">
          Color
        </span>
        <input
          type="color"
          aria-label="color"
          data-testid="keyframe-inspector-value-input"
          value={typeof value === "string" ? value : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-full rounded border border-white/10 bg-transparent"
        />
      </label>
    );
  }

  if (property === "filter") {
    return (
      <label
        className="flex flex-col gap-1"
        data-testid="keyframe-inspector-value-label"
      >
        <span className="text-[10px] uppercase tracking-wide text-white/50">
          Filter (CSS)
        </span>
        <input
          type="text"
          aria-label="filter"
          data-testid="keyframe-inspector-value-input"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="blur(4px) brightness(1.2)"
          className="w-full rounded border border-white/10 bg-zinc-900 px-2 py-1 text-white focus:outline-none focus:ring-1 focus:ring-[#6bcd06]"
        />
      </label>
    );
  }

  const step = numericStep(property);
  const numericValue = typeof value === "number" ? value : Number(value);

  return (
    <label
      className="flex flex-col gap-1"
      data-testid="keyframe-inspector-value-label"
    >
      <span className="text-[10px] uppercase tracking-wide text-white/50">
        Value
      </span>
      <input
        type="number"
        aria-label="value"
        data-testid="keyframe-inspector-value-input"
        step={step}
        value={Number.isFinite(numericValue) ? numericValue : 0}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return;
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(n);
        }}
        className="w-full rounded border border-white/10 bg-zinc-900 px-2 py-1 text-white focus:outline-none focus:ring-1 focus:ring-[#6bcd06]"
      />
    </label>
  );
}

function numericStep(property: TimelineProperty): number {
  switch (property) {
    case "opacity":
      return 0.05;
    case "scaleX":
    case "scaleY":
      return 0.1;
    default:
      // x / y / rotation — integer pixels / degrees by default; admins
      // can still type sub-unit values via direct keyboard entry, the
      // step is only the up/down increment.
      return 1;
  }
}

/**
 * Wrapping frame for the BezierHandle preview. BezierHandle positions
 * itself absolutely against its segment's left edge in real timeline
 * pixel space. Inside the inspector we want a self-contained preview,
 * so we render the handle inside a fixed-height + container-relative
 * wrapper and shift the segment to start at 0 by passing a synthetic
 * fromTimeMs/toTimeMs pair scaled to the wrapper width.
 */
function BezierPreviewFrame({
  elementId,
  phase,
  property,
  fromKeyframeId,
  fromTimeMs,
  toTimeMs,
  easingOut,
}: {
  elementId: string;
  phase: AnimPhase;
  property: TimelineProperty;
  fromKeyframeId: string;
  fromTimeMs: number;
  toTimeMs: number;
  easingOut: BezierEasing | null;
}) {
  // Visible width in px. Sized to fit comfortably inside a right-rail
  // inspector at 240-280px wide while keeping the handle drag area
  // legible. Height matches BezierHandle's ROW_HEIGHT_PX (28) so the
  // wrapper does not clip the curve at y=0/y=1.
  const PREVIEW_WIDTH_PX = 200;
  const PREVIEW_HEIGHT_PX = 28;

  // Shift the segment to start at 0 so BezierHandle's `segmentLeftPx`
  // computation parks the SVG at the left edge of the wrapper. The
  // `pxPerSecond` is derived so the resulting segment width matches the
  // preview frame exactly. Falls back to a hairline width when the
  // segment is degenerate (back-to-back keyframes) so the math stays
  // defined.
  const segmentDurationMs = Math.max(1, toTimeMs - fromTimeMs);
  // 1000 ms / segmentDurationMs gives the px-per-second needed to make
  // segmentDurationMs render as PREVIEW_WIDTH_PX wide.
  const pxPerSecond = (PREVIEW_WIDTH_PX * 1000) / segmentDurationMs;

  return (
    <div
      data-testid="keyframe-inspector-bezier-preview"
      className="relative w-full rounded border border-white/10 bg-zinc-900/60"
      style={{
        height: PREVIEW_HEIGHT_PX,
        // Cap the width so the absolutely-positioned SVG inside doesn't
        // overflow when the panel is wider than the preview frame.
        maxWidth: PREVIEW_WIDTH_PX,
      }}
    >
      <BezierHandle
        elementId={elementId}
        phase={phase}
        property={property}
        fromKeyframeId={fromKeyframeId}
        fromTimeMs={0}
        toTimeMs={segmentDurationMs}
        easingOut={easingOut}
        pxPerSecond={pxPerSecond}
      />
    </div>
  );
}
