import {
  emptyParsedMatchStats,
  type ParsedMatchStats,
  type ParsedStatsBlock,
} from "./schemas";

/**
 * Plan 39 C5 — Tesseract path REMOVED.
 *
 * `node-tesseract-ocr@2.2.1` carried CVSS-9.8 GHSA-8j44-735h-w4w2 (OS
 * command injection through `recognize()` parameter handling and the
 * un-sanitized `binary` env var). The library has no upstream patch and
 * was only ever used as a dev convenience — production has always run on
 * the Anthropic-Claude path. Removing the dep is the cleanest fix.
 *
 * The exported surface is preserved so existing call sites + the
 * `stats_ocr/index.ts` re-export continue to type-check, but every
 * function is now a no-op that returns `{ status: 'unavailable' }`.
 *
 * If a future operator wants OCR locally and Anthropic is unset, the path
 * is hand-paste via the admin review UI (`parsed_by_engine='manual'`).
 */

// Coordinate constants kept (still used by tests + by anyone scripting a
// future replacement OCR engine). Numbers are normalized 0..1 against the
// screenshot.
export const STAT_REGIONS = {
  homeDisplayName: { x: 0.05, y: 0.08, w: 0.3, h: 0.06 },
  awayDisplayName: { x: 0.65, y: 0.08, w: 0.3, h: 0.06 },
  score: { x: 0.4, y: 0.05, w: 0.2, h: 0.12 },
  possessionHome: { x: 0.32, y: 0.38, w: 0.1, h: 0.05 },
  possessionAway: { x: 0.58, y: 0.38, w: 0.1, h: 0.05 },
  shotsHome: { x: 0.32, y: 0.46, w: 0.1, h: 0.05 },
  shotsAway: { x: 0.58, y: 0.46, w: 0.1, h: 0.05 },
  passesHome: { x: 0.32, y: 0.56, w: 0.1, h: 0.05 },
  passesAway: { x: 0.58, y: 0.56, w: 0.1, h: 0.05 },
} as const;

export type StatRegionKey = keyof typeof STAT_REGIONS;

export function parseIntOrNull(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.trim().replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const parsed = parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePercentOrNull(
  raw: string | null | undefined,
): number | null {
  const n = parseIntOrNull(raw);
  if (n == null) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

export interface TesseractParseResult {
  engine: "tesseract";
  parsed: ParsedMatchStats;
  /** Always 'unavailable' since Plan 39. */
  status: "unavailable";
}

/**
 * Kept as a type for back-compat with existing imports. The dispatcher no
 * longer accepts a tesseractClient option (see parse.ts).
 */
export interface TesseractLike {
  recognize: (
    image: Buffer | string,
    opts: { lang: string; oem: number; psm: number; binary?: string },
  ) => Promise<string>;
}

/**
 * Returns the documented unavailable result. The dispatcher in `parse.ts`
 * never invokes this anymore — kept exported for any external script that
 * may have imported it directly.
 */
export async function parseWithTesseract(
  _tesseract: TesseractLike,
  _imageBuffer: Buffer,
): Promise<TesseractParseResult> {
  return {
    engine: "tesseract",
    parsed: emptyParsedMatchStats(),
    status: "unavailable",
  };
}

export function cloneBlock(b: ParsedStatsBlock): ParsedStatsBlock {
  return { ...b };
}
