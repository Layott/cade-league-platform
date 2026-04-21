import { z } from "zod";

/**
 * Plan 12 — Zod payload schemas per overlay template_key.
 *
 * Single source of truth for payload shape. Used by:
 *   - events.ts (server-side validation in triggerOverlay)
 *   - the (overlay)/overlay/<key>/page.tsx client pages
 *     (defensive re-validation of realtime payloads)
 *   - admin/broadcast/[sessionId] trigger grid (schema-driven form)
 *
 * Keep these lean: the overlay visuals are stubs in this plan. Phase 2
 * proper will add polished motion / richer props.
 */

export const scorebarSchema = z.object({
  homeName: z.string().trim().min(1).max(80),
  awayName: z.string().trim().min(1).max(80),
  homeScore: z.coerce.number().int().min(0).max(99),
  awayScore: z.coerce.number().int().min(0).max(99),
  matchId: z.string().uuid().optional(),
});
export type ScorebarPayload = z.infer<typeof scorebarSchema>;

export const lowerThirdSchema = z.object({
  playerId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(80),
  gamerTag: z.string().trim().min(1).max(80),
  jerseyNumber: z.coerce.number().int().min(0).max(999),
  stats: z
    .object({
      gp: z.coerce.number().int().min(0).max(999),
      w: z.coerce.number().int().min(0).max(999),
      d: z.coerce.number().int().min(0).max(999),
      l: z.coerce.number().int().min(0).max(999),
      pts: z.coerce.number().int().min(0).max(9999),
    })
    .optional(),
});
export type LowerThirdPayload = z.infer<typeof lowerThirdSchema>;

export const standingsWidgetSchema = z.object({
  topN: z.coerce.number().int().min(1).max(20),
  rows: z
    .array(
      z.object({
        rank: z.coerce.number().int().min(1).max(999),
        displayName: z.string().trim().min(1).max(80),
        pts: z.coerce.number().int().min(-99).max(9999),
        gd: z.coerce.number().int().min(-999).max(999),
      }),
    )
    .min(1)
    .max(20),
});
export type StandingsWidgetPayload = z.infer<typeof standingsWidgetSchema>;

export const playerCardSchema = z.object({
  playerId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(80),
  photoUrl: z.string().url().max(500).optional(),
  gamerTag: z.string().trim().min(1).max(80),
  seasonStats: z.object({
    gp: z.coerce.number().int().min(0).max(999),
    w: z.coerce.number().int().min(0).max(999),
    d: z.coerce.number().int().min(0).max(999),
    l: z.coerce.number().int().min(0).max(999),
    gf: z.coerce.number().int().min(0).max(9999),
    ga: z.coerce.number().int().min(0).max(9999),
    pts: z.coerce.number().int().min(-99).max(9999),
  }),
});
export type PlayerCardPayload = z.infer<typeof playerCardSchema>;

export const punishmentTickerSchema = z.object({
  items: z
    .array(
      z.object({
        playerName: z.string().trim().min(1).max(80),
        sanction: z.string().trim().min(1).max(40),
        magnitude: z.string().trim().max(40),
        issuedAt: z.string().trim().min(1).max(40),
      }),
    )
    .min(1)
    .max(20),
});
export type PunishmentTickerPayload = z.infer<typeof punishmentTickerSchema>;

export const introSchema = z.object({
  matchDayLabel: z.string().trim().min(1).max(120),
  seasonLabel: z.string().trim().min(1).max(80),
});
export type IntroPayload = z.infer<typeof introSchema>;

export const outroSchema = z.object({
  matchDayLabel: z.string().trim().min(1).max(120),
  footer: z.string().trim().max(200).optional(),
});
export type OutroPayload = z.infer<typeof outroSchema>;
