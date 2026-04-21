import {
  parsedMatchStatsSchema,
  emptyParsedMatchStats,
  type ParsedMatchStats,
  type ParsedStatsBlock,
} from "./schemas";

/**
 * Plan 14 — Tesseract dev fallback.
 *
 * Tesseract runs only when ANTHROPIC_API_KEY is missing AND OCR_DISABLED is
 * not set. Prod never exercises this path (Vercel has no Tesseract binary
 * installed). It's a best-effort crop-based heuristic whose main value is
 * letting local dev test the review flow without burning Anthropic credits.
 *
 * Calibration for eFootball end-screens is in STAT_REGIONS; numbers are
 * normalized 0..1 coords so the same config works across 1080p / 1440p.
 * Fields Tesseract cannot parse confidently emit null (never 0 or a guess).
 */

export const STAT_REGIONS = {
  // x, y, w, h normalized 0..1 against the screenshot.
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

/**
 * Parse a single string into an int, or null if unparseable. Never returns
 * 0 for unparseable input — that would masquerade as a legitimate reading.
 */
export function parseIntOrNull(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.trim().replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const parsed = parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * "54%" → 54. "—" or "N/A" → null.
 */
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
}

export interface TesseractLike {
  recognize: (
    image: Buffer | string,
    opts: { lang: string; oem: number; psm: number; binary?: string },
  ) => Promise<string>;
}

function bin(): string | undefined {
  return process.env.TESSERACT_BIN ?? "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
}

/**
 * Minimal heuristic — passes the full image through a single tesseract OCR
 * call (no sharp crops in the fallback). Then sprays regex against the text
 * for the stats we care about. Any field not matched stays null.
 *
 * This is deliberately dumb — it exists to unblock local dev review flow.
 * Prod uses Claude.
 */
export async function parseWithTesseract(
  tesseract: TesseractLike,
  imageBuffer: Buffer,
): Promise<TesseractParseResult> {
  const rawText = await tesseract.recognize(imageBuffer, {
    lang: "eng",
    oem: 1,
    psm: 6,
    binary: bin(),
  });

  const parsed = emptyParsedMatchStats();

  // Possession: look for two percentages close together.
  const possMatch = rawText.match(/(\d{1,3})\s*%[^\d]{1,30}(\d{1,3})\s*%/);
  if (possMatch) {
    parsed.homeStats.possessionPct = parsePercentOrNull(possMatch[1]);
    parsed.awayStats.possessionPct = parsePercentOrNull(possMatch[2]);
  }

  // Shots: "Shots 11 4" or similar
  const shotsMatch = rawText.match(/shots[^\d]{0,30}(\d{1,3})[^\d]{1,30}(\d{1,3})/i);
  if (shotsMatch) {
    parsed.homeStats.shots = parseIntOrNull(shotsMatch[1]);
    parsed.awayStats.shots = parseIntOrNull(shotsMatch[2]);
  }

  // Score: "3 - 1" or "3 : 1"
  const scoreMatch = rawText.match(/(\d{1,2})\s*[-:]\s*(\d{1,2})/);
  if (scoreMatch) {
    parsed.homeScore = parseIntOrNull(scoreMatch[1]);
    parsed.awayScore = parseIntOrNull(scoreMatch[2]);
  }

  parsed.sourceNotes = "tesseract dev fallback";

  // Final safety: Zod-validate. If somehow a field slips out of range it
  // becomes null via the catch — we never hand a malformed result back.
  const result = parsedMatchStatsSchema.safeParse(parsed);
  const safe = result.success ? result.data : emptyParsedMatchStats();
  return { engine: "tesseract", parsed: safe };
}

/**
 * Exported so tests can assert stats-block identity without importing Zod
 * schemas into the test file.
 */
export function cloneBlock(b: ParsedStatsBlock): ParsedStatsBlock {
  return { ...b };
}
