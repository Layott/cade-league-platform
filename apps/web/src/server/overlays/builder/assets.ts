/**
 * Overlay Builder Wave 2A — Asset CRUD (PSD subset).
 *
 * Owns the read + write surface for `overlay_user_assets` rows of
 * type `psd` plus the per-layer + flat-PNG sprites those uploads
 * spawn (asset_type='image' with psd_parent_asset_id set).
 *
 * Mirrors the SupabaseClient-first signature pattern from
 * `designs.ts` + `scenes.ts`. Snake-case at the DB boundary,
 * camelCase at the public boundary via `rowToAsset()`.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §3.4 + §9 + §10
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePsd, MAX_PSD_BYTES, PsdParseError } from "./psd-parser";

const BUCKET = "overlay-user-assets";
const PSD_MIME = "image/vnd.adobe.photoshop";
const PNG_MIME = "image/png";

export class PsdUploadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PsdUploadError";
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

export type AssetType = "image" | "psd" | "font";

export type Asset = {
  id: string;
  assetType: AssetType;
  filePath: string;
  mimeType: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  ownerUserId: string | null;
  psdLayerIndex: number | null;
  psdParentAssetId: string | null;
  flatPngAssetId: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type PsdAssetSummary = {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  layerCount: number;
  flatAssetPath: string | null;
  createdAt: string;
};

export type PsdLayerSummary = {
  id: string;
  psdLayerIndex: number;
  name: string;
  filePath: string;
  width: number | null;
  height: number | null;
};

export type UploadPsdInput = {
  bytes: Buffer;
  filename: string;
  ownerUserId: string;
};

export type UploadPsdResult = {
  parentAssetId: string;
  flatAssetId: string;
  layerAssetIds: string[];
  canvasWidth: number;
  canvasHeight: number;
};

type AssetRow = {
  id: string;
  asset_type: AssetType;
  file_path: string;
  mime_type: string;
  original_filename: string;
  width: number | null;
  height: number | null;
  size_bytes: number;
  owner_user_id: string | null;
  psd_layer_index: number | null;
  psd_parent_asset_id: string | null;
  flat_png_asset_id: string | null;
  created_at: string;
  deleted_at: string | null;
};

function rowToAsset(r: AssetRow): Asset {
  return {
    id: r.id,
    assetType: r.asset_type,
    filePath: r.file_path,
    mimeType: r.mime_type,
    originalFilename: r.original_filename,
    width: r.width,
    height: r.height,
    sizeBytes: r.size_bytes,
    ownerUserId: r.owner_user_id,
    psdLayerIndex: r.psd_layer_index,
    psdParentAssetId: r.psd_parent_asset_id,
    flatPngAssetId: r.flat_png_asset_id,
    createdAt: r.created_at,
    deletedAt: r.deleted_at,
  };
}

function newUuid(): string {
  // crypto.randomUUID is available in Node 18+
  return globalThis.crypto.randomUUID();
}

/**
 * Upload a PSD: writes bytes to storage, parses, writes flat PNG +
 * per-layer sprites to storage, writes N+2 rows to overlay_user_assets.
 *
 * If parsing fails or any storage / DB write fails, attempts a
 * best-effort rollback of partial storage objects (no transactional
 * guarantees across storage + DB — admin-team-only surface, so
 * occasional orphan blobs are acceptable; the soft-delete cascade
 * cleans them up).
 */
