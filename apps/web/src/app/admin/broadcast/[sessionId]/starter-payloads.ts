/**
 * Starter payloads for the broadcast trigger admin (`/admin/broadcast/[id]`).
 *
 * Every TEMPLATE_KEYS entry MUST have a starter here that satisfies its
 * Zod schema — otherwise the textarea seeds with `{}`, the form posts an
 * empty body, and `triggerOverlayAction` throws ZodError on required
 * fields (e.g. `winnerDisplayName` for stinger_winner). A unit test in
 * `starter-payloads.test.ts` schema-validates every entry to prevent
 * regression when new templates are added.
 *
 * Plan 42.1 — slot-capable templates (score_bug, lower_third, up_next_bug,
 * h2h_*, stinger_goal/miss, leaderboard_animated, top_scorers,
 * match_scores_day, orgs_roster, coach_intros, player_penalties) include
 * `slot: "primary"` as a sidecar default. The admin UI also exposes a slot
 * radio which overrides the payload field at submit time.
 */

export const STARTER_PAYLOADS: Record<string, Record<string, unknown>> = {
  // Plan 12 — legacy
  scorebar: {
    homeName: "Home",
    awayName: "Away",
    homeScore: 0,
    awayScore: 0,
  },
  lower_third: {
    playerId: "00000000-0000-4000-8000-000000000000",
    displayName: "Player Name",
    gamerTag: "GAMER_TAG",
    jerseyNumber: 10,
    slot: "primary",
  },
  standings_widget: {
    topN: 3,
    rows: [
      { rank: 1, displayName: "Anon-01", pts: 9, gd: 5 },
      { rank: 2, displayName: "Anon-02", pts: 7, gd: 2 },
      { rank: 3, displayName: "Anon-03", pts: 4, gd: 0 },
    ],
  },
  player_card: {
    playerId: "00000000-0000-4000-8000-000000000000",
    displayName: "Player Name",
    gamerTag: "GAMER_TAG",
    seasonStats: { gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
  },
  punishment_ticker: {
    items: [
      {
        playerName: "Player Name",
        sanction: "warning",
        magnitude: "-1 pt",
        issuedAt: "2026-04-20",
      },
    ],
  },
  intro: {
    matchDayLabel: "Match Day 01",
    seasonLabel: "Elite 25/26",
  },
  outro: {
    matchDayLabel: "Match Day 01",
  },
  // Plan 16 — stingers
  stinger_intro: {
    seasonLabel: "Elite · 2025-26",
    matchDayLabel: "Match Day 1",
    soundSlot: "stinger-intro",
  },
  stinger_normal: { soundSlot: "stinger-normal" },
  stinger_replay: { soundSlot: "stinger-replay" },
  stinger_goal: {
    scorerDisplayName: "SCORER",
    soundSlot: "stinger-goal",
    slot: "primary",
  },
  stinger_miss: {
    scorerDisplayName: "SHOOTER",
    soundSlot: "stinger-miss",
    slot: "primary",
  },
  stinger_winner: {
    winnerDisplayName: "CHAMPION",
    finalScore: { home: 3, away: 1 },
    soundSlot: "stinger-winner",
  },
  // Plan 16 — persistent layouts
  layout_4pip: {
    cells: [
      { displayName: "PLAYER 1" },
      { displayName: "PLAYER 2" },
      { displayName: "PLAYER 3" },
      { displayName: "PLAYER 4" },
    ],
  },
  layout_2pip: {
    cells: [{ displayName: "PLAYER 1" }, { displayName: "PLAYER 2" }],
  },
  layout_brb_full: { message: "BE RIGHT BACK" },
  layout_brb_basic: { message: "BE RIGHT BACK" },
  layout_timer: {
    expiresAt: "2026-04-22T00:00:00.000Z",
    label: "WARMUP",
  },
  layout_animated_bg: { intensity: "medium" },
  layout_casters_chat: {
    chat: [
      { user: "DAPO", msg: "GG WP" },
      { user: "ZED", msg: "what a goal" },
    ],
    ticker: "ELITE DIV 1 · MD1 · LIVE",
  },
  // Plan 16 — matchups (Plan 42.1 — slot-capable)
  h2h_2: {
    players: [
      { displayName: "PLAYER 1", h2hStats: { w: 0, d: 0, l: 0 } },
      { displayName: "PLAYER 2", h2hStats: { w: 0, d: 0, l: 0 } },
    ],
    soundSlot: "whoosh-long",
    slot: "primary",
  },
  h2h_3: {
    players: [
      { displayName: "PLAYER 1" },
      { displayName: "PLAYER 2" },
      { displayName: "PLAYER 3" },
    ],
    slot: "primary",
  },
  h2h_5: {
    players: [
      { displayName: "PLAYER 1" },
      { displayName: "PLAYER 2" },
      { displayName: "PLAYER 3" },
      { displayName: "PLAYER 4" },
      { displayName: "PLAYER 5" },
    ],
    slot: "primary",
  },
  // Plan 16 — data displays (Plan 42.1 — slot-capable)
  leaderboard_animated: {
    topN: 5,
    rows: [
      { rank: 1, displayName: "Anon-01", pts: 12, gd: 8 },
      { rank: 2, displayName: "Anon-02", pts: 10, gd: 5 },
      { rank: 3, displayName: "Anon-03", pts: 9, gd: 3 },
      { rank: 4, displayName: "Anon-04", pts: 7, gd: 1 },
      { rank: 5, displayName: "Anon-05", pts: 6, gd: -1 },
    ],
    slot: "primary",
  },
  score_bug: {
    players: [
      { displayName: "HOME", score: 0 },
      { displayName: "AWAY", score: 0 },
    ],
    slot: "primary",
  },
  up_next_bug: {
    home: { displayName: "HOME" },
    away: { displayName: "AWAY" },
    kickoffAt: "2026-04-22T00:00:00.000Z",
    slot: "primary",
  },
  match_scores_day: {
    matchDayLabel: "MD 1",
    rows: [],
    slot: "primary",
  },
  // Plan 16 — full-screen
  starting_soon_basic: { subtitle: "Match Day 1 begins shortly" },
  starting_soon_timer: { startsAt: "2026-04-22T00:00:00.000Z" },
  stream_ended: {
    subtitle: "Thanks for watching",
    socials: { twitter: "@cade_league", instagram: "@cade_league" },
  },
  // Plan 16 — stats (Plan 42.1 — slot-capable)
  top_scorers: {
    rows: [
      { rank: 1, displayName: "Anon-01", goals: 14 },
      { rank: 2, displayName: "Anon-02", goals: 11 },
      { rank: 3, displayName: "Anon-03", goals: 9 },
    ],
    slot: "primary",
  },
  orgs_roster: {
    org: { name: "CADE ESPORTS" },
    players: [
      { displayName: "PLAYER 1" },
      { displayName: "PLAYER 2" },
      { displayName: "PLAYER 3" },
    ],
    slot: "primary",
  },
  coach_intros: {
    coach: { displayName: "Coach K" },
    players: [{ displayName: "PLAYER 1" }, { displayName: "PLAYER 2" }],
    slot: "primary",
  },
  player_penalties: {
    rows: [
      { displayName: "Player Name", count: 1, sanctionType: "warning" },
    ],
    slot: "primary",
  },
  // Plan 44 — featured YouTube chat comment. The YouTubeChatPanel posts a
  // real payload from the picked message; this starter exists so the
  // legacy textarea form + starter-payloads.test.ts both cover the key.
  featured_comment: {
    authorName: "Viewer",
    message: "Great goal!",
    postedAt: "2026-04-22T00:00:00.000Z",
    displaySeconds: 10,
    slot: "primary",
  },
};
