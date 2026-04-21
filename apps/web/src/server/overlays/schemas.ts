import { z } from "zod";

/**
 * Overlay payload schemas — per overlay template_key.
 *
 * Plan 12 originals (7) + Plan 16 additions (20) live here. Every
 * Plan 16 schema accepts an optional `soundSlot` field (see
 * `lib/overlay-sound.ts` for the slot registry). Missing / null → silent.
 *
 * Single source of truth for payload shape. Used by:
 *   - events.ts (server-side validation in triggerOverlay)
 *   - the (overlay)/overlay/<key>/page.tsx client pages
 *     (defensive re-validation of realtime payloads)
 *   - admin/broadcast/[sessionId] trigger grid (schema-driven form)
 */

/** Shared optional stinger / whoosh slot key. */
export const soundSlotSchema = z
  .enum([
    "stinger-intro",
    "stinger-normal",
    "stinger-replay",
    "stinger-goal",
    "stinger-winner",
    "whoosh-short",
    "whoosh-long",
    "tick-1s",
    "timer-end",
    "notification",
    "logo-thump",
  ])
  .nullable()
  .optional();
export type SoundSlot = z.infer<typeof soundSlotSchema>;

// Player-ish shorthand — `displayName` + optional headshot URL.
const playerLiteSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  gamerTag: z.string().trim().min(1).max(80).optional(),
  photoUrl: z.string().url().max(500).optional(),
});

const socialsSchema = z
  .object({
    twitter: z.string().trim().max(80).optional(),
    instagram: z.string().trim().max(80).optional(),
    tiktok: z.string().trim().max(80).optional(),
    youtube: z.string().trim().max(80).optional(),
  })
  .partial();

// -- Plan 12 originals --------------------------------------------------

export const scorebarSchema = z.object({
  homeName: z.string().trim().min(1).max(80),
  awayName: z.string().trim().min(1).max(80),
  homeScore: z.coerce.number().int().min(0).max(99),
  awayScore: z.coerce.number().int().min(0).max(99),
  matchId: z.string().uuid().optional(),
  soundSlot: soundSlotSchema,
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
  soundSlot: soundSlotSchema,
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
  soundSlot: soundSlotSchema,
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
  soundSlot: soundSlotSchema,
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
  soundSlot: soundSlotSchema,
});
export type PunishmentTickerPayload = z.infer<typeof punishmentTickerSchema>;

export const introSchema = z.object({
  matchDayLabel: z.string().trim().min(1).max(120),
  seasonLabel: z.string().trim().min(1).max(80),
  soundSlot: soundSlotSchema,
});
export type IntroPayload = z.infer<typeof introSchema>;

export const outroSchema = z.object({
  matchDayLabel: z.string().trim().min(1).max(120),
  footer: z.string().trim().max(200).optional(),
  soundSlot: soundSlotSchema,
});
export type OutroPayload = z.infer<typeof outroSchema>;

// -- Plan 16 additions --------------------------------------------------

// Group A — stingers
export const stingerIntroSchema = z.object({
  seasonLabel: z.string().trim().min(1).max(80),
  matchDayLabel: z.string().trim().min(1).max(80).optional(),
  soundSlot: soundSlotSchema,
});
export type StingerIntroPayload = z.infer<typeof stingerIntroSchema>;

export const stingerNormalSchema = z.object({
  soundSlot: soundSlotSchema,
});
export type StingerNormalPayload = z.infer<typeof stingerNormalSchema>;

export const stingerReplaySchema = z.object({
  soundSlot: soundSlotSchema,
});
export type StingerReplayPayload = z.infer<typeof stingerReplaySchema>;

export const stingerGoalSchema = z.object({
  scorerDisplayName: z.string().trim().min(1).max(80).optional(),
  scorerPhotoUrl: z.string().url().max(500).optional(),
  soundSlot: soundSlotSchema,
});
export type StingerGoalPayload = z.infer<typeof stingerGoalSchema>;

