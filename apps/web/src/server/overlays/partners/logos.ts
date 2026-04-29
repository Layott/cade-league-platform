import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import { OVERLAY_KEYS } from "../design/defaults";

/**
 * Overlay Design Page v2 — partner-logo roster + per-overlay overrides.
 *
 * Two collections:
 *   - `overlay_partner_logos` (global roster) — every overlay using
 *     the strip pulls from this list.
 *   - `overlay_partner_logo_overrides` (per-overlay) — admins toggle
 *     visibility / sort order PER overlay-variant without touching
 *     global state.
 *
 * Dimension contract: 600×300 ±10% (i.e. width ∈ [540, 660], height ∈
 * [270, 330]). SVG uploads bypass the check (vector — controlled via
 * the strip layout's `scale_pct`).
 *
 * Mutations gate on `overlay.design.manage`.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.3, §2.4, §3.3
 */

export type PartnerLogo = {
  id: string;
  partnerKey: string;
  label: string;
  alt: string;
  fileUrl: string;
  fileSizeBytes: number;
  dimensionWPx: number;
  dimensionHPx: number;
  sortOrder: number;
  setBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PartnerLogoInput = {
  partnerKey: string;
  label: string;
  alt: string;
  fileUrl: string;
  fileSizeBytes: number;
  dimensionWPx: number;
  dimensionHPx: number;
  sortOrder: number;
};

export type PartnerLogoPatch = Partial<{
  label: string;
  alt: string;
  fileUrl: string;
  fileSizeBytes: number;
  dimensionWPx: number;
  dimensionHPx: number;
  sortOrder: number;
}>;

export type PartnerLogoOverride = {
  id: string;
  overlayKey: string;
  variantId: string;
  partnerKey: string;
  visible: boolean;
  sortOverride: number | null;
};

export type PartnerLogoOverrideInput = {
  overlayKey: string;
  variantId: string;
  partnerKey: string;
  visible: boolean;
  sortOverride: number | null;
};

type LogoRow = {
  id: string;
  partner_key: string;
  label: string;
  alt: string;
  file_url: string;
  file_size_bytes: number;
  dimension_w_px: number;
  dimension_h_px: number;
  sort_order: number;
  set_by: string;
  created_at: string;
  updated_at: string;
};

type OverrideRow = {
  id: string;
  overlay_key: string;
  variant_id: string;
  partner_key: string;
  visible: boolean;
  sort_override: number | null;
};

const LOGO_SELECT_COLS =
  "id, partner_key, label, alt, file_url, file_size_bytes, dimension_w_px, dimension_h_px, sort_order, set_by, created_at, updated_at";

const OVERRIDE_SELECT_COLS =
  "id, overlay_key, variant_id, partner_key, visible, sort_override";

function toLogo(r: LogoRow): PartnerLogo {
  return {
    id: r.id,
    partnerKey: r.partner_key,
    label: r.label,
    alt: r.alt,
    fileUrl: r.file_url,
    fileSizeBytes: r.file_size_bytes,
    dimensionWPx: r.dimension_w_px,
    dimensionHPx: r.dimension_h_px,
    sortOrder: r.sort_order,
    setBy: r.set_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toOverride(r: OverrideRow): PartnerLogoOverride {
  return {
    id: r.id,
    overlayKey: r.overlay_key,
    variantId: r.variant_id,
    partnerKey: r.partner_key,
    visible: r.visible,
    sortOverride: r.sort_override,
  };
}

const PARTNER_KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Dimension tolerance per spec §10.6: 600×300 ±10% (so 540..660 wide,
 * 270..330 tall). Vector formats (SVG) bypass the dimension check —
 * callers pass `isVector=true` to skip.
 */
export function validateLogoDimensions(
  widthPx: number,
  heightPx: number,
  isVector = false,
): { ok: true } | { ok: false; error: string } {
  if (isVector) return { ok: true };
  const minW = 540;
  const maxW = 660;
  const minH = 270;
  const maxH = 330;
  if (widthPx < minW || widthPx > maxW || heightPx < minH || heightPx > maxH) {
    return {
      ok: false,
      error: `Got ${widthPx}×${heightPx}, expected 600×300 ±10% (${minW}..${maxW} × ${minH}..${maxH})`,
    };
  }
  return { ok: true };
}

function validateLogoInput(input: PartnerLogoInput): void {
  if (!PARTNER_KEY_RE.test(input.partnerKey)) {
    throw new Error(
      `partnerKey ${input.partnerKey} must be kebab-case (lowercase letter then a-z0-9-)`,
    );
  }
  if (!input.label || input.label.length > 200) {
    throw new Error(`label required, max 200 chars`);
  }
  if (input.alt == null || input.alt.length > 200) {
    throw new Error(`alt required, max 200 chars`);
  }
  if (!input.fileUrl || input.fileUrl.length > 1000) {
    throw new Error(`fileUrl required, max 1000 chars`);
  }
  if (input.fileSizeBytes <= 0 || input.fileSizeBytes > 512000) {
    throw new Error(
      `fileSizeBytes out of range — must be in (0, 512000] bytes`,
    );
  }
  // SVG bypasses dimension validation; we detect by extension here.
  const isVector = /\.svg($|\?)/i.test(input.fileUrl);
  const dimResult = validateLogoDimensions(
    input.dimensionWPx,
    input.dimensionHPx,
    isVector,
  );
  if (!dimResult.ok) {
    throw new Error(`createPartnerLogo: ${dimResult.error}`);
  }
}

function validateOverrideInput(input: PartnerLogoOverrideInput): void {
  if (!(OVERLAY_KEYS as readonly string[]).includes(input.overlayKey)) {
    throw new Error(`unknown overlay key ${input.overlayKey}`);
  }
  if (!PARTNER_KEY_RE.test(input.partnerKey)) {
    throw new Error(`partnerKey ${input.partnerKey} must be kebab-case`);
  }
}

// ───────────────────────── Logos ─────────────────────────

export async function listPartnerLogos(
  sb: SupabaseClient,
): Promise<PartnerLogo[]> {
  const { data, error } = await sb
    .from("overlay_partner_logos")
    .select(LOGO_SELECT_COLS)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`listPartnerLogos: ${error.message}`);
  return ((data ?? []) as LogoRow[]).map(toLogo);
}

export async function getPartnerLogo(
  sb: SupabaseClient,
  partnerKey: string,
): Promise<PartnerLogo | null> {
  const { data, error } = await sb
    .from("overlay_partner_logos")
    .select(LOGO_SELECT_COLS)
    .eq("partner_key", partnerKey)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getPartnerLogo: ${error.message}`);
  return data ? toLogo(data as LogoRow) : null;
}

export async function createPartnerLogo(
  sb: SupabaseClient,
  actor: Actor,
  input: PartnerLogoInput,
): Promise<PartnerLogo> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("createPartnerLogo: no actor.userId");
  validateLogoInput(input);

  const { data, error } = await sb
    .from("overlay_partner_logos")
    .insert({
      partner_key: input.partnerKey,
      label: input.label,
      alt: input.alt,
      file_url: input.fileUrl,
      file_size_bytes: input.fileSizeBytes,
      dimension_w_px: input.dimensionWPx,
      dimension_h_px: input.dimensionHPx,
      sort_order: input.sortOrder,
      set_by: actor.userId,
    })
    .select(LOGO_SELECT_COLS)
    .single();
  if (error) {
    if (/duplicate key|already exists/i.test(error.message)) {
      throw new Error(
        `createPartnerLogo: partner ${input.partnerKey} already exists (soft-delete first to reuse the key)`,
      );
    }
    throw new Error(`createPartnerLogo: ${error.message}`);
  }
  return toLogo(data as LogoRow);
}

export async function updatePartnerLogo(
  sb: SupabaseClient,
  actor: Actor,
  partnerKey: string,
  patch: PartnerLogoPatch,
): Promise<PartnerLogo> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("updatePartnerLogo: no actor.userId");

  // If patch carries new dimensions, re-validate.
  if (
    typeof patch.dimensionWPx === "number" &&
    typeof patch.dimensionHPx === "number"
  ) {
    const isVector =
      patch.fileUrl != null && /\.svg($|\?)/i.test(patch.fileUrl);
    const r = validateLogoDimensions(
      patch.dimensionWPx,
      patch.dimensionHPx,
      isVector,
    );
    if (!r.ok) throw new Error(`updatePartnerLogo: ${r.error}`);
  }

  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: nowIso };
  if (patch.label != null) updates.label = patch.label;
  if (patch.alt != null) updates.alt = patch.alt;
  if (patch.fileUrl != null) updates.file_url = patch.fileUrl;
  if (patch.fileSizeBytes != null) updates.file_size_bytes = patch.fileSizeBytes;
  if (patch.dimensionWPx != null) updates.dimension_w_px = patch.dimensionWPx;
  if (patch.dimensionHPx != null) updates.dimension_h_px = patch.dimensionHPx;
  if (patch.sortOrder != null) updates.sort_order = patch.sortOrder;

  const { data, error } = await sb
    .from("overlay_partner_logos")
    .update(updates)
    .eq("partner_key", partnerKey)
    .is("deleted_at", null)
    .select(LOGO_SELECT_COLS)
    .single();
  if (error) throw new Error(`updatePartnerLogo: ${error.message}`);
  return toLogo(data as LogoRow);
}

export async function deletePartnerLogo(
  sb: SupabaseClient,
  actor: Actor,
  partnerKey: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("deletePartnerLogo: no actor.userId");

  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("overlay_partner_logos")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("partner_key", partnerKey)
    .is("deleted_at", null);
  if (error) throw new Error(`deletePartnerLogo: ${error.message}`);
}

export async function reorderPartnerLogos(
  sb: SupabaseClient,
  actor: Actor,
  orderedKeys: string[],
): Promise<void> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("reorderPartnerLogos: no actor.userId");

  // Validate every key first so we don't ship a partial reorder.
  for (const k of orderedKeys) {
    if (!PARTNER_KEY_RE.test(k)) {
      throw new Error(`reorderPartnerLogos: invalid partner key ${k}`);
    }
  }
  const nowIso = new Date().toISOString();
  for (let i = 0; i < orderedKeys.length; i++) {
    const k = orderedKeys[i];
    const { error } = await sb
      .from("overlay_partner_logos")
      .update({ sort_order: i, updated_at: nowIso })
      .eq("partner_key", k)
      .is("deleted_at", null);
    if (error) {
      throw new Error(`reorderPartnerLogos at ${k}: ${error.message}`);
    }
  }
}

// ───────────────────── Per-overlay overrides ─────────────────────

export async function getOverrides(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string = "default",
): Promise<PartnerLogoOverride[]> {
  const { data, error } = await sb
    .from("overlay_partner_logo_overrides")
    .select(OVERRIDE_SELECT_COLS)
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .is("deleted_at", null);
  if (error) throw new Error(`getOverrides: ${error.message}`);
  return ((data ?? []) as OverrideRow[]).map(toOverride);
}

export async function setLogoOverride(
  sb: SupabaseClient,
  actor: Actor,
  input: PartnerLogoOverrideInput,
): Promise<PartnerLogoOverride> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("setLogoOverride: no actor.userId");
  validateOverrideInput(input);

  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("overlay_partner_logo_overrides")
    .upsert(
      {
        overlay_key: input.overlayKey,
        variant_id: input.variantId,
        partner_key: input.partnerKey,
        visible: input.visible,
        sort_override: input.sortOverride,
        set_by: actor.userId,
        updated_at: nowIso,
        deleted_at: null,
      },
      { onConflict: "overlay_key,variant_id,partner_key" },
    )
    .select(OVERRIDE_SELECT_COLS)
    .single();
  if (error) throw new Error(`setLogoOverride: ${error.message}`);
  return toOverride(data as OverrideRow);
}

export async function clearLogoOverride(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
  partnerKey: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("clearLogoOverride: no actor.userId");

  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("overlay_partner_logo_overrides")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .eq("partner_key", partnerKey)
    .is("deleted_at", null);
  if (error) throw new Error(`clearLogoOverride: ${error.message}`);
}

/**
 * Resolve the EFFECTIVE list of partner logos for a given overlay+variant.
 * Merges the global roster with per-overlay overrides:
 *   - hidden logos (override.visible=false) are excluded
 *   - sort_override (when not null) replaces global sort_order
 *   - logos without an override use their global sort_order
 *
 * Result is sorted ascending by effective sort. Soft-deleted rows
 * already filtered by `listPartnerLogos`.
 */
export async function resolvePartnerLogos(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string = "default",
): Promise<PartnerLogo[]> {
  const [logos, overrides] = await Promise.all([
    listPartnerLogos(sb),
    getOverrides(sb, overlayKey, variantId),
  ]);
  const overrideByKey = new Map<string, PartnerLogoOverride>();
  for (const o of overrides) overrideByKey.set(o.partnerKey, o);

  const visible = logos.filter((l) => {
    const o = overrideByKey.get(l.partnerKey);
    return !o || o.visible !== false;
  });

  visible.sort((a, b) => {
    const oa = overrideByKey.get(a.partnerKey);
    const ob = overrideByKey.get(b.partnerKey);
    const sa = oa?.sortOverride != null ? oa.sortOverride : a.sortOrder;
    const sb_ = ob?.sortOverride != null ? ob.sortOverride : b.sortOrder;
    return sa - sb_;
  });

  return visible;
}

// Convenience alias matching the brief naming.
export const resolveLogosForOverlay = resolvePartnerLogos;
