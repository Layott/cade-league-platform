/**
 * Overlay Builder Wave 2A — PSD parser.
 *
 * Pure function: PSD bytes in → flat PNG bytes + per-layer PNG sprites
 * out. No Supabase, no filesystem, no network. Wraps `ag-psd` so the
 * rest of the builder talks to a stable interface even if the parser
 * library is swapped later.
 *
 * Hard cap 100 MB enforced by Spec §9.3. Caller is responsible for
 * rejecting before invoking us (the action layer does that for a
 * friendlier UX) — we double-check here as a safety net.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readPsd, initializeCanvas } from "ag-psd";
import { PNG } from "pngjs";

// ag-psd requires a canvas factory even when useImageData=true because
// it calls createImageData internally for scratch buffers. We supply a
// pure-JS stub so the module works under Node / Vercel Functions without
// node-canvas (which pulls native binaries the Functions runtime can't run).
initializeCanvas(
  // createCanvas stub — returns a minimal object with getContext.
  // Cast to HTMLCanvasElement since ag-psd's type signature expects it
  // but only actually uses getContext/width/height at runtime.
  ((w: number, h: number) => ({
    width: w,
    height: h,
    getContext: () => ({
      createImageData: (iw: number, ih: number) => ({
        data: new Uint8ClampedArray(iw * ih * 4),
        width: iw,
        height: ih,
      }),
      putImageData: () => undefined,
      drawImage: () => undefined,
    }),
  })) as unknown as (w: number, h: number) => HTMLCanvasElement,
  // createImageData stub — the version ag-psd calls for pixel scratch buffers
  ((w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  })) as unknown as (w: number, h: number) => ImageData,
);

export const MAX_PSD_BYTES = 100 * 1024 * 1024; // 100 MB
export const SOFT_WARN_PSD_BYTES = 50 * 1024 * 1024; // 50 MB

export class PsdParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PsdParseError";
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

export type LayerSprite = {
  /** Layer name as authored in Photoshop (may be empty). */
  name: string;
  /** Layer bounds in PSD pixel space. */
  bounds: { left: number; top: number; right: number; bottom: number };
  /** PNG bytes cropped to the layer bounds, transparent background preserved. */
  png: Buffer;
  /** 0-based depth-first index. Used to disambiguate duplicate layer names. */
  index: number;
};

export type ParsedPsd = {
  /** Full-canvas PNG flattened by the parser. */
  flatPng: Buffer;
  /** Per-layer sprites, depth-first traversal, hidden + clipping layers excluded. */
  layers: LayerSprite[];
  /** PSD canvas width in pixels. */
  canvasWidth: number;
  /** PSD canvas height in pixels. */
  canvasHeight: number;
};

/**
 * Encode an ImageData-shaped {data, width, height} payload as a PNG buffer
 * via `pngjs`. We do NOT use `node-canvas` because it adds 50+ MB of native
 * dependencies that don't run on Vercel Functions. `pngjs` is pure JS,
 * battle-tested, and writes RGBA correctly.
 */
function encodePngFromImageData(imageData: {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}): Buffer {
  const png = new PNG({ width: imageData.width, height: imageData.height });
  // Copy the channel data byte-for-byte. pngjs expects Buffer-like with R,G,B,A interleaved.
  png.data = Buffer.from(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  );
  return PNG.sync.write(png);
}

type LayerRecord = {
  name?: string;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  hidden?: boolean;
  clipping?: boolean;
  imageData?: { data: Uint8ClampedArray | Uint8Array; width: number; height: number };
  children?: LayerRecord[];
};

/**
 * Walk the layer tree depth-first, flatten groups, drop hidden + clipping
 * layers. Returns flat array of {layer, depthFirstIndex} pairs.
 */
