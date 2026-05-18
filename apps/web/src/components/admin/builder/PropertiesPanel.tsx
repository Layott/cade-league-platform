"use client";

import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import { useBuilderStore } from "@/state/builder/store";
import type { Element, ElementType } from "@/server/overlays/builder/types";
import { GradientEditor } from "./GradientEditor";
import { FilterEditor } from "./FilterEditor";
import { ShadowStackEditor } from "./ShadowStackEditor";
import { ManualBindEditor } from "./ManualBindEditor";
import { FontFamilyPicker } from "./FontFamilyPicker";
import type { UploadedFontMeta } from "./FontFamilyPicker";
import { ScenePropertiesDrawer } from "./ScenePropertiesDrawer";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

type TabKey = "style" | "transform" | "binding" | "animation";

const FONT_WEIGHTS = [400, 500, 600, 700, 800] as const;

const ANIM_TYPES = [
  "fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
  "scale",
  "rotate",
  "bounce",
  "pulse",
  "glow",
  "shake",
  "flip",
  "custom-css",
] as const;

const EASINGS = [
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "cubic-bezier(.34,1.56,.64,1)",
] as const;

// Which tabs are shown per element type. group has no Style (future-proof).
const TABS_BY_TYPE: Record<ElementType, TabKey[]> = {
  rect: ["style", "transform", "animation"],
  ellipse: ["style", "transform", "animation"],
  line: ["style", "transform", "animation"],
  polygon: ["style", "transform", "animation"],
  path: ["style", "transform", "animation"],
  text: ["style", "transform", "binding", "animation"],
  image: ["style", "transform", "binding", "animation"],
  "psd-layer": ["style", "transform", "animation"],
  "data-slot": ["style", "transform", "binding", "animation"],
  group: ["transform", "animation"],
};

// ─────────────────────────────────────────────────────────────
// PropertiesPanel
// ─────────────────────────────────────────────────────────────

