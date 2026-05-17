"use client";

import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import { useBuilderStore } from "@/state/builder/store";
import type { Element, ElementType } from "@/server/overlays/builder/types";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

type TabKey = "style" | "transform" | "binding" | "animation";

const FONT_FAMILIES = ["Agharti", "Quedora", "Inter", "JetBrains Mono"] as const;
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

export function PropertiesPanel() {
  const design = useBuilderStore((s) => s.design);
  const selectedIds = useBuilderStore((s) => s.selectedElementIds);
  const updateElement = useBuilderStore((s) => s.updateElement);

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
        className="flex w-[340px] shrink-0 items-center justify-center border-l border-white/10 bg-zinc-950 p-6 text-sm text-white/40"
      >
        Select an element to edit its properties.
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
      className="flex w-[340px] shrink-0 flex-col border-l border-white/10 bg-zinc-950"
    >
      {/* Tab bar */}
      <div role="tablist" className="flex border-b border-white/10">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
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
          />
        )}
        {safeTab === "transform" && (
          <TransformTab element={selected} patchTransform={patchTransform} />
        )}
        {safeTab === "binding" && (
          <BindingTab
            element={selected}
            clear={() =>
              patch({ binding: null } as Partial<Element>)
            }
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
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
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
}: {
  element: Element;
  patchStyle: (s: Record<string, unknown>) => void;
  patchContent: (c: Record<string, unknown>) => void;
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
        {/* Shadow controls */}
        <ShadowSection
          shadow={s.shadow as ShadowValue | undefined}
          onShadow={(sh) => patchStyle({ shadow: sh })}
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

        <label className="mb-2 block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-white/50">
            Font family
          </span>
          <select
            aria-label="Font family"
            value={(s.fontFamily as string) ?? "Agharti"}
            onChange={(e) => patchStyle({ fontFamily: e.target.value })}
            className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <NumberField
          label="Font size"
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
// Shadow sub-section (used by rect style tab)
// ─────────────────────────────────────────────────────────────

type ShadowValue = {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
  opacity: number;
};

const DEFAULT_SHADOW: ShadowValue = {
  offsetX: 4,
  offsetY: 4,
  blur: 8,
  color: "#000000",
  opacity: 0.5,
};

function ShadowSection({
  shadow,
  onShadow,
}: {
  shadow: ShadowValue | undefined;
  onShadow: (v: ShadowValue | undefined) => void;
}) {
  const enabled = Boolean(shadow);
  const sv = shadow ?? DEFAULT_SHADOW;

  return (
    <div className="mt-2 border-t border-white/5 pt-3">
      <label className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-white/50">
        <input
          type="checkbox"
          aria-label="Enable shadow"
          checked={enabled}
          onChange={(e) => onShadow(e.target.checked ? DEFAULT_SHADOW : undefined)}
        />
        Shadow
      </label>
      {enabled && (
        <>
          <NumberField
            label="Offset X"
            value={sv.offsetX}
            onChange={(n) => onShadow({ ...sv, offsetX: n })}
          />
          <NumberField
            label="Offset Y"
            value={sv.offsetY}
            onChange={(n) => onShadow({ ...sv, offsetY: n })}
          />
          <NumberField
            label="Blur"
            value={sv.blur}
            onChange={(n) => onShadow({ ...sv, blur: n })}
          />
          <ColorField
            label="Shadow color"
            ariaLabel="Shadow color hex"
            value={sv.color}
            onChange={(c) => onShadow({ ...sv, color: c })}
          />
          <NumberField
            label="Shadow opacity"
            value={sv.opacity}
            step={0.05}
            onChange={(n) => onShadow({ ...sv, opacity: n })}
          />
        </>
      )}
    </div>
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
// Binding tab — read-only + clear (Wave 1A; manual bind in Wave 1B)
// ─────────────────────────────────────────────────────────────

function BindingTab({
  element,
  clear,
}: {
  element: Element;
  clear: () => void;
}) {
  const b = element.binding;
  return (
    <div>
      {b ? (
        <>
          <p className="mb-1 text-xs uppercase tracking-wide text-white/50">Feed</p>
          <p className="mb-3 text-sm text-white/80">{b.feed}</p>

          <p className="mb-1 text-xs uppercase tracking-wide text-white/50">Field path</p>
          <p className="mb-3 break-all text-sm text-white/80">{b.fieldPath}</p>

          {b.templateString && (
            <>
              <p className="mb-1 text-xs uppercase tracking-wide text-white/50">
                Template
              </p>
              <p className="mb-3 break-all text-sm text-white/80">{b.templateString}</p>
            </>
          )}

          <button
            type="button"
            onClick={clear}
            className="rounded border border-rose-500/40 px-3 py-1 text-sm text-rose-400 hover:bg-rose-500/10"
          >
            Clear binding
          </button>
        </>
      ) : (
        <p className="text-sm text-white/40">
          No binding attached. Use the Data Slots panel (toolbar) to attach one.
          Manual bind UI ships in Wave 1B.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Animation tab — Entry / Exit / Loop phases
// ─────────────────────────────────────────────────────────────

function AnimationTab({
  element,
  patch,
}: {
  element: Element;
  patch: (p: Partial<Element>) => void;
}) {
  const a = element.animation ?? {};

  return (
    <div>
      {(["entry", "exit", "loop"] as const).map((phase) => {
        const enabled = Boolean(a[phase]?.type);
        const v = a[phase];

        return (
          <section key={phase} className="mb-4 border-b border-white/5 pb-3">
            <label className="mb-2 flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Enable ${phase}`}
                checked={enabled}
                onChange={(e) => {
                  const next = { ...a };
                  if (e.target.checked) {
                    next[phase] = {
                      type: "fade",
                      durationMs: 400,
                      delayMs: 0,
                      easing: "ease-out",
                    };
                  } else {
                    delete next[phase];
                  }
                  patch({ animation: next } as Partial<Element>);
                }}
              />
              <span className="text-xs uppercase tracking-wide text-white/50">
                {phase}
              </span>
            </label>

            {enabled && v && (
              <>
                <label className="mb-2 block">
                  <span className="sr-only">{phase} type</span>
                  <select
                    aria-label={`${phase} type`}
                    value={v.type}
                    onChange={(e) =>
                      patch({
                        animation: { ...a, [phase]: { ...v, type: e.target.value } },
                      } as Partial<Element>)
                    }
                    className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
                  >
                    {ANIM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>

                <NumberField
                  label="Duration ms"
                  value={v.durationMs ?? 400}
                  onChange={(n) =>
                    patch({
                      animation: { ...a, [phase]: { ...v, durationMs: n } },
                    } as Partial<Element>)
                  }
                />

                <NumberField
                  label="Delay ms"
                  value={v.delayMs ?? 0}
                  onChange={(n) =>
                    patch({
                      animation: { ...a, [phase]: { ...v, delayMs: n } },
                    } as Partial<Element>)
                  }
                />

                <label className="mb-2 block">
                  <span className="sr-only">{phase} easing</span>
                  <select
                    aria-label={`${phase} easing`}
                    value={v.easing ?? "ease-out"}
                    onChange={(e) =>
                      patch({
                        animation: { ...a, [phase]: { ...v, easing: e.target.value } },
                      } as Partial<Element>)
                    }
                    className="w-full rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
                  >
                    {EASINGS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
