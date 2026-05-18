"use client";

import { useHotkeys } from "react-hotkeys-hook";
import { useBuilderStore, useTemporalStore, makeUuid } from "@/state/builder/store";
import {
  copyElementsToClipboard,
  pasteElementsFromClipboard,
} from "@/state/builder/clipboard";
import type { Element } from "@/server/overlays/builder/types";

/**
 * Wave 1C — every editor keyboard shortcut, in one hook.
 *
 * mod+z          undo
 * mod+shift+z    redo
 * mod+y          redo (Windows alt)
 * mod+c          copy selection
 * mod+v          paste
 * mod+d          duplicate selection (copy + paste, offsets +20 px)
 * mod+g          group every selected element into a new group
 * mod+shift+g    ungroup any selected group element (flatten its children)
 * delete/back    delete every selected element
 * arrow keys     nudge 1 px (10 px with shift)
 * escape         clear selection / cancel pen
 *
 * react-hotkeys-hook v5 auto-skips presses while a contenteditable /
 * input has focus (enableOnFormTags: false) so TopBar title field +
 * Properties Panel inputs keep their native arrow-key + ctrl+z behaviour.
 */
export function useBuilderShortcuts() {
  useHotkeys(
    "mod+z",
    (e) => {
      e.preventDefault();
      useTemporalStore.getState().undo();
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    "mod+shift+z, mod+y",
    (e) => {
      e.preventDefault();
      useTemporalStore.getState().redo();
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    "mod+c",
    (e) => {
      e.preventDefault();
      void copyElementsToClipboard();
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    "mod+v",
    (e) => {
      e.preventDefault();
      void pasteElementsFromClipboard();
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    "mod+d",
    (e) => {
      e.preventDefault();
      // Wave 1C — in-memory duplicate.
      //
      // Earlier wiring (copy → paste through navigator.clipboard) was
      // brittle: headless browsers + insecure-origin localhost block
      // clipboard access by default, which broke the e2e
      // duplicate-with-offset assertion. The duplicate semantic is
      // intra-design only (same scene, +20 px), so the system
      // clipboard is the wrong transport. We now walk the selection
      // subtree, rewire parentGroupId via an old→new uuid map, offset
      // each top-level element by +20 px, and append directly to the
      // active scene's elements. Cross-design paste still flows
      // through mod+c / mod+v.
      const state = useBuilderStore.getState();
      if (!state.design || !state.activeSceneId) return;
      const scene = state.design.scenes.find(
        (s) => s.id === state.activeSceneId,
      );
      if (!scene) return;
      const selected = new Set(state.selectedElementIds);
      if (selected.size === 0) return;
      // Expand to include every descendant of any selected group.
      let changed = true;
      while (changed) {
        changed = false;
        for (const el of scene.elements) {
          if (
            el.parentGroupId &&
            selected.has(el.parentGroupId) &&
            !selected.has(el.id)
          ) {
            selected.add(el.id);
            changed = true;
          }
        }
      }
      const subtree = scene.elements.filter((el) => selected.has(el.id));
      if (subtree.length === 0) return;
      const idMap = new Map<string, string>();
      for (const el of subtree) idMap.set(el.id, makeUuid());
      const baseZ = scene.elements.length;
      const fresh: Element[] = subtree.map((el, i) => ({
        ...el,
        id: idMap.get(el.id) ?? makeUuid(),
        parentGroupId: el.parentGroupId
          ? (idMap.get(el.parentGroupId) ?? null)
          : null,
        zIndex: baseZ + i,
        transform: {
          ...el.transform,
          x: el.transform.x + 20,
          y: el.transform.y + 20,
        },
      }));
      useBuilderStore.setState((s) => {
        if (!s.design) return s;
        return {
          design: {
            ...s.design,
            scenes: s.design.scenes.map((sc) =>
              sc.id === scene.id
                ? { ...sc, elements: [...sc.elements, ...fresh] }
                : sc,
            ),
          },
          selectedElementIds: fresh.map((e) => e.id),
          dirty: true,
        };
      });
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    "mod+shift+g",
    (e) => {
      e.preventDefault();
      const state = useBuilderStore.getState();
      if (!state.design || !state.activeSceneId) return;
      const scene = state.design.scenes.find((s) => s.id === state.activeSceneId);
      if (!scene) return;
      // Ungroup every selected group; for non-group selections find any
      // group ancestor via parentGroupId so the shortcut works whether
      // the user has the group itself or a child element selected.
      const ungroupIds = new Set<string>();
      for (const id of state.selectedElementIds) {
        const el = scene.elements.find((e) => e.id === id);
        if (!el) continue;
        if (el.elementType === "group") {
          ungroupIds.add(el.id);
        } else if (el.parentGroupId) {
          ungroupIds.add(el.parentGroupId);
        }
      }
      for (const id of ungroupIds) state.ungroupElements(id);
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    "mod+g",
    (e) => {
      e.preventDefault();
      const state = useBuilderStore.getState();
      if (state.selectedElementIds.length === 0) return;
      state.groupElements(state.selectedElementIds);
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    "delete, backspace",
    (e) => {
      e.preventDefault();
      const { selectedElementIds, deleteElement } = useBuilderStore.getState();
      for (const id of selectedElementIds) deleteElement(id);
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    "escape",
    (e) => {
      e.preventDefault();
      const state = useBuilderStore.getState();
      if (state.toolMode === "pen") {
        state.cancelPenDraft();
      } else {
        state.selectMultiple([]);
      }
    },
    { enableOnFormTags: false },
  );

  const nudge = (dx: number, dy: number) => {
    const state = useBuilderStore.getState();
    if (!state.design || !state.activeSceneId) return;
    const scene = state.design.scenes.find((s) => s.id === state.activeSceneId);
    if (!scene) return;
    for (const id of state.selectedElementIds) {
      const el = scene.elements.find((e) => e.id === id);
      if (!el) continue;
      state.updateElement(id, {
        transform: { ...el.transform, x: el.transform.x + dx, y: el.transform.y + dy },
      } as never);
    }
  };

  useHotkeys("up",    (e) => { e.preventDefault(); nudge(0, -1); },  { enableOnFormTags: false });
  useHotkeys("down",  (e) => { e.preventDefault(); nudge(0, 1); },   { enableOnFormTags: false });
  useHotkeys("left",  (e) => { e.preventDefault(); nudge(-1, 0); },  { enableOnFormTags: false });
  useHotkeys("right", (e) => { e.preventDefault(); nudge(1, 0); },   { enableOnFormTags: false });

  useHotkeys("shift+up",    (e) => { e.preventDefault(); nudge(0, -10); },  { enableOnFormTags: false });
  useHotkeys("shift+down",  (e) => { e.preventDefault(); nudge(0, 10); },   { enableOnFormTags: false });
  useHotkeys("shift+left",  (e) => { e.preventDefault(); nudge(-10, 0); },  { enableOnFormTags: false });
  useHotkeys("shift+right", (e) => { e.preventDefault(); nudge(10, 0); },   { enableOnFormTags: false });
}
