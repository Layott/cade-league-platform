"use client";

import { create } from "zustand";
import { temporal } from "zundo";
import { nanoid } from "nanoid";
import type {
  Design,
  Element,
  ElementType,
} from "@/server/overlays/builder/types";
import type { SaveDesignInput } from "@/app/admin/broadcast/v2/builder/schemas";

/**
 * Wave 1A — canvas editor store.
 *
 * Holds the in-flight `Design` for the active edit page plus selection /
 * zoom / dirty state. Mutations flow through actions that produce new
 * immutable snapshots; `zundo` middleware captures each snapshot into
 * past/future stacks for undo/redo.
 *
 * History capped at 100 entries per spec §5.2.
 *
 * Camelcase throughout the client-side types; `toServerJson()` converts
 * to the snake_case wire format that `saveDesignAction` expects
 * (per Task 17 schemas).
 */
export type BuilderState = {
  design: Design | null;
  selectedElementIds: string[];
  activeSceneId: string | null;
  zoomLevel: number;
  dirty: boolean;

  loadDesign: (design: Design) => void;
  addElement: (
    sceneId: string,
    elementType: ElementType,
    defaults: Partial<Omit<Element, "id" | "elementType" | "sceneId">>,
  ) => void;
  updateElement: (elementId: string, patch: Partial<Element>) => void;
  deleteElement: (elementId: string) => void;
  selectElement: (elementId: string, additive?: boolean) => void;
  reorderElement: (elementId: string, newZIndex: number) => void;
  setZoom: (level: number) => void;
  markClean: () => void;
};

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

const replaceScene = (
  design: Design,
  sceneId: string,
  mut: (s: Design["scenes"][number]) => Design["scenes"][number],
): Design => ({
  ...design,
  scenes: design.scenes.map((s) => (s.id === sceneId ? mut(s) : s)),
});

// ─────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────

export const useBuilderStore = create<BuilderState>()(
  temporal(
    (set) => ({
      design: null,
      selectedElementIds: [],
      activeSceneId: null,
      zoomLevel: 1.0,
      dirty: false,

      loadDesign: (design) =>
        set({
          design,
          activeSceneId: design.scenes[0]?.id ?? null,
          dirty: false,
          selectedElementIds: [],
        }),

      addElement: (sceneId, elementType, defaults) =>
        set((state) => {
          if (!state.design) return state;
          const scene = state.design.scenes.find((s) => s.id === sceneId);
          if (!scene) return state;
          const newEl: Element = {
            id: nanoid(),
            sceneId,
            parentGroupId: null,
            elementType,
            zIndex: scene.elements.length,
            locked: false,
            visible: true,
            transform: {
              x: 0,
              y: 0,
              width: 200,
              height: 100,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              opacity: 1,
            },
            style: {},
            content: {},
            binding: null,
            animation: {},
            ...defaults,
          };
          return {
            design: replaceScene(state.design, sceneId, (s) => ({
              ...s,
              elements: [...s.elements, newEl].sort(
                (a, b) => a.zIndex - b.zIndex,
              ),
            })),
            selectedElementIds: [newEl.id],
            dirty: true,
          };
        }),

      updateElement: (elementId, patch) =>
        set((state) => {
          if (!state.design) return state;
          return {
            design: {
              ...state.design,
              scenes: state.design.scenes.map((s) => ({
                ...s,
                elements: s.elements.map((e) =>
                  e.id === elementId ? ({ ...e, ...patch } as Element) : e,
                ),
              })),
            },
            dirty: true,
          };
        }),

      deleteElement: (elementId) =>
        set((state) => {
          if (!state.design) return state;
          return {
            design: {
              ...state.design,
              scenes: state.design.scenes.map((s) => ({
                ...s,
                elements: s.elements.filter((e) => e.id !== elementId),
              })),
            },
            selectedElementIds: state.selectedElementIds.filter(
              (id) => id !== elementId,
            ),
            dirty: true,
          };
        }),

      selectElement: (elementId, additive = false) =>
        set((state) => ({
          selectedElementIds: additive
            ? Array.from(new Set([...state.selectedElementIds, elementId]))
            : [elementId],
        })),

      reorderElement: (elementId, newZIndex) =>
        set((state) => {
          if (!state.design) return state;
          return {
            design: {
              ...state.design,
              scenes: state.design.scenes.map((s) => ({
                ...s,
                elements: s.elements
                  .map((e) =>
                    e.id === elementId ? { ...e, zIndex: newZIndex } : e,
                  )
                  .sort((a, b) => a.zIndex - b.zIndex),
              })),
            },
            dirty: true,
          };
        }),

      setZoom: (level) => set({ zoomLevel: level }),

      markClean: () => set({ dirty: false }),
    }),
    {
      // Track only `design` so selection / zoom / dirty don't pollute history.
      partialize: (state) => ({ design: state.design }),
      limit: 100,
    },
  ),
);

/**
 * Convenience reference to the temporal slice (undo/redo/clear/
 * pastStates/futureStates). Exported symmetrically with `useBuilderStore`
 * so callers import from a single module.
 */
export const useTemporalStore = useBuilderStore.temporal;

// ─────────────────────────────────────────────────────────────
// toServerJson — camelCase Design → snake_case SaveDesignInput
//
// Converts the client-side Design type (camelCase) to the wire format
// expected by saveDesignAction (snake_case nested fields per Task 17
// schemas.ts). Lives here so the store and its callers stay co-located;
// tests cover the conversion shape explicitly.
// ─────────────────────────────────────────────────────────────

export function toServerJson(design: Design): SaveDesignInput {
  return {
    id: design.id,
    slug: design.slug,
    title: design.title,
    description: design.description ?? null,
    mode: design.mode,
    status: design.status,
    canvas_width: design.canvasWidth,
    canvas_height: design.canvasHeight,
    scenes: design.scenes.map((scene) => ({
      id: scene.id,
      order_index: scene.orderIndex,
      name: scene.name ?? null,
      duration_ms: scene.durationMs,
      transition_in: scene.transitionIn as SaveDesignInput["scenes"][number]["transition_in"],
      transition_out: scene.transitionOut as SaveDesignInput["scenes"][number]["transition_out"],
      elements: scene.elements.map((el) => ({
        id: el.id,
        scene_id: el.sceneId,
        parent_group_id: el.parentGroupId ?? null,
        element_type: el.elementType,
        z_index: el.zIndex,
        locked: el.locked,
        visible: el.visible,
        transform: el.transform,
        style: el.style,
        content: el.content ?? null,
        binding: el.binding ?? null,
        animation: el.animation ?? null,
      })),
    })),
  };
}
