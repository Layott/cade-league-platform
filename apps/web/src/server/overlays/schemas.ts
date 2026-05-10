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

/**
 * Plan 42.1 — optional per-payload match slot discriminator. Present on
 * payloads for match-aware overlays (score_bug, lower_third, up_next_bug,
 * h2h_*, stinger_goal/miss, leaderboard_animated, top_scorers,
 * match_scores_day, orgs_roster, coach_intros, player_penalties).
 * Overlay subscribers filter incoming realtime payloads by this field;
 * missing / null is treated as 'primary' for back-compat with Plan 42.
 */
export const matchSlotSchema = z
  .enum(["primary", "secondary"])
  .optional();
export type MatchSlot = z.infer<typeof matchSlotSchema>;

/** Shared optional stinger / whoosh slot key. */
export const soundSlotSchema = z
  .enum([
    "stinger-intro",
    "stinger-normal",
    "stinger-replay",
    "stinger-goal",
    "stinger-miss",
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
// Plan 32 — accept relative paths (`/players/<slug>/...`) as well as
// absolute URLs so static-asset photos can be embedded in payloads.
const photoUrlSchema = z.string().trim().min(1).max(500);
const playerLiteSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  gamerTag: z.string().trim().min(1).max(80).optional(),
  photoUrl: photoUrlSchema.optional(),
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
  // Plan 32 — optional headshot URL. Public path (e.g. `/players/<slug>/...`)
  // or absolute URL. Lower-third renderer falls back to initials.
  photoUrl: z.string().trim().min(1).max(500).optional(),
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
  slot: matchSlotSchema,
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
    .max(20),
  soundSlot: soundSlotSchema,
});
export type StandingsWidgetPayload = z.infer<typeof standingsWidgetSchema>;

export const playerCardSchema = z.object({
  playerId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(80),
  photoUrl: photoUrlSchema.optional(),
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
  scorerPhotoUrl: photoUrlSchema.optional(),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
});
export type StingerGoalPayload = z.infer<typeof stingerGoalSchema>;

// Plan 16 amended — miss stinger (sibling of goal stinger).
// Scorer fields mirror stingerGoalSchema so the admin trigger form auto-
// renders the same inputs; title / sub-title animation diverges per the
// 04b_stinger_miss.html reference (strike-through + reticle).
export const stingerMissSchema = z.object({
  scorerDisplayName: z.string().trim().min(1).max(80).optional(),
  scorerPhotoUrl: photoUrlSchema.optional(),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
});
export type StingerMissPayload = z.infer<typeof stingerMissSchema>;

export const stingerWinnerSchema = z.object({
  winnerDisplayName: z.string().trim().min(1).max(80),
  winnerPhotoUrl: photoUrlSchema.optional(),
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
  photoUrl: photoUrlSchema.optional(),
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
  slot: matchSlotSchema,
});
export type H2H2Payload = z.infer<typeof h2h2Schema>;

export const h2h3Schema = z.object({
  players: z.array(h2hPlayerSchema).length(3),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
});
export type H2H3Payload = z.infer<typeof h2h3Schema>;

export const h2h5Schema = z.object({
  players: z.array(h2hPlayerSchema).min(3).max(5),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
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
        // 2026-04-26 — full-row payload extension so the v2
        // 07-leaderboard overlay can render the 13-player table with
        // photo, org logo + W/D/L/GF/GA breakdown without a second
        // round-trip. All optional so legacy `{rank, displayName, pts,
        // gd}` payloads still validate.
        slug: z.string().trim().min(1).max(80).optional(),
        photoUrl: photoUrlSchema.optional(),
        orgLogoUrl: photoUrlSchema.optional(),
        p: z.coerce.number().int().min(0).max(99).optional(),
        w: z.coerce.number().int().min(0).max(99).optional(),
        d: z.coerce.number().int().min(0).max(99).optional(),
        l: z.coerce.number().int().min(0).max(99).optional(),
        gf: z.coerce.number().int().min(0).max(999).optional(),
        ga: z.coerce.number().int().min(0).max(999).optional(),
        sanctions: z.string().trim().max(40).optional(),
      }),
    )
    .max(20),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
});
export type LeaderboardAnimatedPayload = z.infer<typeof leaderboardAnimatedSchema>;

