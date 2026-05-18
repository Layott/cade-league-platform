"use client";

import { useEffect, useState, useMemo } from "react";
import { useBuilderStore } from "@/state/builder/store";
import { DATA_SLOTS_CATALOG } from "@/server/overlays/builder/data-slots-catalog";
import type { DataSlotPreset } from "@/server/overlays/builder/data-slots-catalog";
import type { Element } from "@/server/overlays/builder/types";

/**
 * Wave 1A — slide-out data slots drawer.
 *
 * Opens on the `builder:open-data-slots` window event dispatched by the
 * Toolbar (Task 23). Renders DATA_SLOTS_CATALOG presets grouped by feed
 * category. Click a preset → insert a pre-styled, pre-bound element at
 * canvas centre via zustand `addElement`, auto-select it, and close the
 * drawer.
 */
export function DataSlotsPanel() {
  const [open, setOpen] = useState(false);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const addElement = useBuilderStore((s) => s.addElement);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("builder:open-data-slots", handler);
    return () => window.removeEventListener("builder:open-data-slots", handler);
  }, []);

  // Group presets by category preserving insertion order.
  const grouped = useMemo(() => {
    const map = new Map<string, DataSlotPreset[]>();
    for (const slot of DATA_SLOTS_CATALOG) {
      const list = map.get(slot.category) ?? [];
      list.push(slot);
      map.set(slot.category, list);
    }
    return Array.from(map.entries());
  }, []);

  function insert(preset: DataSlotPreset) {
    if (!activeSceneId) return;
    const defaults: Partial<Omit<Element, "id" | "elementType" | "sceneId">> =
      {
        transform: {
          x: 860,
          y: 490,
          width: 240,
          height: 80,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
        },
        style: preset.defaultStyle,
        binding: preset.binding,
        content:
          preset.defaultElementType === "text" ? { text: preset.label } : {},
        zIndex: 0,
      };
    addElement(activeSceneId, preset.defaultElementType, defaults);
    setOpen(false);
  }

  return (
    <div
      data-state={open ? "open" : "closed"}
      data-testid="data-slot-picker-modal"
      aria-hidden={!open}
      className={`fixed inset-y-0 left-16 z-40 w-80 transform border-r border-white/10 bg-zinc-950 transition-transform ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <header className="flex h-9 items-center justify-between border-b border-white/10 px-3">
        <span className="text-xs uppercase tracking-wider text-white/60">
          Data Slots
        </span>
        <button
          type="button"
          aria-label="Close data slots"
          data-testid="data-slot-picker-close"
          onClick={() => setOpen(false)}
          className="text-white/50 hover:text-white"
        >
          ×
        </button>
      </header>

      <div className="h-[calc(100%-2.25rem)] overflow-auto p-2">
        {grouped.map(([cat, slots]) => (
          <section
            key={cat}
            data-testid={`data-slot-feed-${cat.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            className="mb-3"
          >
            <h3 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider text-[#6bcd06]">
              {cat}
            </h3>
            <ul className="space-y-1">
              {slots.map((slot) => (
                <li key={slot.id}>
                  <button
                    type="button"
                    data-testid={`data-slot-field-${slot.id}`}
                    onClick={() => insert(slot)}
                    className="w-full rounded border border-white/10 bg-black px-2 py-2 text-left text-sm text-white/80 transition hover:border-[#6bcd06]/40 hover:text-white"
                  >
                    {slot.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
