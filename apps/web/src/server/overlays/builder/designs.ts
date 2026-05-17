/**
 * Overlay Builder — Designs CRUD.
 *
 * Every function takes the SupabaseClient as first arg per CLAUDE.md
 * mock-friendly pattern. Reads filter `deleted_at IS NULL` everywhere
 * — soft delete is the only delete mode.
 *
 * `publishDesign` writes a sibling row into `overlay_template_variants`
 * with `kind='dynamic'` so the broadcast control panel surfaces the
 * design under its Custom tab. `unpublishDesign` soft-deletes that row
 * so the panel hides the design without losing publish history.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §4
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Design } from "./types";

type DesignRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  mode: "single" | "sequence";
  status: "draft" | "published";
  canvas_width: number;
  canvas_height: number;
  created_by: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  thumbnail_path?: string | null;
};

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

const NANOID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function makeNanoid(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += NANOID_ALPHABET[Math.floor(Math.random() * NANOID_ALPHABET.length)];
  }
  return out;
}

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function rowToDesign(r: DesignRow, scenes: SceneRow[] = [], elementsByScene: Record<string, ElementRow[]> = {}): Design {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    mode: r.mode,
    status: r.status,
    canvasWidth: r.canvas_width,
    canvasHeight: r.canvas_height,
    createdBy: r.created_by,
    scenes: scenes.map((s) => ({
      id: s.id,
      designId: s.design_id,
      orderIndex: s.order_index,
      name: s.name,
      durationMs: s.duration_ms,
      transitionIn: s.transition_in,
      transitionOut: s.transition_out,
      elements: (elementsByScene[s.id] ?? []).map((e) => ({
        id: e.id,
        sceneId: e.scene_id,
        parentGroupId: e.parent_group_id,
        elementType: e.element_type as Design["scenes"][number]["elements"][number]["elementType"],
        zIndex: e.z_index,
        locked: e.locked,
        visible: e.visible,
        transform: e.transform as Design["scenes"][number]["elements"][number]["transform"],
        style: (e.style ?? {}) as Design["scenes"][number]["elements"][number]["style"],
        content: (e.content ?? {}) as Record<string, unknown>,
        binding: (e.binding ?? null) as Design["scenes"][number]["elements"][number]["binding"],
        animation: (e.animation ?? {}) as Design["scenes"][number]["elements"][number]["animation"],
      })),
    })),
  };
}

export type CreateDesignInput = {
  title: string;
  mode: "single" | "sequence";
  description?: string | null;
  createdBy: string;
};

export async function createDesign(
  sb: SupabaseClient,
  input: CreateDesignInput,
): Promise<Design> {
  const base = titleToSlug(input.title) || "untitled";
  let slug = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await sb
      .from("overlay_user_designs")
      .select("id")
      .eq("slug", slug)
      .is("deleted_at", null)
      .maybeSingle();
    if (!existing) break;
    slug = `${base}-${makeNanoid(4)}`;
  }

  const { data, error } = await sb
    .from("overlay_user_designs")
    .insert({
      slug,
      title: input.title,
      description: input.description ?? null,
      mode: input.mode,
      status: "draft",
      canvas_width: 1920,
      canvas_height: 1080,
      created_by: input.createdBy,
    })
    .select()
    .single();
  if (error) throw new Error(`createDesign: ${error.message}`);

  const designRow = data as DesignRow;

  let scenes: SceneRow[] = [];
  if (input.mode === "single") {
    const { data: sceneData, error: sceneErr } = await sb
      .from("overlay_user_design_scenes")
      .insert({
        design_id: designRow.id,
        order_index: 0,
        name: null,
        duration_ms: 5000,
        transition_in: "fade",
        transition_out: "fade",
      })
      .select()
      .single();
    if (sceneErr) throw new Error(`createDesign scene: ${sceneErr.message}`);
    scenes = [sceneData as SceneRow];
  }

  return rowToDesign(designRow, scenes);
}

export async function getDesign(
  sb: SupabaseClient,
  slug: string,
): Promise<Design | null> {
  const { data, error } = await sb
    .from("overlay_user_designs")
    .select("*")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getDesign: ${error.message}`);
  if (!data) return null;
  const designRow = data as DesignRow;

  const { data: sceneData, error: sceneErr } = await sb
    .from("overlay_user_design_scenes")
    .select("*")
    .eq("design_id", designRow.id)
    .is("deleted_at", null);
  if (sceneErr) throw new Error(`getDesign scenes: ${sceneErr.message}`);
  const scenes = ((sceneData ?? []) as SceneRow[]).sort(
    (a, b) => a.order_index - b.order_index,
  );

  const elementsByScene: Record<string, ElementRow[]> = {};
  for (const scene of scenes) {
    const { data: elData, error: elErr } = await sb
      .from("overlay_user_design_elements")
      .select("*")
      .eq("scene_id", scene.id)
      .is("deleted_at", null);
    if (elErr) throw new Error(`getDesign elements: ${elErr.message}`);
    elementsByScene[scene.id] = ((elData ?? []) as ElementRow[]).sort(
      (a, b) => a.z_index - b.z_index,
    );
  }

  return rowToDesign(designRow, scenes, elementsByScene);
}

export type DesignSummary = {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published";
  updatedAt: string;
  thumbnailUrl: string | null;
};

export async function listDesigns(
  sb: SupabaseClient,
  filter: { status?: "draft" | "published" } = {},
): Promise<DesignSummary[]> {
  let q = sb.from("overlay_user_designs").select("*").is("deleted_at", null);
  if (filter.status) q = q.eq("status", filter.status);
  const { data, error } = await q;
  if (error) throw new Error(`listDesigns: ${error.message}`);
  return ((data ?? []) as DesignRow[]).map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    updatedAt: r.updated_at ?? "",
    thumbnailUrl: r.thumbnail_path ?? null,
  }));
}

export type DesignMetaPatch = Partial<{
  title: string;
  description: string | null;
  mode: "single" | "sequence";
  status: "draft" | "published";
}>;

export async function updateDesignMeta(
  sb: SupabaseClient,
  designId: string,
  patch: DesignMetaPatch,
): Promise<void> {
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.mode !== undefined) update.mode = patch.mode;
  if (patch.status !== undefined) update.status = patch.status;

  const { error } = await sb
    .from("overlay_user_designs")
    .update(update)
    .eq("id", designId)
    .select()
    .single();
  if (error) throw new Error(`updateDesignMeta: ${error.message}`);
}

export async function publishDesign(
  sb: SupabaseClient,
  designId: string,
): Promise<void> {
  const { data: designData, error: getErr } = await sb
    .from("overlay_user_designs")
    .select("*")
    .eq("id", designId)
    .is("deleted_at", null)
    .maybeSingle();
  if (getErr) throw new Error(`publishDesign get: ${getErr.message}`);
  if (!designData) throw new Error(`publishDesign: design ${designId} not found`);
  const design = designData as DesignRow;

  const nowIso = new Date().toISOString();

  const { error: updateErr } = await sb
    .from("overlay_user_designs")
    .update({ status: "published", updated_at: nowIso })
    .eq("id", designId)
    .select()
    .single();
  if (updateErr) throw new Error(`publishDesign update: ${updateErr.message}`);

  const overlayKey = `user-${design.slug}`;
  const { error: variantErr } = await sb
    .from("overlay_template_variants")
    .insert({
      overlay_key: overlayKey,
      variant_id: "default",
      label: design.title,
      html_path: `/overlay/v2/user/${design.slug}`,
      thumbnail_path: design.thumbnail_path ?? null,
      active: true,
      kind: "dynamic",
    })
    .select()
    .single();
  if (variantErr) {
    // If a soft-deleted row exists for the same (overlay_key, variant_id)
    // pair, surface that as a recoverable error — caller can choose to
    // restore via a separate path. We don't auto-restore here so the
    // history stays explicit.
    throw new Error(`publishDesign variant: ${variantErr.message}`);
  }
}

export async function unpublishDesign(
  sb: SupabaseClient,
  designId: string,
): Promise<void> {
  const { data: designData, error: getErr } = await sb
    .from("overlay_user_designs")
    .select("*")
    .eq("id", designId)
    .is("deleted_at", null)
    .maybeSingle();
  if (getErr) throw new Error(`unpublishDesign get: ${getErr.message}`);
  if (!designData) throw new Error(`unpublishDesign: design ${designId} not found`);
  const design = designData as DesignRow;

  const nowIso = new Date().toISOString();

  const { error: updateErr } = await sb
    .from("overlay_user_designs")
    .update({ status: "draft", updated_at: nowIso })
    .eq("id", designId)
    .select()
    .single();
  if (updateErr) throw new Error(`unpublishDesign update: ${updateErr.message}`);

  const overlayKey = `user-${design.slug}`;
  const { error: variantErr } = await sb
    .from("overlay_template_variants")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("overlay_key", overlayKey)
    .select()
    .single();
  if (variantErr) {
    // Soft-fail — the design state already reflects unpublished; a
    // dangling template_variants row is recoverable.
    throw new Error(`unpublishDesign variant: ${variantErr.message}`);
  }
}

export async function softDeleteDesign(
  sb: SupabaseClient,
  designId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("overlay_user_designs")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("id", designId)
    .select()
    .single();
  if (error) throw new Error(`softDeleteDesign: ${error.message}`);
  // Scenes + elements cascade via FK ON DELETE CASCADE at the DB level
  // when the design is hard-deleted; for soft-delete we rely on the
  // reads to filter by the design's own deleted_at via JOIN.
}