function flattenLayerTree(
  children: ReadonlyArray<LayerRecord>,
  out: Array<{ layer: LayerRecord; index: number }> = [],
  counter = { i: 0 },
): Array<{ layer: LayerRecord; index: number }> {
  for (const layer of children) {
    if (layer.hidden === true) continue;
    if (layer.clipping === true) continue;
    if (Array.isArray(layer.children)) {
      flattenLayerTree(layer.children, out, counter);
      continue;
    }
    out.push({ layer, index: counter.i++ });
  }
  return out;
}

export async function parsePsd(buffer: Buffer): Promise<ParsedPsd> {
  if (!Buffer.isBuffer(buffer)) {
    throw new PsdParseError("parsePsd requires a Buffer");
  }
  if (buffer.byteLength > MAX_PSD_BYTES) {
    throw new PsdParseError(
      `PSD size ${buffer.byteLength} exceeds 100 MB cap (${MAX_PSD_BYTES})`,
    );
  }
  if (buffer.byteLength < 26) {
    throw new PsdParseError("PSD too small to be valid");
  }
  // Magic: '8BPS' at offset 0.
  if (
    buffer[0] !== 0x38 ||
    buffer[1] !== 0x42 ||
    buffer[2] !== 0x50 ||
    buffer[3] !== 0x53
  ) {
    throw new PsdParseError("could not parse PSD — bad signature");
  }

  // ag-psd needs ArrayBuffer (not Buffer). Slice gives us a fresh AB so the
  // underlying memory is owned by us and not surprised by the original buffer.
  let psd: ReturnType<typeof readPsd>;
  try {
    psd = readPsd(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      {
        skipLayerImageData: false,
        skipCompositeImageData: false,
        skipThumbnail: true,
        useImageData: true,
      },
    );
  } catch (cause) {
    throw new PsdParseError("could not parse PSD — parser raised", cause);
  }

  const canvasWidth = psd.width ?? 0;
  const canvasHeight = psd.height ?? 0;
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    throw new PsdParseError("could not parse PSD — missing canvas dimensions");
  }

  // Flat composite — ag-psd populates `psd.imageData` when useImageData=true.
  let flatPng: Buffer;
  try {
    const composite = psd.imageData as
      | { data: Uint8ClampedArray; width: number; height: number }
      | undefined;
    if (!composite) {
      throw new PsdParseError("could not parse PSD — no composite image data");
    }
    flatPng = encodePngFromImageData(composite);
  } catch (cause) {
    if (cause instanceof PsdParseError) throw cause;
    throw new PsdParseError("could not parse PSD — flat-PNG encode failed", cause);
  }

  // Per-layer sprites.
  const layerOut: LayerSprite[] = [];
  const flatChildren = Array.isArray(psd.children)
    ? (psd.children as LayerRecord[])
    : [];
  const walk = flattenLayerTree(flatChildren);
  for (const { layer, index } of walk) {
    const layerImageData = layer.imageData;
    if (!layerImageData || layerImageData.width === 0 || layerImageData.height === 0)
      continue;
    const png = encodePngFromImageData(layerImageData);
    layerOut.push({
      name: typeof layer.name === "string" ? layer.name : `Layer ${index + 1}`,
      bounds: {
        left: Number(layer.left ?? 0),
        top: Number(layer.top ?? 0),
        right: Number(layer.right ?? layerImageData.width),
        bottom: Number(layer.bottom ?? layerImageData.height),
      },
      png,
      index,
    });
  }

  return { flatPng, layers: layerOut, canvasWidth, canvasHeight };
}

/** Storage bucket holding every overlay-builder user asset. */
const BUCKET = "overlay-user-assets";
const PNG_MIME = "image/png";

/**
 * Wave 2A binding consumed by the Wave 2B Photopea bridge.
 *
 * Parses `psdBytes`, then for each non-hidden non-clipping layer:
 *   1. Uploads the layer PNG to `psd/<parentAssetId>-layer-<i>.png`.
 *   2. Inserts an `overlay_user_assets` row with
 *      `asset_type='image'` + `psd_parent_asset_id=parentAssetId`.
 * Also uploads the flat composite PNG to `psd/<parentAssetId>-flat.png`
 * and inserts its asset row. Returns the new flat-PNG asset id plus
 * the sprite asset ids in depth-first order.
 *
 * Does NOT touch the parent PSD row's `flat_png_asset_id` — the
 * bridge re-links separately so a partial failure here doesn't
 * orphan the parent.
 *
 * Signature mirrors the `ParsePsd` callback type in
 * `photopea-bridge.ts` so the bridge can mock it via `vi.fn()` in
 * unit tests without loading `ag-psd`.
 */
