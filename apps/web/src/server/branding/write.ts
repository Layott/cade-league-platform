import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 47 — brand config writers.
 *
 * All writes assume a service-role SupabaseClient. Admin gating is
 * enforced in the page-level action via `requirePermAsync(sb, actor,
 * 'branding.manage')` before reaching these helpers.
 */

const HEX_RE = /^#[0-9a-f]{6}$/i;

function assertHex(value: string, label: string): void {
  if (!HEX_RE.test(value)) {
    throw new Error(`${label} must be a 6-digit hex color (got: ${value})`);
  }
}

export async function upsertBrandSettings(
  sb: SupabaseClient,
  input: {
    primaryColor?: string;
    secondaryColor?: string;
    userId: string;
  },
): Promise<void> {
  if (input.primaryColor) assertHex(input.primaryColor, "primaryColor");
  if (input.secondaryColor) assertHex(input.secondaryColor, "secondaryColor");

  const { data: existing } = await sb
    .from("brand_settings")
    .select("id")
    .order("id", { ascending: true })
    .limit(1);
  const existingId = (existing?.[0] as { id: number } | undefined)?.id;

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: input.userId,
  };
  if (input.primaryColor) patch.primary_color = input.primaryColor;
  if (input.secondaryColor) patch.secondary_color = input.secondaryColor;

  if (existingId) {
    const { error } = await sb
      .from("brand_settings")
      .update(patch)
      .eq("id", existingId);
    if (error) throw new Error(`upsertBrandSettings update: ${error.message}`);
  } else {
    const insert: Record<string, unknown> = {
      primary_color: input.primaryColor ?? "#6bcd06",
      secondary_color: input.secondaryColor ?? "#fe036d",
      updated_by: input.userId,
    };
    const { error } = await sb.from("brand_settings").insert(insert);
    if (error) throw new Error(`upsertBrandSettings insert: ${error.message}`);
  }
}

export async function upsertBrandAsset(
  sb: SupabaseClient,
  input: {
    slot: string;
    storagePath: string;
    displayOrder?: number;
    visible?: boolean;
    label?: string | null;
    userId: string;
  },
): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    slot: input.slot,
    storage_path: input.storagePath,
    display_order: input.displayOrder ?? 0,
    visible: input.visible ?? true,
    label: input.label ?? null,
    updated_at: now,
    updated_by: input.userId,
    deleted_at: null,
  };

  const { data, error } = await sb
    .from("brand_assets")
    .upsert(row, { onConflict: "slot" })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`upsertBrandAsset: ${error?.message ?? "no row"}`);
  }
  return { id: (data as { id: string }).id };
}

export async function setBrandAssetVisible(
  sb: SupabaseClient,
  id: string,
  visible: boolean,
  userId: string,
): Promise<void> {
  const { error } = await sb
    .from("brand_assets")
    .update({
      visible,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(`setBrandAssetVisible: ${error.message}`);
}

export async function deleteBrandAsset(
  sb: SupabaseClient,
  id: string,
  userId: string,
): Promise<void> {
  const { error } = await sb
    .from("brand_assets")
    .update({
      deleted_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(`deleteBrandAsset: ${error.message}`);
}
