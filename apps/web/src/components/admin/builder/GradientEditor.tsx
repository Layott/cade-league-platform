"use client";

import { HexColorPicker } from "react-colorful";
import type { GradientSpec, GradientStop } from "@/server/overlays/builder/types";

const DEFAULT_LINEAR: GradientSpec = {
  kind: "linear",
  angle: 90,
  stops: [
    { offset: 0, color: "#6bcd06" },
    { offset: 1, color: "#fe036d" },
  ],
};

const DEFAULT_RADIAL: GradientSpec = {
  kind: "radial",
  cx: 0.5,
  cy: 0.5,
  radius: 0.5,
  stops: [
    { offset: 0, color: "#ffffff" },
    { offset: 1, color: "#050505" },
  ],
};

export function GradientEditor({
  value,
  onChange,
}: {
  value: GradientSpec | undefined;
  onChange: (next: GradientSpec | undefined) => void;
}) {
  const kind = value?.kind ?? "none";

  function patchStop(i: number, next: Partial<GradientStop>) {
    if (!value) return;
    const stops = value.stops.map((s, j) => (i === j ? { ...s, ...next } : s));
    onChange({ ...value, stops } as GradientSpec);
  }

  function addStop() {
    if (!value) return;
    const last = value.stops[value.stops.length - 1];
    const prev = value.stops[value.stops.length - 2] ?? value.stops[0];
    const mid = (last.offset + prev.offset) / 2;
    const newStop: GradientStop = { offset: mid, color: "#888888" };
    onChange({ ...value, stops: [...value.stops, newStop] } as GradientSpec);
  }

  function removeStop(i: number) {
    if (!value || value.stops.length <= 2) return;
    const stops = value.stops.filter((_, j) => j !== i);
    onChange({ ...value, stops } as GradientSpec);
  }

  function setKind(next: "none" | "linear" | "radial") {
    if (next === "none") return onChange(undefined);
    if (next === "linear") return onChange({ ...DEFAULT_LINEAR });
    return onChange({ ...DEFAULT_RADIAL });
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Gradient kind" className="flex gap-3 text-xs">
        {(["none", "linear", "radial"] as const).map((k) => (
          <label key={k} className="flex items-center gap-1 capitalize">
            <input
              type="radio"
              aria-label={k}
              checked={kind === k}
              onChange={() => setKind(k)}
            />
            <span>{k}</span>
          </label>
        ))}
      </div>

      {value && value.kind === "linear" && (
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">Angle</span>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            aria-label="Angle"
            value={value.angle}
            onChange={(e) => onChange({ ...value, angle: Number(e.target.value) })}
            className="w-full"
          />
          <span className="block text-xs text-white/40">{value.angle}deg</span>
        </label>
      )}

      {value && value.kind === "radial" && (
        <div className="space-y-2">
          {(["cx", "cy", "radius"] as const).map((axis) => (
            <label key={axis} className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">
                {axis}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                aria-label={axis}
                value={value[axis]}
                onChange={(e) =>
                  onChange({ ...value, [axis]: Number(e.target.value) } as GradientSpec)
                }
                className="w-full"
              />
              <span className="block text-xs text-white/40">{value[axis].toFixed(2)}</span>
            </label>
          ))}
        </div>
      )}

      {value && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-white/50">Stops</span>
            <button
              type="button"
              onClick={addStop}
              className="rounded border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
            >
              Add stop
            </button>
          </div>
          {value.stops.map((stop, i) => (
            <div key={i} className="rounded border border-white/10 p-2">
              <HexColorPicker
                color={stop.color}
                onChange={(c) => patchStop(i, { color: c })}
              />
              <label className="mt-2 block">
                <span className="mb-1 block text-xs uppercase tracking-wider text-white/50">
                  Offset
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  aria-label={`Stop ${i + 1} offset`}
                  value={stop.offset}
                  onChange={(e) => patchStop(i, { offset: Number(e.target.value) })}
                  className="w-full"
                />
                <span className="block text-xs text-white/40">{stop.offset.toFixed(2)}</span>
              </label>
              {value.stops.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeStop(i)}
                  className="mt-1 text-xs text-rose-400 hover:underline"
                >
                  Remove stop
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