export async function uploadPsd(
  sb: SupabaseClient,
  input: UploadPsdInput,
): Promise<UploadPsdResult> {
  if (!input.filename.toLowerCase().endsWith(".psd")) {
    throw new PsdUploadError(`bad extension: ${input.filename}`);
  }
  if (input.bytes.byteLength > MAX_PSD_BYTES) {
    throw new PsdUploadError(
      `PSD size ${input.bytes.byteLength} exceeds 100 MB cap`,
    );
  }

  let parsed: Awaited<ReturnType<typeof parsePsd>>;
  try {
    parsed = await parsePsd(input.bytes);
  } catch (cause) {
    if (cause instanceof PsdParseError) {
      throw new PsdUploadError(cause.message, cause);
    }
    throw new PsdUploadError("could not parse PSD", cause);
  }

  const parentId = newUuid();
  const flatId = newUuid();
  const layerIds = parsed.layers.map(() => newUuid());

  const psdKey = `psd/${parentId}.psd`;
  const flatKey = `psd/${parentId}-flat.png`;
  const layerKeys = parsed.layers.map((_, n) => `psd/${parentId}-layer-${n}.png`);

  const writtenKeys: string[] = [];
  try {
    // Storage writes first; if one fails we roll back the previous ones.
    const u1 = await sb.storage.from(BUCKET).upload(psdKey, input.bytes, {
      contentType: PSD_MIME,
      upsert: false,
    } as never);
    if ((u1 as { error: unknown }).error) throw (u1 as { error: unknown }).error;
    writtenKeys.push(psdKey);

    const u2 = await sb.storage.from(BUCKET).upload(flatKey, parsed.flatPng, {
      contentType: PNG_MIME,
      upsert: false,
    } as never);
    if ((u2 as { error: unknown }).error) throw (u2 as { error: unknown }).error;
    writtenKeys.push(flatKey);

    for (let i = 0; i < parsed.layers.length; i++) {
      const uN = await sb.storage
        .from(BUCKET)
        .upload(layerKeys[i], parsed.layers[i].png, {
          contentType: PNG_MIME,
          upsert: false,
        } as never);
      if ((uN as { error: unknown }).error) throw (uN as { error: unknown }).error;
      writtenKeys.push(layerKeys[i]);
    }
  } catch (cause) {
    // Roll back any partial uploads.
    if (writtenKeys.length > 0) {
      await sb.storage
        .from(BUCKET)
        .remove(writtenKeys)
        .catch(() => undefined);
    }
    throw new PsdUploadError("storage write failed", cause);
  }

  // DB writes. Order: flat PNG + layer sprites first (parent references
  // flat_png_asset_id), then the parent row itself.
  try {
    const flatRow: Partial<AssetRow> = {
      id: flatId,
      asset_type: "image",
      file_path: flatKey,
      mime_type: PNG_MIME,
      original_filename: `${input.filename}.flat.png`,
      width: parsed.canvasWidth,
      height: parsed.canvasHeight,
      size_bytes: parsed.flatPng.byteLength,
      owner_user_id: input.ownerUserId,
      psd_parent_asset_id: parentId,
      psd_layer_index: null,
    };
    const flatInsert = await sb
      .from("overlay_user_assets")
      .insert(flatRow)
      .select("id")
      .maybeSingle();
    if ((flatInsert as { error: unknown }).error)
      throw (flatInsert as { error: unknown }).error;

    for (let i = 0; i < parsed.layers.length; i++) {
      const layer = parsed.layers[i];
      const layerWidth = layer.bounds.right - layer.bounds.left;
      const layerHeight = layer.bounds.bottom - layer.bounds.top;
      const layerRow: Partial<AssetRow> = {
        id: layerIds[i],
        asset_type: "image",
        file_path: layerKeys[i],
        mime_type: PNG_MIME,
        original_filename: `${layer.name || `Layer ${i + 1}`}.png`,
        width: layerWidth > 0 ? layerWidth : null,
        height: layerHeight > 0 ? layerHeight : null,
        size_bytes: layer.png.byteLength,
        owner_user_id: input.ownerUserId,
        psd_parent_asset_id: parentId,
        psd_layer_index: layer.index,
      };
      const ins = await sb
        .from("overlay_user_assets")
        .insert(layerRow)
        .select("id")
        .maybeSingle();
      if ((ins as { error: unknown }).error)
        throw (ins as { error: unknown }).error;
    }

    const parentRow: Partial<AssetRow> = {
      id: parentId,
      asset_type: "psd",
      file_path: psdKey,
      mime_type: PSD_MIME,
      original_filename: input.filename,
      width: parsed.canvasWidth,
      height: parsed.canvasHeight,
      size_bytes: input.bytes.byteLength,
      owner_user_id: input.ownerUserId,
      flat_png_asset_id: flatId,
      psd_parent_asset_id: null,
      psd_layer_index: null,
    };
    const parentInsert = await sb
      .from("overlay_user_assets")
      .insert(parentRow)
      .select("id")
      .maybeSingle();
    if ((parentInsert as { error: unknown }).error)
      throw (parentInsert as { error: unknown }).error;
  } catch (cause) {
    // Best-effort cleanup of storage + DB.
    await sb.storage
      .from(BUCKET)
      .remove(writtenKeys)
      .catch(() => undefined);
    await sb
      .from("overlay_user_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("psd_parent_asset_id", parentId)
      .then(() => undefined, () => undefined);
    await sb
      .from("overlay_user_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", parentId)
      .then(() => undefined, () => undefined);
    throw new PsdUploadError("DB write failed", cause);
  }

  return {
    parentAssetId: parentId,
    flatAssetId: flatId,
    layerAssetIds: layerIds,
    canvasWidth: parsed.canvasWidth,
    canvasHeight: parsed.canvasHeight,
  };
}

/**
 * List all non-deleted PSD parent rows with the layer-count aggregated
 * from sibling sprites. Used by the asset-library UI.
 */
export async function listPsdAssets(sb: SupabaseClient): Promise<PsdAssetSummary[]> {
  const { data: parents, error: pErr } = await sb
    .from("overlay_user_assets")
    .select(
      "id, original_filename, width, height, size_bytes, flat_png_asset_id, created_at, deleted_at",
    )
    .eq("asset_type", "psd")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (pErr) throw pErr;
  const out: PsdAssetSummary[] = [];
  for (const row of (parents as AssetRow[]) ?? []) {
    const { data: sprites, error: sErr } = await sb
      .from("overlay_user_assets")
      .select("id")
      .eq("psd_parent_asset_id", row.id)
      .eq("asset_type", "image")
      .is("deleted_at", null);
    if (sErr) throw sErr;
    const flatPath = row.flat_png_asset_id
      ? await (async () => {
          const { data: flat } = await sb
            .from("overlay_user_assets")
            .select("file_path")
            .eq("id", row.flat_png_asset_id)
            .maybeSingle();
          return (flat as { file_path: string } | null)?.file_path ?? null;
        })()
      : null;
    // Layer count = sprites under parent minus 1 (the flat PNG is a sibling with psd_parent_asset_id set).
    const layerCount = Math.max(0, ((sprites as unknown[]) ?? []).length - 1);
    out.push({
      id: row.id,
      originalFilename: row.original_filename,
      width: row.width,
      height: row.height,
      sizeBytes: row.size_bytes,
      layerCount,
      flatAssetPath: flatPath,
      createdAt: row.created_at,
    });
  }
  return out;
}

/**
 * List every per-layer sprite (excluding the flat PNG) for a parent PSD,
 * ordered by psd_layer_index ASC.
 */
export async function listPsdLayers(
  sb: SupabaseClient,
  parentAssetId: string,
): Promise<PsdLayerSummary[]> {
  const { data, error } = await sb
    .from("overlay_user_assets")
    .select(
      "id, psd_layer_index, original_filename, file_path, width, height, deleted_at",
    )
    .eq("psd_parent_asset_id", parentAssetId)
    .eq("asset_type", "image")
    .is("deleted_at", null)
    .order("psd_layer_index", { ascending: true });
  if (error) throw error;
  return ((data as AssetRow[]) ?? [])
    .filter((r) => r.psd_layer_index !== null)
    .map((r) => ({
      id: r.id,
      psdLayerIndex: r.psd_layer_index as number,
      name: r.original_filename.replace(/\.png$/, ""),
      filePath: r.file_path,
      width: r.width,
      height: r.height,
    }));
}

export async function getAsset(
  sb: SupabaseClient,
  assetId: string,
): Promise<Asset | null> {
  const { data, error } = await sb
    .from("overlay_user_assets")
    .select("*")
    .eq("id", assetId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowToAsset(data as AssetRow);
}

export async function softDeleteAsset(
  sb: SupabaseClient,
  assetId: string,
): Promise<void> {
  const stamp = new Date().toISOString();
  // Cascade: soft-delete sprites + flat PNG first (parent_asset_id match), then the parent row.
  {
    const { error } = await sb
      .from("overlay_user_assets")
      .update({ deleted_at: stamp })
      .eq("psd_parent_asset_id", assetId);
    if (error) throw error;
  }
  {
    const { error } = await sb
      .from("overlay_user_assets")
      .update({ deleted_at: stamp })
      .eq("id", assetId);
    if (error) throw error;
  }
}
