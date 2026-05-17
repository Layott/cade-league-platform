/**
 * Overlay Builder — Scenes CRUD.
 *
 * Scenes belong to designs. order_index is dense 0-based and stays
 * dense after every mutation. `cloneScene` duplicates element rows so
 * the clone is editable independently of the source.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §4
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Scene } from "./types";

type SceneRow = {
  id: string;
  design_id: string;
  order_index: number;
  name: string | null;
  duration_ms: number;
  transition_in: string;
  transition_out: string;
  deleted_at?: string | null;
};

type ElementRow = {
  id: string;
  scene_id: string;
  parent_group_id: string | null;
  element_type: string;
  z_index: number;
  locked: boolean;
  visible: boolean;
  transform: unknown;
  style: unknown;
  content: unknown;
  binding: unknown;
  animation: unknown;
  deleted_at?: string | null;
};

function rowToScene(r: SceneRow): Scene {
  return {
    id: r.id,
    designId: r.design_id,
    orderIndex: r.order_index,
    name: r.name,
    durationMs: r.duration_ms,
    transitionIn: r.transition_in,
    transitionOut: r.transition_out,
    elements: [],
  };
}

export type AddSceneInput = {
  afterOrderIndex: number;
  durationMs?: number;
  transitionIn?: string;
  transitionOut?: string;
};

export async function addScene(
  sb: SupabaseClient,
  designId: string,
  input: AddSceneInput,
): Promise<Scene> {
  const insertAtIndex = input.afterOrderIndex + 1;

  // Fetch existing live scenes to find which ones need shifting.
  const { data: siblings, error: siblingErr } = await sb
    .from("overlay_user_design_scenes")
    .select("*")
    .eq("design_id", designId)
    .is("deleted_at", null);
  if (siblingErr) throw new Error(`addScene siblings: ${siblingErr.message}`);

  // Shift in descending order_index so the partial unique
  // (design_id, order_index) WHERE deleted_at IS NULL never collides
  // with itself mid-loop.
  const toShift = ((siblings ?? []) as SceneRow[])
    .filter((s) => !s.deleted_at && s.order_index >= insertAtIndex)
    .sort((a, b) => b.order_index - a.order_index);

  for (const s of toShift) {
    const { error } = await sb
      .from("overlay_user_design_scenes")
      .update({ order_index: s.order_index + 1, updated_at: new Date().toISOString() })
      .eq("id", s.id)
      .select()
      .single();
    if (error) throw new Error(`addScene shift ${s.id}: ${error.message}`);
  }

  const { data, error } = await sb
    .from("overlay_user_design_scenes")
    .insert({
      design_id: designId,
      order_index: insertAtIndex,
      name: null,
      duration_ms: input.durationMs ?? 5000,
      transition_in: input.transitionIn ?? "fade",
      transition_out: input.transitionOut ?? "fade",
    })
    .select()
    .single();
  if (error) throw new Error(`addScene insert: ${error.message}`);
  return rowToScene(data as SceneRow);
}

export type UpdateScenePatch = Partial<{
  name: string | null;
  durationMs: number;
  transitionIn: string;
  transitionOut: string;
}>;

export async function updateScene(
  sb: SupabaseClient,
  sceneId: string,
  patch: UpdateScenePatch,
): Promise<void> {
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.durationMs !== undefined) update.duration_ms = patch.durationMs;
  if (patch.transitionIn !== undefined) update.transition_in = patch.transitionIn;
  if (patch.transitionOut !== undefined) update.transition_out = patch.transitionOut;

  const { error } = await sb
    .from("overlay_user_design_scenes")
    .update(update)
    .eq("id", sceneId)
    .select()
    .single();
  if (error) throw new Error(`updateScene: ${error.message}`);
}

export async function reorderScenes(
  sb: SupabaseClient,
  designId: string,
  sceneIdOrder: string[],
): Promise<void> {
  // Two-pass reorder: first assign temp offset values (out of normal range),
  // then assign final indices. Prevents partial-unique-index collisions.
  for (let i = 0; i < sceneIdOrder.length; i++) {
    const id = sceneIdOrder[i];
    const { error } = await sb
      .from("overlay_user_design_scenes")
      .update({
        order_index: i + 1000,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`reorderScenes pass1 ${id}: ${error.message}`);
  }
  for (let i = 0; i < sceneIdOrder.length; i++) {
    const id = sceneIdOrder[i];
    const { error } = await sb
      .from("overlay_user_design_scenes")
      .update({ order_index: i, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`reorderScenes pass2 ${id}: ${error.message}`);
  }
  // designId retained for future RLS / audit use; rows are already
  // scoped by the caller-supplied sceneIdOrder list.
  void designId;
}

export async function deleteScene(
  sb: SupabaseClient,
  sceneId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();

  // Load the row to find its design + order_index for sibling reindex.
  const { data: row, error: getErr } = await sb
    .from("overlay_user_design_scenes")
    .select("*")
    .eq("id", sceneId)
    .is("deleted_at", null)
    .maybeSingle();
  if (getErr) throw new Error(`deleteScene get: ${getErr.message}`);
  if (!row) return;
  const sceneRow = row as SceneRow;

  // Soft-delete the target row first.
  const { error: delErr } = await sb
    .from("overlay_user_design_scenes")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("id", sceneId)
    .select()
    .single();
  if (delErr) throw new Error(`deleteScene: ${delErr.message}`);

  // Fetch all live siblings and shift those with higher order_index down by 1.
  // Note: the mock's `is()` is a no-op so all rows are returned; filter
  // explicitly on deleted_at to ignore the just-deleted row.
  const { data: siblings, error: sibErr } = await sb
    .from("overlay_user_design_scenes")
    .select("*")
    .eq("design_id", sceneRow.design_id)
    .is("deleted_at", null);
  if (sibErr) throw new Error(`deleteScene siblings: ${sibErr.message}`);

  const toShift = ((siblings ?? []) as SceneRow[])
    .filter((s) => !s.deleted_at && s.order_index > sceneRow.order_index)
    .sort((a, b) => a.order_index - b.order_index);

  for (const s of toShift) {
    const { error } = await sb
      .from("overlay_user_design_scenes")
      .update({
        order_index: s.order_index - 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", s.id)
      .select()
      .single();
    if (error) throw new Error(`deleteScene reindex ${s.id}: ${error.message}`);
  }
}

export async function cloneScene(
  sb: SupabaseClient,
  sceneId: string,
): Promise<Scene> {
  // Load source scene.
  const { data: row, error: getErr } = await sb
    .from("overlay_user_design_scenes")
    .select("*")
    .eq("id", sceneId)
    .is("deleted_at", null)
    .maybeSingle();
  if (getErr) throw new Error(`cloneScene get: ${getErr.message}`);
  if (!row) throw new Error(`cloneScene: scene ${sceneId} not found`);
  const src = row as SceneRow;

  // Insert clone at the end of the design's scene chain.
  const { data: siblings, error: sibErr } = await sb
    .from("overlay_user_design_scenes")
    .select("*")
    .eq("design_id", src.design_id)
    .is("deleted_at", null);
  if (sibErr) throw new Error(`cloneScene siblings: ${sibErr.message}`);

  const liveSiblings = ((siblings ?? []) as SceneRow[]).filter(
    (s) => !s.deleted_at,
  );
  const maxIdx = liveSiblings.reduce(
    (m, s) => Math.max(m, s.order_index),
    -1,
  );

  const { data: newScene, error: insertErr } = await sb
    .from("overlay_user_design_scenes")
    .insert({
      design_id: src.design_id,
      order_index: maxIdx + 1,
      name: src.name ? `${src.name} (copy)` : null,
      duration_ms: src.duration_ms,
      transition_in: src.transition_in,
      transition_out: src.transition_out,
    })
    .select()
    .single();
  if (insertErr) throw new Error(`cloneScene insert: ${insertErr.message}`);
  const cloned = newScene as SceneRow;

  // Deep-copy element rows — fresh IDs, same scene but new scene_id.
  // Wave 1A drops parent_group_id mapping (groups not yet wired).
  const { data: elements, error: elErr } = await sb
    .from("overlay_user_design_elements")
    .select("*")
    .eq("scene_id", sceneId)
    .is("deleted_at", null);
  if (elErr) throw new Error(`cloneScene elements: ${elErr.message}`);

  for (const e of ((elements ?? []) as ElementRow[]).filter(
    (el) => !el.deleted_at,
  )) {
    const { error } = await sb
      .from("overlay_user_design_elements")
      .insert({
        scene_id: cloned.id,
        parent_group_id: null,
        element_type: e.element_type,
        z_index: e.z_index,
        locked: e.locked,
        visible: e.visible,
        transform: e.transform,
        style: e.style,
        content: e.content,
        binding: e.binding,
        animation: e.animation,
      })
      .select()
      .single();
    if (error) throw new Error(`cloneScene element copy: ${error.message}`);
  }

  return rowToScene(cloned);
}
