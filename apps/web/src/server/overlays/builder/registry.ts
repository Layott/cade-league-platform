/**
 * Overlay Builder — registry for the broadcast control panel's Custom
 * tab.
 *
 * Lists every published user design joined against its dynamic
 * template_variants row. Filters out drafts, soft-deletes, and any
 * variant row that has been soft-deleted independently (unpublish path).
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §4
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type PublishedUserDesign = {
  id: string;
  slug: string;
  title: string;
  overlayKey: `user-${string}`;
  thumbnailUrl: string | null;
  updatedAt: string;
};

type DesignRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  updated_at: string | null;
  thumbnail_path: string | null;
  deleted_at: string | null;
};

type VariantRow = {
  overlay_key: string;
  thumbnail_path: string | null;
  active: boolean;
  kind: string;
  deleted_at: string | null;
};

export async function listPublishedUserDesigns(
  sb: SupabaseClient,
): Promise<PublishedUserDesign[]> {
  const { data: designsData, error: designsErr } = await sb
    .from("overlay_user_designs")
    .select("*")
    .eq("status", "published")
    .is("deleted_at", null);
  if (designsErr)
    throw new Error(`listPublishedUserDesigns designs: ${designsErr.message}`);

  const { data: variantsData, error: variantsErr } = await sb
    .from("overlay_template_variants")
    .select("*")
    .eq("kind", "dynamic")
    .is("deleted_at", null);
  if (variantsErr)
    throw new Error(`listPublishedUserDesigns variants: ${variantsErr.message}`);

  const designs = (designsData ?? []) as DesignRow[];
  const variantsByKey = new Map<string, VariantRow>();
  for (const v of (variantsData ?? []) as VariantRow[]) {
    // Application-level guard: skip soft-deleted variant rows that the
    // mock's is() no-op may have let through.
    if (v.deleted_at != null) continue;
    variantsByKey.set(v.overlay_key, v);
  }

  const out: PublishedUserDesign[] = [];
  for (const d of designs) {
    // Application-level guard: skip soft-deleted design rows that the
    // mock's is() no-op may have let through.
    if (d.deleted_at != null) continue;
    const overlayKey = `user-${d.slug}` as `user-${string}`;
    const variant = variantsByKey.get(overlayKey);
    if (!variant) continue;
    out.push({
      id: d.id,
      slug: d.slug,
      title: d.title,
      overlayKey,
      thumbnailUrl: variant.thumbnail_path ?? d.thumbnail_path ?? null,
      updatedAt: d.updated_at ?? "",
    });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
