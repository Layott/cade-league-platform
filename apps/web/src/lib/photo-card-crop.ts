/**
 * Pure card-crop math + a thin browser canvas wrapper for Plan 53
 * (Mode A pipeline step 3 — auto-strip + crop a 4:5 player card from
 * a transparent-background headshot).
 *
 * Two layers:
 *   1. `computeAlphaBoundingBox` + `computeCardCropTransform` — pure,
 *      synchronous, no DOM/canvas. Tested under jsdom with synthetic
 *      `Uint8ClampedArray` data. Importable from Node test env.
 *   2. `cropToCardPng` — async, browser-only. Uses `OffscreenCanvas` +
 *      `createImageBitmap` (both globals on modern Chrome — the only
 *      target for the admin upload widget T13). Guarded so accidentally
 *      calling it from a Node context throws a clear error rather than
 *      a cryptic `ReferenceError: OffscreenCanvas is not defined`.
 *
 * Card target = 1080×1350 (4:5) per spec §5. Padding 8% means the
 * subject (its alpha bbox) is scaled to fit inside the inner safe area
 * (target × 0.84 on each axis) and centered both horizontally and
 * vertically. The transform `(scale, dx, dy)` maps source pixel coords
 * to target pixel coords: `target_x = scale * source_x + dx`.
 */

export type BBox = { x: number; y: number; w: number; h: number };
export type CardCropTransform = { scale: number; dx: number; dy: number };

/**
 * Find the tight bounding box of pixels whose alpha exceeds
 * `alphaThreshold`. Returns `null` if no pixel passes the threshold
 * (fully transparent input).
 *
 * Default threshold of 16 ignores faint anti-alias halos that
 * background-removal libraries leave behind, which would otherwise
 * inflate the bbox and force the subject to be drawn smaller than it
 * should be.
 */
export function computeAlphaBoundingBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 16,
): BBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Given a subject bbox in source pixel space and a target card size,
 * compute the affine transform (uniform scale + translate) that:
 *   - Scales the subject to fit inside the target with a uniform inner
 *     padding (`paddingPct` of each axis on both sides — default 8%).
 *   - Centers the scaled subject horizontally and vertically inside
 *     the target.
 *
 * `target_x = scale * source_x + dx`
 * `target_y = scale * source_y + dy`
 */
export function computeCardCropTransform(opts: {
  bbox: BBox;
  target: { w: number; h: number };
  paddingPct: number;
}): CardCropTransform {
  const { bbox, target, paddingPct } = opts;
  const innerW = target.w * (1 - paddingPct * 2);
  const innerH = target.h * (1 - paddingPct * 2);
  const scaleW = innerW / bbox.w;
  const scaleH = innerH / bbox.h;
  const scale = Math.min(scaleW, scaleH);
  const subjectW = bbox.w * scale;
  const subjectH = bbox.h * scale;
  const dx = (target.w - subjectW) / 2 - bbox.x * scale;
  const dy = (target.h - subjectH) / 2 - bbox.y * scale;
  return { scale, dx, dy };
}

/**
 * Browser-only: take a transparent-background source `Blob` (the
 * output of @imgly/background-removal in T13), compute its alpha bbox,
 * derive the 4:5 crop transform, render to a target-sized
 * `OffscreenCanvas`, and return PNG bytes.
 *
 * Throws if `OffscreenCanvas` / `createImageBitmap` are unavailable
 * (e.g. called from a Node test). Tests should exercise the pure
 * functions above instead.
 */
export async function cropToCardPng(
  sourceBlob: Blob,
  target: { w: number; h: number } = { w: 1080, h: 1350 },
  paddingPct = 0.08,
): Promise<Blob> {
  if (
    typeof globalThis.OffscreenCanvas === "undefined" ||
    typeof globalThis.createImageBitmap === "undefined"
  ) {
    throw new Error(
      "cropToCardPng: OffscreenCanvas / createImageBitmap are not available in this environment. This function is browser-only.",
    );
  }
  const img = await createImageBitmap(sourceBlob);
  const tmp = new OffscreenCanvas(img.width, img.height);
  const tctx = tmp.getContext("2d");
  if (!tctx) throw new Error("cropToCardPng: failed to acquire 2d context on source canvas");
  tctx.drawImage(img, 0, 0);
  const imgData = tctx.getImageData(0, 0, img.width, img.height);
  const bbox =
    computeAlphaBoundingBox(imgData.data, img.width, img.height) ?? {
      x: 0,
      y: 0,
      w: img.width,
      h: img.height,
    };
  const t = computeCardCropTransform({ bbox, target, paddingPct });
  const out = new OffscreenCanvas(target.w, target.h);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("cropToCardPng: failed to acquire 2d context on output canvas");
  ctx.clearRect(0, 0, target.w, target.h);
  ctx.setTransform(t.scale, 0, 0, t.scale, t.dx, t.dy);
  ctx.drawImage(img, 0, 0);
  return await out.convertToBlob({ type: "image/png" });
}