export const scoreBugSchema = z.object({
  players: z
    .array(
      z.object({
        displayName: z.string().trim().min(1).max(80),
        slug: z.string().trim().min(1).max(80).optional(),
        photoUrl: photoUrlSchema.optional(),
        score: z.coerce.number().int().min(0).max(99),
      }),
    )
    .length(2),
  matchId: z.string().uuid().optional(),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
});
export type ScoreBugPayload = z.infer<typeof scoreBugSchema>;

export const upNextBugSchema = z.object({
  home: playerLiteSchema,
  away: playerLiteSchema,
  kickoffAt: z.string().datetime(),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
});
export type UpNextBugPayload = z.infer<typeof upNextBugSchema>;

export const matchScoresDaySchema = z.object({
  matchDayLabel: z.string().trim().min(1).max(120),
  rows: z
    .array(
      z.object({
        home: z.string().trim().min(1).max(80),
        away: z.string().trim().min(1).max(80),
        // Optional canonical headshot folder slugs (2026-04-26). Server
        // populates these from `players.gamer_tag` (or display-name
        // fallback). The static HTML uses them to resolve
        // `/overlays/v2/_assets/players/processed/<slug>/headshot_*_nobg.png`.
        homeSlug: z.string().trim().min(1).max(40).optional(),
        awaySlug: z.string().trim().min(1).max(40).optional(),
        // Plan 53 (2026-05-04) — server-resolved photo URLs from
        // `resolvePlayerPose` + `buildPhotoUrl` so per-(player x overlay)
        // selection rows in `player_photo_selections` can override the
        // displayed pose for this overlay (`11-match-scores-day`). The
        // current static HTML doesn't render headshots in the score
        // grid, so these fields are reserved for future variant
        // designs that include player faces alongside the score pills.
        homePhotoUrl: photoUrlSchema.optional(),
        awayPhotoUrl: photoUrlSchema.optional(),
        homeScore: z.coerce.number().int().min(0).max(99).nullable(),
        awayScore: z.coerce.number().int().min(0).max(99).nullable(),
        status: z.enum(["scheduled", "in_progress", "completed"]),
        // 2026-05-10 — broadcast slot + lane assignment. Producers set
        // these via /admin/match-days/[id] so the overlay groups matches
        // by slot (primary livestreamed + optional secondary offstream).
        // Both null when the match isn't assigned to any slot yet.
        matchSlot: z.number().int().min(1).max(50).nullable().optional(),
        matchLane: z.enum(["primary", "secondary"]).nullable().optional(),
      }),
    )
    .max(40)
    .default([]),
  // 2026-05-10 — current focused slot for auto-advance overlays. Highlight
  // the slot that is "live now"; null when no slot is in-progress.
  currentSlot: z.number().int().min(1).max(50).nullable().optional(),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
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
        photoUrl: photoUrlSchema.optional(),
        goals: z.coerce.number().int().min(0).max(9999),
      }),
    )
    .max(10)
    .default([]),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
});
export type TopScorersPayload = z.infer<typeof topScorersSchema>;

export const orgsRosterSchema = z.object({
  org: z.object({
    name: z.string().trim().min(1).max(80),
    logoUrl: z.string().url().max(500).optional(),
  }),
  players: z.array(playerLiteSchema).max(20).default([]),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
});
export type OrgsRosterPayload = z.infer<typeof orgsRosterSchema>;

export const coachIntrosSchema = z.object({
  coach: playerLiteSchema,
  players: z.array(playerLiteSchema).max(10).default([]),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
});
export type CoachIntrosPayload = z.infer<typeof coachIntrosSchema>;

