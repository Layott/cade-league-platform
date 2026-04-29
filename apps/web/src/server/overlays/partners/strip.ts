import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import { OVERLAY_KEYS } from "../design/defaults";

/**
 * Overlay Design Page v2 — partner-strip layout CRUD + resolver.
 *
 * One row per (overlay_key, variant_id). Mutable upsert. Bootstrap
 * script translates `anchor` + `position_x_px` + `position_y_px` into
 * concrete CSS top/bottom/left/right offsets.
 *
 * Mutations gate on `overlay.design.manage`. Reads unauthenticated at
 * this layer.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.2, §3.2
 */

export type PartnerStripAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type PartnerStripOrientation = "horizontal" | "vertical";

export type PartnerStripJustification =
  | "start"
  | "center"
  | "end"
  | "space-between";

export type PartnerStripLayout = {
  id: string;
  overlayKey: string;
  variantId: string;
  visible: boolean;
  positionXPx: number;
  positionYPx: number;
  anchor: PartnerStripAnchor;
  orientation: PartnerStripOrientation;
  scalePct: number;
  itemSpacingPx: number;
  justification: PartnerStripJustification;
  zIndex: number;
};

export type PartnerStripLayoutInput = Omit<PartnerStripLayout, "id">;

type Row = {
  id: string;
  overlay_key: string;
  variant_id: string;
  visible: boolean;
  position_x_px: number;
  position_y_px: number;
  anchor: PartnerStripAnchor;
  orientation: PartnerStripOrientation;
  scale_pct: number;
  item_spacing_px: number;
  justification: PartnerStripJustification;
  z_index: number;
};

const SELECT_COLS =
  "id, overlay_key, variant_id, visible, position_x_px, position_y_px, anchor, orientation, scale_pct, item_spacing_px, justification, z_index";

function toLayout(r: Row): PartnerStripLayout {
  return {
    id: r.id,
    overlayKey: r.overlay_key,
    variantId: r.variant_id,
    visible: r.visible,
    positionXPx: r.position_x_px,
    positionYPx: r.position_y_px,
    anchor: r.anchor,
    orientation: r.orientation,
    scalePct: r.scale_pct,
    itemSpacingPx: r.item_spacing_px,
    justification: r.justification,
    zIndex: r.z_index,
  };
}

const ANCHOR_VALUES: PartnerStripAnchor[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
const ORIENTATION_VALUES: PartnerStripOrientation[] = ["horizontal", "vertical"];
const JUSTIFICATION_VALUES: PartnerStripJustification[] = [
  "start",
  "center",
  "end",
  "space-between",
];

function validateInput(input: PartnerStripLayoutInput): void {
  if (!(OVERLAY_KEYS as readonly string[]).includes(input.overlayKey)) {
    throw new Error(`upsertStripLayout: unknown overlay key ${input.overlayKey}`);
  }
  if (!ANCHOR_VALUES.includes(input.anchor)) {
    throw new Error(`upsertStripLayout: invalid anchor ${input.anchor}`);
  }
  if (!ORIENTATION_VALUES.includes(input.orientation)) {
    throw new Error(`upsertStripLayout: invalid orientation ${input.orientation}`);
  }
  if (!JUSTIFICATION_VALUES.includes(input.justification)) {
    throw new Error(
      `upsertStripLayout: invalid justification ${input.justification}`,
    );
  }
  if (input.scalePct < 50 || input.scalePct > 200) {
    throw new Error(`upsertStripLayout: scale_pct out of range (50..200)`);
  }
  if (input.itemSpacingPx < 0 || input.itemSpacingPx > 256) {
    throw new Error(
      `upsertStripLayout: item_spacing_px out of range (0..256)`,
    );
  }
  if (input.zIndex < 0 || input.zIndex > 40) {
    throw new Error(`upsertStripLayout: z_index out of range (0..40)`);
  }
}

export async function getStripLayout(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string = "default",
): Promise<PartnerStripLayout | null> {
  const { data, error } = await sb
    .from("overlay_partner_strip_layout")
    .select(SELECT_COLS)
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getStripLayout: ${error.message}`);
  return data ? toLayout(data as Row) : null;
}

export async function upsertStripLayout(
  sb: SupabaseClient,
  actor: Actor,
  input: PartnerStripLayoutInput,
): Promise<PartnerStripLayout> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("upsertStripLayout: no actor.userId");
  validateInput(input);

  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("overlay_partner_strip_layout")
    .upsert(
      {
        overlay_key: input.overlayKey,
        variant_id: input.variantId,
        visible: input.visible,
        position_x_px: input.positionXPx,
        position_y_px: input.positionYPx,
        anchor: input.anchor,
        orientation: input.orientation,
        scale_pct: input.scalePct,
        item_spacing_px: input.itemSpacingPx,
        justification: input.justification,
        z_index: input.zIndex,
        set_by: actor.userId,
        updated_at: nowIso,
        deleted_at: null,
      },
      { onConflict: "overlay_key,variant_id" },
    )
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(`upsertStripLayout: ${error.message}`);
  return toLayout(data as Row);
}

export async function clearStripLayout(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("clearStripLayout: no actor.userId");

  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("overlay_partner_strip_layout")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .is("deleted_at", null);
  if (error) throw new Error(`clearStripLayout: ${error.message}`);
}

/**
 * Resolve EFFECTIVE strip layout for SSR injection. Returns null when
 * no row is persisted — bootstrap then falls back to HTML defaults
 * (typically `bottom-center` anchored at y=1020, scale=100%, etc.).
 */
export async function resolveStripLayout(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string = "default",
): Promise<PartnerStripLayout | null> {
  return getStripLayout(sb, overlayKey, variantId);
}
