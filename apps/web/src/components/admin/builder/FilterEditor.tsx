"use client";

import type { FilterSpec } from "@/server/overlays/builder/types";

export function FilterEditor({
  value,
  onChange,
}: {
  value: FilterSpec | undefined;
  onChange: (next: FilterSpec | undefined) => void;
}) {
  const v = value ?? {};

  function patch(next: Partial<FilterSpec>) {
    const merged = { ...v, ...next };
    const cleaned = Object.fromEntries(
      Object.entries(merged).filter(
        ([, val]) => typeof val === "number" && !Number.isNaN(val),
      ),
    ) as FilterSpec;
    if (Object.keys(cleaned).length === 0) {
      onChange(undefined);
      return;
    }
    onChange(cleaned);
  }

  function reset() {
    onChange(undefined);
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Blur</span>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          aria-label="Blur"
          value={v.blur ?? 0}
          onChange={(e) => patch({ blur: Number(e.target.value) })}
          className="w-full"
        />
        <span className="block text-xs text-white/40">{v.blur ?? 0}px</span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Brightness</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          aria-label="Brightness"
          value={v.brightness ?? 1}
          onChange={(e) => patch({ brightness: Number(e.target.value) })}
          className="w-full"
        />
        <span className="block text-xs text-white/40">{(v.brightness ?? 1).toFixed(2)}</span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Hue Rotate</span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          aria-label="Hue Rotate"
          value={v.hueRotate ?? 0}
          onChange={(e) => patch({ hueRotate: Number(e.target.value) })}
          className="w-full"
        />
        <span className="block text-xs text-white/40">{v.hueRotate ?? 0}deg</span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Saturate</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          aria-label="Saturate"
          value={v.saturate ?? 1}
          onChange={(e) => patch({ saturate: Number(e.target.value) })}
          className="w-full"
        />
        <span className="block text-xs text-white/40">{(v.saturate ?? 1).toFixed(2)}</span>
      </label>

      <button
        type="button"
        onClick={reset}
        className="text-xs text-rose-400 hover:underline"
      >
        Reset filters
      </button>
    </div>
  );
}