export const playerPenaltiesSchema = z.object({
  rows: z
    .array(
      z.object({
        displayName: z.string().trim().min(1).max(80),
        photoUrl: photoUrlSchema.optional(),
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
  slot: matchSlotSchema,
});
export type PlayerPenaltiesPayload = z.infer<typeof playerPenaltiesSchema>;

// -- Player Squads (broadcast 19-player-squads) -----------------------
//
// Trigger payload sent by the broadcast control panel. The overlay
// then re-fetches the full squad via the
// `/api/broadcast/v2/sessions/[id]/player-squads?playerId=` endpoint;
// the trigger payload only needs to identify which player's draft to
// pin. `weekStartDate` is optional — server defaults to the current
// Thursday-anchored week.
export const playerSquadsSchema = z.object({
  playerId: z.string().uuid().optional(),
  weekStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "weekStartDate must be YYYY-MM-DD")
    .optional(),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
});
export type PlayerSquadsPayload = z.infer<typeof playerSquadsSchema>;

// -- Plan 44 — Featured Comment ---------------------------------------

/**
 * Featured-comment overlay payload. Fired by the admin's YouTubeChatPanel
 * when they click "Feature on stream" on a chat row. The overlay page
 * (`/overlay/featured-comment`) renders the card, auto-clears after
 * `displaySeconds` (default 10 s).
 *
 * `postedAt` is an ISO string from the YouTube API's `snippet.publishedAt`.
 * `slot` lets two concurrent matches each feature their own comment (same
 * dual-slot model as score_bug / lower_third).
 *
 * Plan 48.2 — structured design fields (see `fcDesignSchema`). Each maps
 * to a CSS variable on the card root so the admin can restyle without
 * writing CSS. `cssOverrides` remains available as an advanced escape
 * hatch, applied AFTER the structured variables so it can still override
 * anything. Values are strictly validated: only hex, numbers, and
 * enumerated keywords land here — strings that smell like raw CSS are
 * rejected before reaching the overlay.
 */
const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
export const fcPositionSchema = z
  .enum(["top-left", "top-right", "bottom-left", "bottom-right", "center"]);
export const fcFontSizeSchema = z.enum(["small", "medium", "large"]);
export const fcDesignSchema = z.object({
  backgroundColor: hexColorSchema.optional(),
  backgroundOpacity: z.coerce.number().int().min(0).max(100).optional(),
  textColor: hexColorSchema.optional(),
  authorColor: hexColorSchema.optional(),
  accentColor: hexColorSchema.optional(),
  borderRadius: z.coerce.number().int().min(0).max(40).optional(),
  fontSize: fcFontSizeSchema.optional(),
  position: fcPositionSchema.optional(),
});
export type FcDesign = z.infer<typeof fcDesignSchema>;

export const featuredCommentSchema = z.object({
  authorName: z.string().trim().min(1).max(80),
  authorPhotoUrl: photoUrlSchema.optional(),
  message: z.string().trim().min(1).max(500),
  postedAt: z.string().datetime(),
  displaySeconds: z.coerce.number().int().min(3).max(30).default(10),
  soundSlot: soundSlotSchema,
  slot: matchSlotSchema,
  /** Plan 48.2 — structured design parameters (validated). */
  design: fcDesignSchema.optional(),
  /**
   * Plan 45 — optional raw CSS injected inside the card wrapper scoped via a
   * unique `data-fc-scope` attribute. Overlay page strips `</style>`,
   * `<script>`, and `javascript:` URLs before injection. Max 4000 chars
   * keeps the payload under the realtime-broadcast size budget.
   *
   * Kept post-Plan 48.2 as an advanced escape hatch — applied AFTER
   * `design` variables so it can still override anything the sidebar set.
   */
  cssOverrides: z.string().max(4000).optional(),
});
export type FeaturedCommentPayload = z.infer<typeof featuredCommentSchema>;
