"use client";

import { useEffect, useRef } from "react";
import { useBuilderStore } from "@/state/builder/store";
import { updateSceneAction } from "@/app/admin/broadcast/v2/builder/actions";

const TRANSITIONS = [
  "cut",
  "fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
] as const;

export function ScenePropertiesDrawer() {
  const design = useBuilderStore((s) => s.design);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const updateSceneLocal = useBuilderStore((s) => s.updateScene);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  if (!design || !activeSceneId) return null;
  const scene = design.scenes.find((s) => s.id === activeSceneId);
  if (!scene) return null;

  function debouncedSync(
    patch: Partial<{
      name: string | null;
      durationMs: number;
      transitionIn: (typeof TRANSITIONS)[number];
      transitionOut: (typeof TRANSITIONS)[number];
    }>,
  ) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updateSceneAction({
        sceneId: activeSceneId!,
        designSlug: design!.slug,
        patch,
      }).catch((err) => {
        console.error("updateScene sync failed", err);
      });
    }, 500);
  }

  return (
    <section
      aria-label="Scene properties"
      className="flex flex-col gap-3 border-b border-white/10 bg-zinc-950 p-3 text-sm text-white/80"
    >
      <h3 className="text-xs uppercase tracking-wider text-white/40">
        Scene properties
      </h3>
      <label className="flex flex-col gap-1">
        <span>Scene name</span>
        <input
          aria-label="Scene name"
          type="text"
          value={scene.name ?? ""}
          onChange={(e) => {
            const v = e.target.value || null;
            updateSceneLocal(activeSceneId!, { name: v });
            debouncedSync({ name: v });
          }}
          className="rounded border border-white/15 bg-black px-2 py-1 text-white"
          placeholder={`Scene ${scene.orderIndex + 1}`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>Duration (seconds)</span>
        <input
          aria-label="Duration"
          type="number"
          min={0.2}
          max={60}
          step={0.1}
          value={(scene.durationMs / 1000).toString()}
          onChange={(e) => {
            const sec = parseFloat(e.target.value);
            if (Number.isNaN(sec)) return;
            const ms = Math.round(sec * 1000);
            updateSceneLocal(activeSceneId!, { durationMs: ms });
            debouncedSync({ durationMs: ms });
          }}
          className="rounded border border-white/15 bg-black px-2 py-1 text-white"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>Transition in</span>
        <select
          aria-label="Transition in"
          value={scene.transitionIn}
          onChange={(e) => {
            const v = e.target.value as (typeof TRANSITIONS)[number];
            updateSceneLocal(activeSceneId!, { transitionIn: v });
            debouncedSync({ transitionIn: v });
          }}
          className="rounded border border-white/15 bg-black px-2 py-1 text-white"
        >
          {TRANSITIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span>Transition out</span>
        <select
          aria-label="Transition out"
          value={scene.transitionOut}
          onChange={(e) => {
            const v = e.target.value as (typeof TRANSITIONS)[number];
            updateSceneLocal(activeSceneId!, { transitionOut: v });
            debouncedSync({ transitionOut: v });
          }}
          className="rounded border border-white/15 bg-black px-2 py-1 text-white"
        >
          {TRANSITIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
