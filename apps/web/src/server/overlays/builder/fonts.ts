/**
 * Overlay Builder — custom font upload server module.
 *
 * Pipeline:
 *   1. Validate input via FontUploadSchema (size + MIME).
 *   2. Parse with fontkit to extract familyName, weight, style.
 *   3. If MIME != woff2, convert original buffer to WOFF2 via
 *      ttf2woff2 (browser-friendly format).
 *   4. Upload original + converted bytes to `overlay-user-assets`
 *      Supabase Storage bucket.
 *   5. Insert one `overlay_user_assets` row per uploaded file.
 *   6. Insert one `overlay_user_design_fonts` row linking the two
 *      asset rows.
 *
 * WOFF2 library: ttf2woff2 v8 (native N-API binding, bundles WASM
 * fallback). No wawoff2 needed — ttf2woff2 is already in package.json.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §4 + §10
 */

import fontkit from "fontkit";
import ttf2woff2 from "ttf2woff2";
import { FontUploadSchema } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "overlay-user-assets";

export type FontRow = {
  id: string;
  family_name: string;
  weight: number;
  style: "normal" | "italic";
  format: "ttf" | "otf" | "woff" | "woff2";
  asset_id: string;
  woff2_asset_id: string | null;
  deleted_at: string | null;
};

export type UploadResult = {
  id: string;
  familyName: string;
  weight: number;
  style: "normal" | "italic";
};

function detectFormat(mimeType: string): "ttf" | "otf" | "woff" | "woff2" {
  if (mimeType.includes("woff2")) return "woff2";
  if (mimeType.includes("woff")) return "woff";
  if (mimeType.includes("otf") || mimeType.includes("opentype")) return "otf";
  return "ttf";
}

function inferWeight(subfamily: string | undefined): number {
  if (!subfamily) return 400;
  const s = subfamily.toLowerCase();
  if (s.includes("thin")) return 100;
  if (s.includes("extralight") || s.includes("ultralight")) return 200;
  if (s.includes("light")) return 300;
  if (s.includes("medium")) return 500;
  if (s.includes("semibold") || s.includes("demibold")) return 600;
  if (s.includes("extrabold") || s.includes("ultrabold")) return 800;
  if (s.includes("black") || s.includes("heavy")) return 900;
  if (s.includes("bold")) return 700;
  return 400;
}

function inferStyle(subfamily: string | undefined): "normal" | "italic" {
  if (!subfamily) return "normal";
  return /italic|oblique/i.test(subfamily) ? "italic" : "normal";
}

export async function uploadFont(
  sb: SupabaseClient,
  _actor: string,
  input: { fileBuffer: Buffer; filename: string; mimeType: string },
): Promise<UploadResult> {
  const parsed = FontUploadSchema.safeParse({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.fileBuffer.length,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid font upload: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  // 1. fontkit parse.
  const font = (fontkit as unknown as { create: (b: Buffer) => any }).create(
    input.fileBuffer,
  );
  const familyName: string = font.familyName ?? "Unnamed";
  const subfamily: string | undefined = font.subfamilyName;
  const weight = inferWeight(subfamily);
  const style = inferStyle(subfamily);
  const format = detectFormat(input.mimeType);

  // 2. Upload original.
  const stamp = Date.now().toString(36);
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const origPath = `fonts/${stamp}-${safeName}`;
  const upOrig = await sb.storage.from(BUCKET).upload(origPath, input.fileBuffer);
  if (upOrig.error) throw upOrig.error;

  const { data: origAsset, error: origErr } = await sb
    .from("overlay_user_assets")
    .insert({
      asset_type: "font",
      file_path: origPath,
      mime_type: input.mimeType,
      original_filename: input.filename,
      size_bytes: input.fileBuffer.length,
    })
    .select()
    .single();
  if (origErr || !origAsset) throw origErr ?? new Error("orig asset insert failed");
  const origAssetId = (origAsset as { id: string }).id;

  // 3. Convert to WOFF2 unless already WOFF2.
  let woff2AssetId: string | null = null;
  if (format !== "woff2") {
    const woff2Bytes = (
      ttf2woff2 as unknown as (b: Buffer) => Buffer
    )(input.fileBuffer);
    const woff2Path = `${origPath}.woff2`;
    const upConv = await sb.storage.from(BUCKET).upload(woff2Path, woff2Bytes);
    if (upConv.error) throw upConv.error;

    const { data: woff2Asset, error: woff2Err } = await sb
      .from("overlay_user_assets")
      .insert({
        asset_type: "font",
        file_path: woff2Path,
        mime_type: "font/woff2",
        original_filename: input.filename.replace(/\.(ttf|otf|woff)$/i, ".woff2"),
        size_bytes: woff2Bytes.length,
      })
      .select()
      .single();
    if (woff2Err || !woff2Asset) {
      throw woff2Err ?? new Error("woff2 asset insert failed");
    }
    woff2AssetId = (woff2Asset as { id: string }).id;
  }

  // 4. Insert font row.
  const { data: fontRow, error: fontErr } = await sb
    .from("overlay_user_design_fonts")
    .insert({
      family_name: familyName,
      weight,
      style,
      format,
      asset_id: origAssetId,
      woff2_asset_id: woff2AssetId,
    })
    .select()
    .single();
  if (fontErr || !fontRow) {
    throw fontErr ?? new Error("font row insert failed");
  }

  return {
    id: (fontRow as { id: string }).id,
    familyName,
    weight,
    style,
  };
}

export async function listFonts(sb: SupabaseClient): Promise<FontRow[]> {
  const { data, error } = await (sb
    .from("overlay_user_design_fonts")
    .select(
      "id, family_name, weight, style, format, asset_id, woff2_asset_id, deleted_at",
    )
    .is("deleted_at", null)
    .order("family_name") as unknown as Promise<{
    data: FontRow[] | null;
    error: { message: string } | null;
  }>);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function softDeleteFont(
  sb: SupabaseClient,
  _actor: string,
  fontId: string,
): Promise<void> {
  const { error } = await sb
    .from("overlay_user_design_fonts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", fontId)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
}

export async function getFontFaceCss(
  sb: SupabaseClient,
  fontId: string,
): Promise<string> {
  const { data: fontRow, error: fontErr } = await sb
    .from("overlay_user_design_fonts")
    .select("family_name, weight, style, woff2_asset_id, asset_id")
    .eq("id", fontId)
    .is("deleted_at", null)
    .maybeSingle();
  if (fontErr || !fontRow) {
    throw fontErr ?? new Error(`font ${fontId} not found`);
  }
  const f = fontRow as {
    family_name: string;
    weight: number;
    style: "normal" | "italic";
    woff2_asset_id: string | null;
    asset_id: string;
  };
  const assetId = f.woff2_asset_id ?? f.asset_id;
  const { data: assetRow, error: assetErr } = await sb
    .from("overlay_user_assets")
    .select("file_path")
    .eq("id", assetId)
    .is("deleted_at", null)
    .maybeSingle();
  if (assetErr || !assetRow) {
    throw assetErr ?? new Error(`asset ${assetId} not found`);
  }
  const path = (assetRow as { file_path: string }).file_path;
  return `@font-face { font-family: '${f.family_name}'; src: url('/overlay-user-assets/${path}') format('woff2'); font-weight: ${f.weight}; font-style: ${f.style}; font-display: swap; }`;
}