export const stingerWinnerSchema = z.object({
  winnerDisplayName: z.string().trim().min(1).max(80),
  winnerPhotoUrl: z.string().url().max(500).optional(),
  finalScore: z
    .object({
      home: z.coerce.number().int().min(0).max(99),
      away: z.coerce.number().int().min(0).max(99),
    })
    .optional(),
  soundSlot: soundSlotSchema,
});
export type StingerWinnerPayload = z.infer<typeof stingerWinnerSchema>;

// Group B — persistent layouts
export const layout4PipSchema = z.object({
  cells: z.array(playerLiteSchema).length(4),
  soundSlot: soundSlotSchema,
});
export type Layout4PipPayload = z.infer<typeof layout4PipSchema>;

export const layout2PipSchema = z.object({
  cells: z.array(playerLiteSchema).length(2),
  soundSlot: soundSlotSchema,
});
export type Layout2PipPayload = z.infer<typeof layout2PipSchema>;

export const layoutBrbFullSchema = z.object({
  resumeAt: z.string().datetime().optional(),
  adVideoUrl: z.string().url().max(500).optional(),
  socials: socialsSchema.optional(),
  message: z.string().trim().max(200).optional(),
  soundSlot: soundSlotSchema,
});
export type LayoutBrbFullPayload = z.infer<typeof layoutBrbFullSchema>;

export const layoutBrbBasicSchema = z.object({
  message: z.string().trim().max(200).optional(),
  soundSlot: soundSlotSchema,
});
export type LayoutBrbBasicPayload = z.infer<typeof layoutBrbBasicSchema>;

export const layoutTimerSchema = z.object({
  expiresAt: z.string().datetime(),
  label: z.string().trim().max(40).optional(),
  soundSlot: soundSlotSchema,
});
export type LayoutTimerPayload = z.infer<typeof layoutTimerSchema>;

export const layoutAnimatedBgSchema = z.object({
  intensity: z.enum(["low", "medium", "high"]).default("medium").optional(),
  soundSlot: soundSlotSchema,
});
export type LayoutAnimatedBgPayload = z.infer<typeof layoutAnimatedBgSchema>;

export const layoutCastersChatSchema = z.object({
  chat: z
    .array(
      z.object({
        user: z.string().trim().min(1).max(40),
        msg: z.string().trim().min(1).max(240),
        ts: z.string().trim().max(40).optional(),
      }),
    )
    .max(50)
    .default([]),
  ticker: z.string().trim().max(240).optional(),
  soundSlot: soundSlotSchema,
});
export type LayoutCastersChatPayload = z.infer<typeof layoutCastersChatSchema>;

// Group C — matchup cards
const h2hPlayerSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  gamerTag: z.string().trim().min(1).max(80).optional(),
  photoUrl: z.string().url().max(500).optional(),
  h2hStats: z
    .object({
      w: z.coerce.number().int().min(0).max(999),
      d: z.coerce.number().int().min(0).max(999),
      l: z.coerce.number().int().min(0).max(999),
    })
    .optional(),
});

export const h2h2Schema = z.object({
  players: z.array(h2hPlayerSchema).length(2),
  soundSlot: soundSlotSchema,
});
export type H2H2Payload = z.infer<typeof h2h2Schema>;

export const h2h3Schema = z.object({
  players: z.array(h2hPlayerSchema).length(3),
  soundSlot: soundSlotSchema,
});
export type H2H3Payload = z.infer<typeof h2h3Schema>;

export const h2h5Schema = z.object({
  players: z.array(h2hPlayerSchema).min(3).max(5),
  soundSlot: soundSlotSchema,
});
export type H2H5Payload = z.infer<typeof h2h5Schema>;

// Group D — data displays
export const leaderboardAnimatedSchema = z.object({
  topN: z.coerce.number().int().min(1).max(20),
  rows: z
    .array(
      z.object({
        rank: z.coerce.number().int().min(1).max(999),
        displayName: z.string().trim().min(1).max(80),
        pts: z.coerce.number().int().min(-99).max(9999),
        gd: z.coerce.number().int().min(-999).max(999),
        delta: z.coerce.number().int().min(-99).max(99).optional(),
      }),
    )
    .min(1)
    .max(20),
  soundSlot: soundSlotSchema,
});
export type LeaderboardAnimatedPayload = z.infer<typeof leaderboardAnimatedSchema>;

