/**
 * Overlay Builder — design history (snapshot + revert).
 *
 * `overlay_user_design_history` is append-only at the DB layer (UPDATE
 * + DELETE blocked by `overlay_user_design_history_block_mutation()`
 * trigger — see migration in the foundation task). This module never
 * tries to mutate existing snapshots; it only inserts and reads.
 *
 * `revertToSnapshot` is two-phase: soft-delete the design's current
 * scenes + elements, then insert new rows from the snapshot JSON. The
 * Wave 1A implementation runs in two passes — wrapping in a DB
 * transaction is documented as a follow-up via a Postgres function
 * (`revert_design_snapshot`) so individual writes degrade gracefully
 * if one phase fails mid-revert.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §4
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getDesign } from "./designs";
import type { Design, Element, Scene } from "./types";

type HistoryRow = {
  id: string;
  design_id: string;
  snapshot: unknown;
  created_by: string | null;
  created_at: string;
  note: string | null;
};

export type SnapshotResult = {
  id: string;
  designId: string;
  createdAt: string;
  note: string | null;
};

export type SnapshotMeta = {
  id: string;
  designId: string;
  createdAt: string;
  createdBy: string | null;
  note: string | null;
};

export type Actor = { userId: string; roles: readonly string[] };

export async function snapshotDesign(
  sb: SupabaseClient,
  actorOrId: Actor | string,
  designIdOrNote?: string,
  note?: string,
): Promise<SnapshotResult> {
  // Support both calling conventions:
  //   snapshotDesign(sb, designId, note?)           — legacy
  //   snapshotDesign(sb, actor, designId, note?)    — action-layer
  let designId: string;
  let resolvedNote: string | undefined;
  if (typeof actorOrId === "string") {
    designId = actorOrId;
    resolvedNote = designIdOrNote;
  } else {
    designId = designIdOrNote!;
    resolvedNote = note;
  }
  // Load the design by ID. getDesign looks up by slug, so we need to
  // fetch slug first.
  const { data: designData, error: getErr } = await sb
    .from("overlay_user_designs")
    .select("*")
    .eq("id", designId)
    .is("deleted_at", null)
    .maybeSingle();
  if (getErr) throw new Error(`snapshotDesign get: ${getErr.message}`);
  if (!designData) throw new Error(`snapshotDesign: design ${designId} not found`);
  const design = await getDesign(sb, (designData as { slug: string }).slug);
  if (!design) throw new Error(`snapshotDesign: design ${designId} not resolvable`);

  // Deep-clone via JSON round-trip so the stored snapshot is decoupled
  // from any in-memory object references that the caller may mutate after
  // snapshotDesign returns.
  const snapshotJson = JSON.parse(JSON.stringify(design)) as Design;

  const { data, error } = await sb
    .from("overlay_user_design_history")
    .insert({
      design_id: designId,
      snapshot: snapshotJson,
      note: resolvedNote ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`snapshotDesign insert: ${error.message}`);
  const row = data as HistoryRow;
  return {
    id: row.id,
    designId: row.design_id,
    createdAt: row.created_at,
    note: row.note,
  };
}

export async function listSnapshots(
  sb: SupabaseClient,
  designId: string,
): Promise<SnapshotMeta[]> {
  const { data, error } = await sb
    .from("overlay_user_design_history")
    .select("id, design_id, created_at, created_by, note")
    .eq("design_id", designId);
  if (error) throw new Error(`listSnapshots: ${error.message}`);
  const rows = (data ?? []) as HistoryRow[];
  return rows
    .map((r) => ({
      id: r.id,
      designId: r.design_id,
      createdAt: r.created_at,
      createdBy: r.created_by,
      note: r.note,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function revertToSnapshot(
  sb: SupabaseClient,
  snapshotId: string,
): Promise<void> {
  const { data, error } = await sb
    .from("overlay_user_design_history")
    .select("*")
    .eq("id", snapshotId)
    .maybeSingle();
  if (error) throw new Error(`revertToSnapshot get: ${error.message}`);
  if (!data) throw new Error(`revertToSnapshot: snapshot ${snapshotId} not found`);
  const histRow = data as HistoryRow;
  const snapshot = histRow.snapshot as Design;

  const nowIso = new Date().toISOString();

  // Phase 1: load current scenes + elements + soft-delete them all.
  const { data: currentScenes, error: scErr } = await sb
    .from("overlay_user_design_scenes")
    .select("*")
    .eq("design_id", histRow.design_id)
    .is("deleted_at", null);
  if (scErr) throw new Error(`revertToSnapshot scenes: ${scErr.message}`);

  for (const s of (currentScenes ?? []) as Array<{ id: string }>) {
    // Soft-delete each scene's elements.
    const { data: els, error: elErr } = await sb
      .from("overlay_user_design_elements")
      .select("id")
      .eq("scene_id", s.id)
      .is("deleted_at", null);
    if (elErr) throw new Error(`revertToSnapshot el-load: ${elErr.message}`);
    for (const e of (els ?? []) as Array<{ id: string }>) {
      const { error: delErr } = await sb
        .from("overlay_user_design_elements")
        .update({ deleted_at: nowIso, updated_at: nowIso })
        .eq("id", e.id)
        .select()
        .single();
      if (delErr)
        throw new Error(`revertToSnapshot el-delete ${e.id}: ${delErr.message}`);
    }
    // Soft-delete the scene.
    const { error: delSceneErr } = await sb
      .from("overlay_user_design_scenes")
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq("id", s.id)
      .select()
      .single();
    if (delSceneErr)
      throw new Error(`revertToSnapshot scene-delete ${s.id}: ${delSceneErr.message}`);
  }

  // Phase 2: restore design meta from snapshot.
  const { error: metaErr } = await sb
    .from("overlay_user_designs")
    .update({
      title: snapshot.title,
      description: snapshot.description,
      mode: snapshot.mode,
      status: snapshot.status,
      canvas_width: snapshot.canvasWidth,
      canvas_height: snapshot.canvasHeight,
      updated_at: nowIso,
    })
    .eq("id", histRow.design_id)
    .select()
    .single();
  if (metaErr) throw new Error(`revertToSnapshot meta: ${metaErr.message}`);

  // Phase 3: insert scenes + elements from snapshot.
  for (const scene of snapshot.scenes as Scene[]) {
    const { data: newScene, error: scInsErr } = await sb
      .from("overlay_user_design_scenes")
      .insert({
        design_id: histRow.design_id,
        order_index: scene.orderIndex,
        name: scene.name,
        duration_ms: scene.durationMs,
        transition_in: scene.transitionIn,
        transition_out: scene.transitionOut,
      })
      .select()
      .single();
    if (scInsErr)
      throw new Error(`revertToSnapshot scene-insert: ${scInsErr.message}`);
    const insertedScene = newScene as { id: string };
    for (const el of scene.elements as Element[]) {
      const { error: elInsErr } = await sb
        .from("overlay_user_design_elements")
        .insert({
          scene_id: insertedScene.id,
          parent_group_id: el.parentGroupId,
          element_type: el.elementType,
          z_index: el.zIndex,
          locked: el.locked,
          visible: el.visible,
          transform: el.transform,
          style: el.style,
          content: el.content,
          binding: el.binding,
          animation: el.animation,
        })
        .select()
        .single();
      if (elInsErr)
        throw new Error(`revertToSnapshot element-insert: ${elInsErr.message}`);
    }
  }
}
