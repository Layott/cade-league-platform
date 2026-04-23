import type { SupabaseClient } from "@supabase/supabase-js";
import { BRAND_TOKENS, PRIMARY_LOGOS, PARTNER_LOGOS } from "@/lib/brand";

/**
 * Plan 47 — server-side brand config reader.
 *
 * Reads `brand_settings` (singleton-ish — the row with the lowest id wins)
 * and `brand_assets` to build a unified config object. Falls back to the
 * static `lib/brand.ts` constants when the DB row is missing (fresh deploy
 * before `db:push` applied the migration). Callers: /admin/branding
 * editor + any SSR surface that wants to render the current colours or
 * a partner-logo strip.
 */

export type BrandAsset = {
  id: string;
  slot: string;
  storagePath: string;
  displayOrder: number;
  visible: boolean;
  label: string | null;
  publicUrl: string | null;
};

export type BrandConfig = {
  primaryColor: string;
  secondaryColor: string;
  primaryLogos: Record<string, string>;
  partnerLogos: BrandAsset[];
};

type SettingsRow = {
  id: number;
  primary_color: string;
  secondary_color: string;
};

type AssetRow = {
  id: string;
  slot: string;
  storage_path: string;
  display_order: number;
  visible: boolean;
  label: string | null;
};

const BRAND_LOGOS_BUCKET = "brand-logos";

function publicUrlFor(sb: SupabaseClient, storagePath: string): string | null {
  if (!storagePath) return null;
  try {
    const { data } = sb.storage
      .from(BRAND_LOGOS_BUCKET)
      .getPublicUrl(storagePath);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Load the active brand config. Fallbacks ensure a page never crashes
 * on a fresh deploy where `brand_settings` is empty.
 */
export async function getBrandConfig(sb: SupabaseClient): Promise<BrandConfig> {
  const { data: settingsRaw } = await sb
    .from("brand_settings")
    .select("id, primary_color, secondary_color")
    .order("id", { ascending: true })
    .limit(1);
  const settings = (settingsRaw?.[0] ?? null) as SettingsRow | null;

  const { data: assetsRaw } = await sb
    .from("brand_assets")
    .select("id, slot, storage_path, display_order, visible, label")
    .is("deleted_at", null)
    .order("display_order", { ascending: true });
  const allAssets = ((assetsRaw ?? []) as AssetRow[]).map<BrandAsset>((r) => ({
    id: r.id,
    slot: r.slot,
    storagePath: r.storage_path,
    displayOrder: r.display_order,
    visible: r.visible,
    label: r.label,
    publicUrl: publicUrlFor(sb, r.storage_path),
  }));

  // Build a primary-logo map (slot "primary.cade" → url), overlaying
  // any DB entries on top of the static defaults so overlay code that
  // reads PRIMARY_LOGOS.cade still works before an admin uploads a
  // replacement.
  const primaryLogos: Record<string, string> = {
    cade: PRIMARY_LOGOS.cade,
    gameevoBlack: PRIMARY_LOGOS.gameevoBlack,
    gameevoWhite: PRIMARY_LOGOS.gameevoWhite,
    proLeague: PRIMARY_LOGOS.proLeague,
  };
  for (const a of allAssets) {
    if (a.slot.startsWith("primary.") && a.publicUrl && a.visible) {
      const key = a.slot.slice("primary.".length);
      primaryLogos[key] = a.publicUrl;
    }
  }

  const partnerLogos = allAssets.filter(
    (a) => a.slot.startsWith("partner.") && a.visible,
  );

  return {
    primaryColor: settings?.primary_color ?? BRAND_TOKENS.primary,
    secondaryColor: settings?.secondary_color ?? BRAND_TOKENS.secondary,
    primaryLogos,
    partnerLogos,
  };
}

/**
 * List every asset (including hidden ones) for the admin editor.
 * Separate from getBrandConfig() — public consumers should only see
 * `visible=true` rows.
 */
export async function listAllBrandAssets(
  sb: SupabaseClient,
): Promise<BrandAsset[]> {
  const { data, error } = await sb
    .from("brand_assets")
    .select("id, slot, storage_path, display_order, visible, label")
    .is("deleted_at", null)
    .order("display_order", { ascending: true });
  if (error) throw new Error(`listAllBrandAssets failed: ${error.message}`);
  return ((data ?? []) as AssetRow[]).map((r) => ({
    id: r.id,
    slot: r.slot,
    storagePath: r.storage_path,
    displayOrder: r.display_order,
    visible: r.visible,
    label: r.label,
    publicUrl: publicUrlFor(sb, r.storage_path),
  }));
}

/**
 * Fallback defaults when the admin has uploaded nothing yet. Used to
 * seed the initial Partners tab list from the static registry so the
 * editor renders a useful starting state.
 */
export const DEFAULT_PARTNER_SEED: Array<{
  slot: string;
  label: string;
  fallbackUrl: string;
}> = [
  {
    slot: "partner.trace_tv",
    label: "Trace TV",
    fallbackUrl: PARTNER_LOGOS.traceTv,
  },
  {
    slot: "partner.gamepride",
    label: "Gamepride",
    fallbackUrl: PARTNER_LOGOS.gamepride,
  },
  {
    slot: "partner.esports_africa_news",
    label: "Esports Africa News",
    fallbackUrl: PARTNER_LOGOS.esportsAfricaNewsWhite,
  },
];

export const BRAND_LOGOS_BUCKET_NAME = BRAND_LOGOS_BUCKET;
