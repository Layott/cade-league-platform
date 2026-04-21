import { z } from "zod";

/**
 * Plan 14 — OCR pipeline Zod shapes.
 *
 * `parsedStatsBlockSchema` is the per-side block the parser emits. Every
 * numeric field is nullable; when a parser can't read it we store null and
 * force the human reviewer to fill it. We NEVER default to zero or to a
 * guessed value — the guard-rail against hallucination is making missing
 * data visibly missing.
 */
export const parsedStatsBlockSchema = z.object({
  possessionPct: z.number().int().min(0).max(100).nullable(),
  shots: z.number().int().min(0).nullable(),
  shotsOnTarget: z.number().int().min(0).nullable(),
  passes: z.number().int().min(0).nullable(),
  passAccuracyPct: z.number().int().min(0).max(100).nullable(),
  tackles: z.number().int().min(0).nullable(),
  interceptions: z.number().int().min(0).nullable(),
  fouls: z.number().int().min(0).nullable(),
  ballRecoveries: z.number().int().min(0).nullable(),
  goals: z.number().int().min(0).nullable(),
  assists: z.number().int().min(0).nullable(),
});
export type ParsedStatsBlock = z.infer<typeof parsedStatsBlockSchema>;

export const parsedMatchStatsSchema = z.object({
  homePlayerDisplayName: z.string().min(1).max(80).nullable(),
  awayPlayerDisplayName: z.string().min(1).max(80).nullable(),
  homeScore: z.number().int().min(0).nullable(),
  awayScore: z.number().int().min(0).nullable(),
  homeStats: parsedStatsBlockSchema,
  awayStats: parsedStatsBlockSchema,
  sourceNotes: z.string().default(""),
});
export type ParsedMatchStats = z.infer<typeof parsedMatchStatsSchema>;

export const uploadInputSchema = z.object({
  matchId: z.string().uuid(),
  storagePath: z.string().min(1),
  fileSizeBytes: z.number().int().min(1).max(10 * 1024 * 1024), // 10 MB hard cap
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
});
export type UploadInput = z.infer<typeof uploadInputSchema>;

export const reviewInputSchema = z.object({
  screenshotId: z.string().uuid(),
  correctedJson: parsedMatchStatsSchema,
  homePlayerId: z.string().uuid(),
  awayPlayerId: z.string().uuid(),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export const rejectInputSchema = z.object({
  screenshotId: z.string().uuid(),
  reason: z.string().min(3).max(500),
});
export type RejectInput = z.infer<typeof rejectInputSchema>;

/**
 * Empty stats block — used when manual-entry path (OCR_DISABLED=1) seeds
 * the review form with something Zod-valid but blank.
 */
export function emptyStatsBlock(): ParsedStatsBlock {
  return {
    possessionPct: null,
    shots: null,
    shotsOnTarget: null,
    passes: null,
    passAccuracyPct: null,
    tackles: null,
    interceptions: null,
    fouls: null,
    ballRecoveries: null,
    goals: null,
    assists: null,
  };
}

export function emptyParsedMatchStats(): ParsedMatchStats {
  return {
    homePlayerDisplayName: null,
    awayPlayerDisplayName: null,
    homeScore: null,
    awayScore: null,
    homeStats: emptyStatsBlock(),
    awayStats: emptyStatsBlock(),
    sourceNotes: "",
  };
}
