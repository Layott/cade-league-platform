"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useBuilderStore, type AnimPhase } from "@/state/builder/store";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTracks } from "./TimelineTracks";
import { KeyframeInspector } from "./KeyframeInspector";

/**
 * Wave 3B (Task 6) — bottom-dock TimelinePanel shell.
 *
 * Renders only when {@link BuilderState.timelinePanelOpen} is true AND
 * a single element is selected. Header contains:
 *   - Element title (falls back to elementType when content.text is unset).
 *   - Phase tabs (entry / exit / loop) — local state, defaults to entry.
 *   - Close button — flips `timelinePanelOpen` back off.
 *
 * Body is a placeholder. Tasks 7-12 mount the child components
 * (TimelineRuler, TimelineTracks, KeyframeNodes, BezierHandles,
 * KeyframeInspector) into the body region defined below.
 *
 * Multi-select hides the panel — advanced timeline editing operates on
 * one element at a time. Picking a second element while the panel is
 * open simply hides it until the selection narrows back to one.
 */
export function TimelinePanel() {
  const open = useBuilderStore((s) => s.timelinePanelOpen);
  const close = useBuilderStore((s) => s.closeTimelinePanel);
  const design = useBuilderStore((s) => s.design);
  const selectedIds = useBuilderStore((s) => s.selectedElementIds);
  const [phase, setPhase] = useState<AnimPhase>("entry");

  if (!open) return null;
  if (selectedIds.length !== 1) return null;
  if (!design) return null;

  const selectedId = selectedIds[0];
  let element: import("@/server/overlays/builder/types").Element | null = null;
  for (const scene of design.scenes) {
    const hit = scene.elements.find((e) => e.id === selectedId);
    if (hit) {
      element = hit;
      break;
    }
  }
  if (!element) return null;

  const phaseData = element.animation?.[phase];
  const inAdvancedMode = (phaseData?.advancedTimeline?.length ?? 0) > 0;
  const title =
    typeof element.content?.text === "string" && element.content.text.length > 0
      ? element.content.text
      : element.elementType;

  return (
    <div
      data-testid="timeline-panel"
      role="region"
      aria-label="Timeline"
      className="flex h-72 shrink-0 flex-col border-t border-white/10 bg-zinc-950"
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-sm font-medium text-white">
            Timeline — {title}
          </span>
          <PhaseTabs value={phase} onChange={setPhase} />
        </div>
        <button
          type="button"
          aria-label="Close timeline"
          onClick={close}
          className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </header>

      <div
        data-testid="timeline-panel-body"
        className="flex min-h-0 flex-1 flex-row text-sm text-white/40"
      >
        {inAdvancedMode ? (
          <>
            <span data-testid="timeline-panel-placeholder-advanced" className="sr-only">
              Timeline editor mounted (Tasks 7-12).
            </span>
            <div
              data-testid="timeline-panel-tracks-region"
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              <div
                data-testid="timeline-panel-ruler-slot"
                className="shrink-0 overflow-x-auto"
              >
                <TimelineRuler
                  elementId={element.id}
                  phase={phase}
                  durationMs={phaseData?.durationMs ?? 0}
                />
              </div>
              <div
                data-testid="timeline-panel-tracks-slot"
                className="flex min-h-0 flex-1 flex-col"
              >
                <TimelineTracks element={element} phase={phase} />
              </div>
            </div>
            <aside
              data-testid="timeline-panel-inspector-slot"
              aria-label="Keyframe inspector"
              className="flex w-72 shrink-0 flex-col border-l border-white/10 bg-zinc-950"
            >
              <KeyframeInspector phase={phase} element={element} />
            </aside>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <span data-testid="timeline-panel-placeholder-preset">
              Switch this phase to Advanced mode in Properties to edit a timeline.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function PhaseTabs({
  value,
  onChange,
}: {
  value: AnimPhase;
  onChange: (next: AnimPhase) => void;
}) {
  const phases: AnimPhase[] = ["entry", "exit", "loop"];
  return (
    <div role="tablist" aria-label="Animation phase" className="inline-flex rounded bg-zinc-900 p-0.5">
      {phases.map((p) => {
        const selected = value === p;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={p}
            onClick={() => onChange(p)}
            className={`rounded px-2 py-1 text-xs capitalize ${
              selected
                ? "bg-zinc-700 text-white"
                : "text-white/60 hover:text-white"
            }`}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}
