"use client";

import { HexColorPicker } from "react-colorful";
import type { ShadowSpec } from "@/server/overlays/builder/types";

const MAX_SHADOWS = 8;

const DEFAULT: ShadowSpec = {
  offsetX: 0,
  offsetY: 2,
  blur: 4,
  color: "#000000",
  opacity: 0.5,
};

function toArray(value: ShadowSpec | ShadowSpec[] | undefined): ShadowSpec[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function ShadowStackEditor({
  value,
  onChange,
}: {
  value: ShadowSpec[] | ShadowSpec | undefined;
  onChange: (next: ShadowSpec[] | undefined) => void;
}) {
  const shadows = toArray(value);

  function add() {
    if (shadows.length >= MAX_SHADOWS) return;
    onChange([...shadows, { ...DEFAULT }]);
  }

  function remove(i: number) {
    const next = shadows.filter((_, j) => j !== i);
    onChange(next.length > 0 ? next : undefined);
  }

  function patch(i: number, p: Partial<ShadowSpec>) {
    const next = shadows.map((s, j) => (i === j ? { ...s, ...p } : s));
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={add}
        disabled={shadows.length >= MAX_SHADOWS}
        className="rounded border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
      >
        Add shadow ({shadows.length}/{MAX_SHADOWS})
      </button>
      {shadows.map((sh, i) => (
        <div key={i} className="rounded border border-white/10 p-3 text-xs text-white">
          <p className="mb-1 uppercase tracking-wider text-white/50">Shadow {i + 1}</p>
          <HexColorPicker
            color={sh.color}
            onChange={(c) => patch(i, { color: c })}
          />
          <label className="mt-2 block">
            <span className="mb-1 block text-white/50">Shadow {i + 1} Offset X</span>
            <input
              type="number"
              aria-label={`Shadow ${i + 1} offset X`}
              value={sh.offsetX}
              onChange={(e) => patch(i, { offsetX: Number(e.target.value) })}
              className="w-full rounded border border-white/15 bg-black px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-white/50">Shadow {i + 1} Offset Y</span>
            <input
              type="number"
              aria-label={`Shadow ${i + 1} offset Y`}
              value={sh.offsetY}
              onChange={(e) => patch(i, { offsetY: Number(e.target.value) })}
              className="w-full rounded border border-white/15 bg-black px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-white/50">Shadow {i + 1} Blur</span>
            <input
              type="number"
              aria-label={`Shadow ${i + 1} blur`}
              min={0}
              value={sh.blur}
              onChange={(e) => patch(i, { blur: Math.max(0, Number(e.target.value)) })}
              className="w-full rounded border border-white/15 bg-black px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-white/50">Shadow {i + 1} Opacity</span>
            <input
              type="range"
              aria-label={`Shadow ${i + 1} opacity`}
              min={0}
              max={1}
              step={0.01}
              value={sh.opacity}
              onChange={(e) => patch(i, { opacity: Number(e.target.value) })}
              className="w-full"
            />
          </label>
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={`Remove shadow ${i + 1}`}
            className="mt-2 text-xs text-rose-400 hover:underline"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