export async function parsePsdAndStoreSprites(
  sb: SupabaseClient,
  args: { readonly parentAssetId: string; readonly psdBytes: Uint8Array },
): Promise<{
  readonly flatPngAssetId: string;
  readonly spriteAssetIds: readonly string[];
}> {
  const { parentAssetId, psdBytes } = args;
  const buffer = Buffer.from(
    psdBytes.buffer,
    psdBytes.byteOffset,
    psdBytes.byteLength,
  );
  const parsed = await parsePsd(buffer);

  const flatPngAssetId = globalThis.crypto.randomUUID();
  const spriteAssetIds: string[] = parsed.layers.map(() =>
    globalThis.crypto.randomUUID(),
  );
  const flatKey = `psd/${parentAssetId}-flat.png`;
  const layerKeys = parsed.layers.map(
    (_, n) => `psd/${parentAssetId}-layer-${n}.png`,
  );

  // Storage writes first. Best-effort cleanup on failure: a future
  // re-run will overwrite via upsert=true so orphaned blobs are
  // tolerable in the admin-only surface.
  const flatUp = (await sb.storage.from(BUCKET).upload(flatKey, parsed.flatPng, {
    contentType: PNG_MIME,
    upsert: true,
  } as never)) as { error: { message: string } | null };
  if (flatUp?.error != null) {
    throw new Error(`flat PNG upload failed: ${flatUp.error.message}`);
  }
  for (let i = 0; i < parsed.layers.length; i++) {
    const layerUp = (await sb.storage
      .from(BUCKET)
      .upload(layerKeys[i], parsed.layers[i].png, {
        contentType: PNG_MIME,
        upsert: true,
      } as never)) as { error: { message: string } | null };
    if (layerUp?.error != null) {
      throw new Error(
        `layer ${i} PNG upload failed: ${layerUp.error.message}`,
      );
    }
  }

  // DB writes — flat PNG row first, then sprites.
  const flatIns = (await sb
    .from("overlay_user_assets")
    .insert({
      id: flatPngAssetId,
      asset_type: "image",
      file_path: flatKey,
      mime_type: PNG_MIME,
      original_filename: `${parentAssetId}.flat.png`,
      width: parsed.canvasWidth,
      height: parsed.canvasHeight,
      size_bytes: parsed.flatPng.byteLength,
      psd_parent_asset_id: parentAssetId,
      psd_layer_index: null,
    })) as { error: { message: string } | null };
  if (flatIns?.error != null) {
    throw new Error(`flat PNG row insert failed: ${flatIns.error.message}`);
  }

  for (let i = 0; i < parsed.layers.length; i++) {
    const layer = parsed.layers[i];
    const w = layer.bounds.right - layer.bounds.left;
    const h = layer.bounds.bottom - layer.bounds.top;
    const layerIns = (await sb
      .from("overlay_user_assets")
      .insert({
        id: spriteAssetIds[i],
        asset_type: "image",
        file_path: layerKeys[i],
        mime_type: PNG_MIME,
        original_filename: `${layer.name || `Layer ${i + 1}`}.png`,
        width: w > 0 ? w : null,
        height: h > 0 ? h : null,
        size_bytes: layer.png.byteLength,
        psd_parent_asset_id: parentAssetId,
        psd_layer_index: layer.index,
      })) as { error: { message: string } | null };
    if (layerIns?.error != null) {
      throw new Error(
        `layer ${i} row insert failed: ${layerIns.error.message}`,
      );
    }
  }

  return { flatPngAssetId, spriteAssetIds };
}
