"use client";

import { useHotkeys } from "react-hotkeys-hook";
import { useBuilderStore, useTemporalStore } from "@/state/builder/store";
import {
  copyElementsToClipboard,
  pasteElementsFromClipboard,
} from "@/state/builder/clipboard";

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
      // Fire both functions; the second awaits the first so cross-design
      // paste receives a populated clipboard. Both calls are non-blocking
      // from the handler's perspective.
      void (async () => {
        await copyElementsToClipboard();
        await pasteElementsFromClipboard();
      })();
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
