import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Overlay Design System — template variant CRUD.
 *
 * One row per (overlay_key, variant_id). The `default` variant is
 * seeded for all 16 overlay keys by migration
 * `20260601000001_overlay_template_variants.sql`. Engineering authors
 * additional variants by writing a new HTML file at
 * `KNOWLEDGE/brand-assets/elements/v2/<key>/templates/<variant_id>/index.html`
 * (mirrored to `apps/web/public/...`) + inserting a row via
 * `createTemplate`.
 *
 * `setActiveTemplate` flips the partial-unique-index pivot atomically:
 * the existing active row gets `active=false`, then the chosen row
 * gets `active=true`. Two-step because Supabase JS doesn't expose
 * Postgres transactions; the order matters because the partial unique
 * index `overlay_template_variants_active_unique` rejects two `active`
 * rows for the same overlay_key. If the second update fails the first
 * is rolled back via a compensating write.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §4.2
 */

export type TemplateVariant = {
  id: string;
  overlayKey: string;
  variantId: string;
  label: string;
  description: string | null;
  htmlPath: string;
  thumbnailPath: string | null;
  active: boolean;
};

type Row = {
  id: string;
  overlay_key: string;
  variant_id: string;
  label: string;
  description: string | null;
  html_path: string;
  thumbnail_path: string | null;
  active: boolean;
};

function toVariant(r: Row): TemplateVariant {
  return {
    id: r.id,
    overlayKey: r.overlay_key,
    variantId: r.variant_id,
    label: r.label,
    description: r.description,
    htmlPath: r.html_path,
    thumbnailPath: r.thumbnail_path,
    active: r.active,
  };
}

const SELECT_COLS =
  "id, overlay_key, variant_id, label, description, html_path, thumbnail_path, active";

/**
 * List template variants. Filter by `overlayKey` for the gallery view;
 * omit to list all variants across overlays. Excludes soft-deleted
 * rows. Sorted by overlay_key then variant_id for stable rendering.
 */
export async function listTemplates(
  sb: SupabaseClient,
  overlayKey?: string,
): Promise<TemplateVariant[]> {
  let q = sb
    .from("overlay_template_variants")
    .select(SELECT_COLS)
    .is("deleted_at", null)
    .order("overlay_key", { ascending: true })
    .order("variant_id", { ascending: true });
  if (overlayKey) q = q.eq("overlay_key", overlayKey);
  const { data, error } = await q;
  if (error) throw new Error(`listTemplates: ${error.message}`);
  return ((data ?? []) as Row[]).map(toVariant);
}

/**
 * Atomically swap which variant is active for a given overlay_key.
 *
 * Steps:
 *   1. Demote the current active row (if any) for this overlay_key.
 *   2. Promote the target (overlay_key, variant_id) row.
 *
 * If step 2 fails, we attempt to compensate by re-promoting the row
 * we just demoted so the gallery doesn't end up with NO active
 * variant. The compensation is best-effort — production should rely
 * on the partial-unique-index to reject duplicate-active rows.
 */
export async function setActiveTemplate(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "overlay.design.manage");

  // Look up the existing active row so we can compensate if step 2
  // fails. `maybeSingle` because there might be no active row yet
  // (fresh overlay key with only one variant + active=false somehow).
  const { data: prior, error: priorErr } = await sb
    .from("overlay_template_variants")
    .select("variant_id")
    .eq("overlay_key", overlayKey)
    .eq("active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (priorErr) throw new Error(`setActiveTemplate (read prior): ${priorErr.message}`);

  const priorVariantId = (prior as { variant_id: string } | null)?.variant_id ?? null;

  // Short-circuit: already active.
  if (priorVariantId === variantId) return;

  const nowIso = new Date().toISOString();

  // Step 1: demote.
  if (priorVariantId !== null) {
    const { error: demoteErr } = await sb
      .from("overlay_template_variants")
      .update({ active: false, updated_at: nowIso })
      .eq("overlay_key", overlayKey)
      .eq("active", true)
      .is("deleted_at", null);
    if (demoteErr) {
      throw new Error(`setActiveTemplate (demote): ${demoteErr.message}`);
    }
  }

  // Step 2: promote.
  const { error: promoteErr } = await sb
    .from("overlay_template_variants")
    .update({ active: true, updated_at: nowIso })
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .is("deleted_at", null);
  if (promoteErr) {
    // Compensate: re-promote the prior row so we don't leave the
    // overlay with no active variant.
    if (priorVariantId !== null) {
      await sb
        .from("overlay_template_variants")
        .update({ active: true, updated_at: new Date().toISOString() })
        .eq("overlay_key", overlayKey)
        .eq("variant_id", priorVariantId)
        .is("deleted_at", null);
    }
    throw new Error(`setActiveTemplate (promote): ${promoteErr.message}`);
  }
}

/**
 * Insert a new template variant row. Default `active=false` — admin
 * must call `setActiveTemplate` to flip the gallery to the new
 * variant.
 *
 * Rejects duplicates via the (overlay_key, variant_id) UNIQUE
 * constraint: Supabase surfaces the Postgres error and the helper
 * re-throws so callers can show the right error in the UI.
 */
export async function createTemplate(
  sb: SupabaseClient,
  actor: Actor,
  input: Omit<TemplateVariant, "id" | "active">,
): Promise<TemplateVariant> {
  await requirePermAsync(sb, actor, "overlay.design.manage");

  const { data, error } = await sb
    .from("overlay_template_variants")
    .insert({
      overlay_key: input.overlayKey,
      variant_id: input.variantId,
      label: input.label,
      description: input.description,
      html_path: input.htmlPath,
      thumbnail_path: input.thumbnailPath,
      active: false,
    })
    .select(SELECT_COLS)
    .single();
  if (error) {
    if (/duplicate key|already exists/i.test(error.message)) {
      throw new Error(
        `createTemplate: variant ${input.overlayKey}/${input.variantId} already exists`,
      );
    }
    throw new Error(`createTemplate: ${error.message}`);
  }
  return toVariant(data as Row);
}