export const scoreBugSchema = z.object({
  players: z
    .array(
      z.object({
        displayName: z.string().trim().min(1).max(80),
        photoUrl: z.string().url().max(500).optional(),
        score: z.coerce.number().int().min(0).max(99),
      }),
    )
    .length(2),
  matchId: z.string().uuid().optional(),
  soundSlot: soundSlotSchema,
});
export type ScoreBugPayload = z.infer<typeof scoreBugSchema>;

export const upNextBugSchema = z.object({
  home: playerLiteSchema,
  away: playerLiteSchema,
  kickoffAt: z.string().datetime(),
  soundSlot: soundSlotSchema,
});
export type UpNextBugPayload = z.infer<typeof upNextBugSchema>;

export const matchScoresDaySchema = z.object({
  matchDayLabel: z.string().trim().min(1).max(120),
  rows: z
    .array(
      z.object({
        home: z.string().trim().min(1).max(80),
        away: z.string().trim().min(1).max(80),
        homeScore: z.coerce.number().int().min(0).max(99).nullable(),
        awayScore: z.coerce.number().int().min(0).max(99).nullable(),
        status: z.enum(["scheduled", "in_progress", "completed"]),
      }),
    )
    .max(40)
    .default([]),
  soundSlot: soundSlotSchema,
});
export type MatchScoresDayPayload = z.infer<typeof matchScoresDaySchema>;

// Group E — full-screen states
export const startingSoonBasicSchema = z.object({
  subtitle: z.string().trim().max(120).optional(),
  soundSlot: soundSlotSchema,
});
export type StartingSoonBasicPayload = z.infer<typeof startingSoonBasicSchema>;

export const startingSoonTimerSchema = z.object({
  startsAt: z.string().datetime(),
  adVideoUrl: z.string().url().max(500).optional(),
  soundSlot: soundSlotSchema,
});
export type StartingSoonTimerPayload = z.infer<typeof startingSoonTimerSchema>;

export const streamEndedSchema = z.object({
  subtitle: z.string().trim().max(120).optional(),
  socials: socialsSchema.optional(),
  soundSlot: soundSlotSchema,
});
export type StreamEndedPayload = z.infer<typeof streamEndedSchema>;

// Group F — stats overlays
export const topScorersSchema = z.object({
  rows: z
    .array(
      z.object({
        rank: z.coerce.number().int().min(1).max(999),
        displayName: z.string().trim().min(1).max(80),
        photoUrl: z.string().url().max(500).optional(),
        goals: z.coerce.number().int().min(0).max(9999),
      }),
    )
    .max(10)
    .default([]),
  soundSlot: soundSlotSchema,
});
export type TopScorersPayload = z.infer<typeof topScorersSchema>;

export const orgsRosterSchema = z.object({
  org: z.object({
    name: z.string().trim().min(1).max(80),
    logoUrl: z.string().url().max(500).optional(),
  }),
  players: z.array(playerLiteSchema).max(20).default([]),
  soundSlot: soundSlotSchema,
});
export type OrgsRosterPayload = z.infer<typeof orgsRosterSchema>;

export const coachIntrosSchema = z.object({
  coach: playerLiteSchema,
  players: z.array(playerLiteSchema).max(10).default([]),
  soundSlot: soundSlotSchema,
});
export type CoachIntrosPayload = z.infer<typeof coachIntrosSchema>;

export const playerPenaltiesSchema = z.object({
  rows: z
    .array(
      z.object({
        displayName: z.string().trim().min(1).max(80),
        photoUrl: z.string().url().max(500).optional(),
        count: z.coerce.number().int().min(0).max(999),
        sanctionType: z.enum([
          "point_deduction",
          "gd_deduction",
          "fine",
          "suspension",
          "warning",
        ]),
      }),
    )
    .max(20)
    .default([]),
  soundSlot: soundSlotSchema,
});
export type PlayerPenaltiesPayload = z.infer<typeof playerPenaltiesSchema>;