export function PropertiesPanel({
  uploadedFonts = [],
}: {
  uploadedFonts?: UploadedFontMeta[];
} = {}) {
  const design = useBuilderStore((s) => s.design);
  const selectedIds = useBuilderStore((s) => s.selectedElementIds);
  const updateElement = useBuilderStore((s) => s.updateElement);
  const groupElements = useBuilderStore((s) => s.groupElements);
  const ungroupElements = useBuilderStore((s) => s.ungroupElements);
  const mode = useBuilderStore((s) => s.design?.mode);
  const showSceneDrawer = selectedIds.length === 0 && mode === "sequence";

  // Single-select for Wave 1A.
  const selected = (() => {
    if (!design || selectedIds.length === 0) return null;
    const id = selectedIds[0];
    for (const sc of design.scenes) {
      const found = sc.elements.find((e) => e.id === id);
      if (found) return found;
    }
    return null;
  })();

  const tabs = selected ? TABS_BY_TYPE[selected.elementType] : [];

  const [activeTab, setActiveTab] = useState<TabKey>("style");
  // Clamp to valid tab set (e.g. if tab was "binding" and user now selects a rect).
  const safeTab: TabKey = tabs.includes(activeTab) ? activeTab : (tabs[0] ?? "style");

  if (!selected) {
    return (
      <aside
        aria-label="Properties"
        data-testid="properties-panel"
        data-state="empty"
        className="flex w-[340px] shrink-0 flex-col border-l border-white/10 bg-zinc-950"
      >
        {showSceneDrawer && <ScenePropertiesDrawer />}
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-white/40">
          Select an element to edit its properties.
        </div>
      </aside>
    );
  }

  const patch = (p: Partial<Element>) => updateElement(selected.id, p);

  const patchStyle = (s: Record<string, unknown>) =>
    patch({ style: { ...(selected.style ?? {}), ...s } } as Partial<Element>);

  const patchContent = (c: Record<string, unknown>) =>
    patch({ content: { ...(selected.content ?? {}), ...c } } as Partial<Element>);

  const patchTransform = (t: Partial<Element["transform"]>) =>
    patch({ transform: { ...selected.transform, ...t } } as Partial<Element>);

  return (
    <aside
      aria-label="Properties"
      data-testid="properties-panel"
      data-state="active"
      data-element-type={selected.elementType}
      className="flex w-[340px] shrink-0 flex-col border-l border-white/10 bg-zinc-950"
    >
      {/* Wave 1C — Group / Ungroup action row */}
      {selectedIds.length > 1 && (
        <div className="flex gap-2 border-b border-white/10 px-3 py-2">
          <button
            type="button"
            data-testid="properties-group"
            onClick={() => groupElements(selectedIds)}
            className="flex-1 rounded bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
          >
            Group
          </button>
        </div>
      )}
      {selectedIds.length === 1 && selected?.elementType === "group" && (
        <div className="flex gap-2 border-b border-white/10 px-3 py-2">
          <button
            type="button"
            data-testid="properties-ungroup"
            onClick={() => ungroupElements(selectedIds[0])}
            className="flex-1 rounded bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
          >
            Ungroup
          </button>
        </div>
      )}
      {/* Tab bar */}
      <div role="tablist" className="flex border-b border-white/10">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            data-testid={`properties-tab-${t}`}
            aria-selected={safeTab === t}
            onClick={() => setActiveTab(t)}
            className={`flex-1 px-2 py-2 text-xs uppercase tracking-wider transition ${
              safeTab === t
                ? "bg-white/5 text-[#6bcd06]"
                : "text-white/50 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        {safeTab === "style" && (
          <StyleTab
            element={selected}
            patchStyle={patchStyle}
            patchContent={patchContent}
            uploadedFonts={uploadedFonts}
          />
        )}
        {safeTab === "transform" && (
          <TransformTab element={selected} patchTransform={patchTransform} />
        )}
        {safeTab === "binding" && (
          <BindingTab
            element={selected}
            patch={patch}
            clear={() => patch({ binding: undefined } as Partial<Element>)}
          />
        )}
        {safeTab === "animation" && (
          <AnimationTab element={selected} patch={patch} />
        )}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared field components
// ─────────────────────────────────────────────────────────────

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  testId,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  testId?: string;
}) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-white/50">
        {label}
      </span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        aria-label={label}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
      />
    </label>
  );
}

function ColorField({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="mb-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-white/50">{label}</p>
      <HexColorPicker color={value} onChange={onChange} />
      <label className="mt-2 block">
        <span className="sr-only">{ariaLabel}</span>
        <input
          type="text"
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
        />
      </label>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Style tab — branches per element_type
// ─────────────────────────────────────────────────────────────

function StyleTab({
  element,
  patchStyle,
  patchContent,
  uploadedFonts = [],
}: {
  element: Element;
  patchStyle: (s: Record<string, unknown>) => void;
  patchContent: (c: Record<string, unknown>) => void;
  uploadedFonts?: UploadedFontMeta[];
}) {
  const s = element.style ?? {};

  if (element.elementType === "rect") {
    return (
      <div>
        <ColorField
          label="Fill"
          ariaLabel="Fill hex"
          value={(s.fill as string) ?? "#cccccc"}
          onChange={(c) => patchStyle({ fill: c })}
        />
        <ColorField
          label="Stroke"
          ariaLabel="Stroke hex"
          value={(s.stroke as string) ?? "#000000"}
          onChange={(c) => patchStyle({ stroke: c })}
        />
        <NumberField
          label="Stroke width"
          value={(s.strokeWidth as number) ?? 0}
          onChange={(n) => patchStyle({ strokeWidth: n })}
        />
        <NumberField
          label="Corner radius"
          value={(s.cornerRadius as number) ?? 0}
          onChange={(n) => patchStyle({ cornerRadius: n })}
        />

        {/* Wave 1B — gradient editor (replaces solid fill when set) */}
        <p className="mt-4 mb-2 text-xs uppercase tracking-wider text-white/50">Gradient</p>
        <GradientEditor
          value={(s as { gradient?: import("@/server/overlays/builder/types").GradientSpec }).gradient}
          onChange={(g) => patchStyle({ gradient: g })}
        />

        {/* Wave 1B — filter sliders */}
        <p className="mt-4 mb-2 text-xs uppercase tracking-wider text-white/50">Filter</p>
        <FilterEditor
          value={(s as { filter?: import("@/server/overlays/builder/types").FilterSpec }).filter}
          onChange={(f) => patchStyle({ filter: f })}
        />

        {/* Wave 1B — multi-stack shadow editor */}
        <p className="mt-4 mb-2 text-xs uppercase tracking-wider text-white/50">Shadows</p>
        <ShadowStackEditor
          value={
            (s as { shadows?: import("@/server/overlays/builder/types").ShadowSpec[]; shadow?: import("@/server/overlays/builder/types").ShadowSpec }).shadows ??
            (s as { shadow?: import("@/server/overlays/builder/types").ShadowSpec }).shadow
          }
          onChange={(stack) => patchStyle({ shadows: stack, shadow: undefined })}
        />
      </div>
    );
  }

  if (element.elementType === "text") {
    return (
      <div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-white/50">
            Text content
          </span>
          <textarea
            aria-label="Text content"
            data-testid="properties-text-content"
            rows={3}
            value={(element.content?.text as string) ?? ""}
            onChange={(e) => patchContent({ text: e.target.value })}
            className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
          />
        </label>

        <ColorField
          label="Color"
          ariaLabel="Text color hex"
          value={(s.color as string) ?? "#ffffff"}
          onChange={(c) => patchStyle({ color: c })}
        />

        <label className="mt-2 block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Font family</span>
          <FontFamilyPicker
            value={(s.fontFamily as string) ?? "Agharti"}
            uploaded={uploadedFonts}
            onChange={(f) => patchStyle({ fontFamily: f })}
          />
        </label>

        <NumberField
          label="Font size"
          testId="properties-text-fontsize"
          value={(s.fontSize as number) ?? 32}
          onChange={(n) => patchStyle({ fontSize: n })}
        />

        <label className="mb-2 block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-white/50">
            Font weight
          </span>
          <select
            aria-label="Font weight"
            value={(s.fontWeight as number) ?? 600}
            onChange={(e) => patchStyle({ fontWeight: Number(e.target.value) })}
            className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
          >
            {FONT_WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-2 block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-white/50">
            Font style
          </span>
          <div className="flex gap-2">
            {(["normal", "italic"] as const).map((fs) => (
              <label key={fs} className="flex items-center gap-1 text-sm text-white/70">
                <input
                  type="radio"
                  name={`fontStyle-${element.id}`}
                  value={fs}
                  checked={((s.fontStyle as string) ?? "normal") === fs}
                  onChange={() => patchStyle({ fontStyle: fs })}
                />
                {fs}
              </label>
            ))}
          </div>
        </label>

        <label className="mb-2 block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-white/50">
            Text align
          </span>
          <div className="flex gap-2">
            {(["left", "center", "right"] as const).map((ta) => (
              <label key={ta} className="flex items-center gap-1 text-sm text-white/70">
                <input
                  type="radio"
                  name={`textAlign-${element.id}`}
                  value={ta}
                  checked={((s.textAlign as string) ?? "left") === ta}
                  onChange={() => patchStyle({ textAlign: ta })}
                />
                {ta}
              </label>
            ))}
          </div>
        </label>
      </div>
    );
  }

  if (element.elementType === "image") {
    return (
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-white/50">Asset ID</p>
        <p className="mb-3 break-all rounded bg-white/5 px-2 py-1 text-sm text-white/80">
          {(element.content?.assetId as string) ?? "—"}
        </p>
        <label className="mb-2 block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-white/50">
            Image fit
          </span>
          <select
            aria-label="Image fit"
            value={(element.content?.imageFit as string) ?? "cover"}
            onChange={(e) => patchContent({ imageFit: e.target.value })}
            className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
          >
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
            <option value="fill">Fill</option>
          </select>
        </label>
      </div>
    );
  }

  return (
    <p className="text-sm text-white/40">
      No style controls for this element type.
    </p>
  );
}

// ─────────────────────────────────────────────────────────────
// Transform tab — universal
// ─────────────────────────────────────────────────────────────

function TransformTab({
  element,
  patchTransform,
}: {
  element: Element;
  patchTransform: (t: Partial<Element["transform"]>) => void;
}) {
  const t = element.transform;
  return (
    <div>
      <NumberField label="X" value={t.x} onChange={(n) => patchTransform({ x: n })} />
      <NumberField label="Y" value={t.y} onChange={(n) => patchTransform({ y: n })} />
      <NumberField
        label="Width"
        value={t.width}
        onChange={(n) => patchTransform({ width: n })}
      />
      <NumberField
        label="Height"
        value={t.height}
        onChange={(n) => patchTransform({ height: n })}
      />

      <label className="mb-2 block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-white/50">
          Rotation ({t.rotation ?? 0}°)
        </span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          aria-label="Rotation"
          value={t.rotation ?? 0}
          onChange={(e) => patchTransform({ rotation: Number(e.target.value) })}
          className="w-full"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-white/50">
          Opacity ({t.opacity ?? 1})
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          aria-label="Opacity"
          value={t.opacity ?? 1}
          onChange={(e) => patchTransform({ opacity: Number(e.target.value) })}
          className="w-full"
        />
      </label>

      <NumberField
        label="Scale X"
        value={t.scaleX ?? 1}
        step={0.1}
        onChange={(n) => patchTransform({ scaleX: n })}
      />
      <NumberField
        label="Scale Y"
        value={t.scaleY ?? 1}
        step={0.1}
        onChange={(n) => patchTransform({ scaleY: n })}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Binding tab — manual free-form editor (Wave 1B)
// ─────────────────────────────────────────────────────────────

function BindingTab({
  element,
  patch,
  clear,
}: {
  element: Element;
  patch: (p: Partial<Element>) => void;
  clear: () => void;
}) {
  return (
    <ManualBindEditor
      value={element.binding ?? null}
      onChange={(b) => patch({ binding: b } as Partial<Element>)}
      onClear={clear}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// Animation tab — Entry / Exit / Loop phases
//
// Wave 3B (Task 5) adds a per-phase Preset / Advanced pill toggle.
// Advanced mode is auto-detected when `advancedTimeline` is populated
// — the toggle flips and the preset dropdown grays out. Switching to
// Advanced reveals an "Open Timeline" button that toggles the bottom
// TimelinePanel via the store (TimelinePanel shell lands in Task 6).
// ─────────────────────────────────────────────────────────────

type AnimPhase = "entry" | "exit" | "loop";

function AnimationTab({
  element,
  patch,
}: {
  element: Element;
  patch: (p: Partial<Element>) => void;
}) {
  return (
    <div>
      {(["entry", "exit", "loop"] as const).map((phase) => (
        <PhaseBlock key={phase} phase={phase} element={element} patch={patch} />
      ))}
    </div>
  );
}

function PhaseBlock({
  phase,
  element,
  patch,
}: {
  phase: AnimPhase;
  element: Element;
  patch: (p: Partial<Element>) => void;
}) {
  const setMode = useBuilderStore((s) => s.setElementAnimationMode);
  const toggleTimeline = useBuilderStore((s) => s.toggleTimelinePanel);

  const a = element.animation ?? {};
  const v = a[phase];
  const enabled = Boolean(v?.type);
  const isAdvanced = (v?.advancedTimeline?.length ?? 0) > 0;

  // Effective phase config — fall back to defaults when unset so the
  // type select is always operable. Selecting a non-empty type promotes
  // the phase from "disabled" to "enabled" without a separate checkbox
  // step (e2e flow + UX cleanup, 2026-05-18).
  //
  // `type` lives in the `AnimType` zod-narrowed enum at the canonical
  // boundary, but inside this component we widen to string so the
  // controlled <select> can carry an empty-string placeholder ("none")
  // for the disabled state. The patch path re-narrows by stripping
  // the phase entirely when type is empty.
  const effective: { type: string; durationMs: number; delayMs: number; easing: string } =
    v ?? {
      type: "",
      durationMs: 400,
      delayMs: 0,
      easing: "ease-out",
    };

  function patchPhase(p: Partial<typeof effective>) {
    const next = { ...a };
    const merged = { ...effective, ...p };
    if (!merged.type) {
      delete next[phase];
    } else {
      // Cast back to PresetAnim — the merged.type is a runtime string
      // but the union-narrowing happens at the schema boundary on save.
      next[phase] = merged as unknown as NonNullable<Element["animation"]>[AnimPhase];
    }
    patch({ animation: next } as Partial<Element>);
  }

  return (
    <section
      data-testid={`anim-phase-${phase}`}
      data-enabled={enabled}
      className="mb-4 border-b border-white/5 pb-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label={`Enable ${phase}`}
            data-testid={`animation-${phase}-enabled`}
            checked={enabled}
            onChange={(e) => {
              if (e.target.checked) {
                patchPhase({ type: "fade" });
              } else {
                patchPhase({ type: "" });
              }
            }}
          />
          <span className="text-xs uppercase tracking-wide text-white/50">
            {phase}
          </span>
        </label>

        {enabled && (
          <div
            className="inline-flex rounded bg-white/5 p-0.5"
            role="group"
            aria-label={`${phase} animation mode`}
          >
            <button
              type="button"
              data-active={!isAdvanced}
              aria-pressed={!isAdvanced}
              onClick={() => setMode(element.id, phase, "preset")}
              className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide transition ${
                !isAdvanced
                  ? "bg-white/15 text-[#6bcd06]"
                  : "text-white/40 hover:text-white"
              }`}
            >
              Preset
            </button>
            <button
              type="button"
              data-active={isAdvanced}
              aria-pressed={isAdvanced}
              onClick={() => setMode(element.id, phase, "advanced")}
              className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide transition ${
                isAdvanced
                  ? "bg-white/15 text-[#6bcd06]"
                  : "text-white/40 hover:text-white"
              }`}
            >
              Advanced
            </button>
          </div>
        )}
      </div>

      <label className="mb-2 block">
        <span className="sr-only">{phase} type</span>
        <select
          aria-label={`${phase} type`}
          data-testid={`animation-${phase}-type`}
          value={effective.type}
          disabled={isAdvanced}
          onChange={(e) => patchPhase({ type: e.target.value })}
          className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <option value="">(none)</option>
          {ANIM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <fieldset
        disabled={isAdvanced || !enabled}
        className="contents disabled:opacity-40"
      >
        <NumberField
          label="Duration ms"
          testId={`animation-${phase}-duration`}
          value={effective.durationMs ?? 400}
          onChange={(n) => patchPhase({ durationMs: n })}
        />

        <NumberField
          label="Delay ms"
          testId={`animation-${phase}-delay`}
          value={effective.delayMs ?? 0}
          onChange={(n) => patchPhase({ delayMs: n })}
        />

        <label className="mb-2 block">
          <span className="sr-only">{phase} easing</span>
          <select
            aria-label={`${phase} easing`}
            data-testid={`animation-${phase}-easing`}
            value={effective.easing ?? "ease-out"}
            disabled={isAdvanced || !enabled}
            onChange={(e) => patchPhase({ easing: e.target.value })}
            className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {EASINGS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {isAdvanced && (
        <button
          type="button"
          data-testid={`animation-${phase}-open-timeline`}
          onClick={toggleTimeline}
          className="mt-1 w-full rounded bg-[#6bcd06] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-black hover:bg-[#7be018]"
        >
          Open Timeline
        </button>
      )}
    </section>
  );
}
