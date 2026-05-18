"use client";

import { useBuilderStore, makeUuid } from "./store";
import type { Element } from "@/server/overlays/builder/types";

/**
 * Wave 1C — copy / paste via system clipboard.
 *
 * Envelope shape:
 *   { __cade_overlay_clip__: 1, elements: Element[] }
 *
 * copyElementsToClipboard walks the selection subtree (including every
 * descendant of any selected group), wraps elements in a magic-header
 * envelope and writes to navigator.clipboard.
 *
 * pasteElementsFromClipboard reads the clipboard, validates the magic
 * header, regenerates every id via nanoid, rewires parentGroupId through
 * an old->new id map, offsets every top-level element +20 px on x + y for
 * visibility, and appends to the active scene. Cross-design paste works
 * because the envelope rides the system clipboard text channel.
 */

const MAGIC = 1 as const;

type ClipPayload = {
  __cade_overlay_clip__: typeof MAGIC;
  elements: Element[];
};

function selectedSubtree(): Element[] {
  const state = useBuilderStore.getState();
  if (!state.design || !state.activeSceneId) return [];
  const scene = state.design.scenes.find((s) => s.id === state.activeSceneId);
  if (!scene) return [];
  const selected = new Set(state.selectedElementIds);
  // Expand to include every descendant of any selected group.
  let changed = true;
  while (changed) {
    changed = false;
    for (const el of scene.elements) {
      if (el.parentGroupId && selected.has(el.parentGroupId) && !selected.has(el.id)) {
        selected.add(el.id);
        changed = true;
      }
    }
  }
  return scene.elements.filter((e) => selected.has(e.id));
}

export async function copyElementsToClipboard(): Promise<void> {
  const elements = selectedSubtree();
  if (elements.length === 0) return;
  const payload: ClipPayload = { __cade_overlay_clip__: MAGIC, elements };
  await navigator.clipboard.writeText(JSON.stringify(payload));
}

export async function pasteElementsFromClipboard(): Promise<void> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { __cade_overlay_clip__?: unknown }).__cade_overlay_clip__ !== MAGIC
  ) {
    return;
  }
  const elements = (parsed as ClipPayload).elements ?? [];
  if (elements.length === 0) return;

  const state = useBuilderStore.getState();
  if (!state.design || !state.activeSceneId) return;
  const sceneId = state.activeSceneId;

  // Build old->new id map for parentGroupId rewiring. Use makeUuid so
  // pasted elements satisfy the uuid PRIMARY KEY on save (Bug 4 fix).
  const idMap = new Map<string, string>();
  for (const el of elements) idMap.set(el.id, makeUuid());

  const scene = state.design.scenes.find((s) => s.id === sceneId);
  const baseZ = scene ? scene.elements.length : 0;

  const fresh: Element[] = elements.map((el, i) => ({
    ...el,
    id: idMap.get(el.id) ?? makeUuid(),
    parentGroupId: el.parentGroupId ? (idMap.get(el.parentGroupId) ?? null) : null,
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
          sc.id === sceneId ? { ...sc, elements: [...sc.elements, ...fresh] } : sc,
        ),
      },
      selectedElementIds: fresh.map((e) => e.id),
      dirty: true,
    };
  });
}
