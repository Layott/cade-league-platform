import type { ZodType } from "zod";
import {
  // Plan 12
  scorebarSchema,
  lowerThirdSchema,
  standingsWidgetSchema,
  playerCardSchema,
  punishmentTickerSchema,
  introSchema,
  outroSchema,
  // Plan 16 — stingers
  stingerIntroSchema,
  stingerNormalSchema,
  stingerReplaySchema,
  stingerGoalSchema,
  stingerWinnerSchema,
  // Plan 16 — layouts
  layout4PipSchema,
  layout2PipSchema,
  layoutBrbFullSchema,
  layoutBrbBasicSchema,
  layoutTimerSchema,
  layoutAnimatedBgSchema,
  layoutCastersChatSchema,
  // Plan 16 — matchups
  h2h2Schema,
  h2h3Schema,
  h2h5Schema,
  // Plan 16 — data displays
  leaderboardAnimatedSchema,
  scoreBugSchema,
  upNextBugSchema,
  matchScoresDaySchema,
  // Plan 16 — full-screen
  startingSoonBasicSchema,
  startingSoonTimerSchema,
  streamEndedSchema,
  // Plan 16 — stats
  topScorersSchema,
  orgsRosterSchema,
  coachIntrosSchema,
  playerPenaltiesSchema,
} from "./schemas";

/**
 * Plan 12 + Plan 16 — overlay template registry.
 *
 * Single source of truth binding template_key → { schema, route,
 * defaultSoundSlot, group }. `TEMPLATE_KEYS` mirrors the DB CHECK
 * constraint on overlay_templates.template_type; a unit test asserts
 * parity so drift is caught at CI time.
 */

export const TEMPLATE_KEYS = [
  // Plan 12 (7)
  "scorebar",
  "lower_third",
  "standings_widget",
  "player_card",
  "punishment_ticker",
  "intro",
  "outro",
  // Plan 16 stingers (5)
  "stinger_intro",
  "stinger_normal",
  "stinger_replay",
  "stinger_goal",
  "stinger_winner",
  // Plan 16 layouts (7)
  "layout_4pip",
  "layout_2pip",
  "layout_brb_full",
  "layout_brb_basic",
  "layout_timer",
  "layout_animated_bg",
  "layout_casters_chat",
  // Plan 16 matchups (3)
  "h2h_2",
  "h2h_3",
  "h2h_5",
  // Plan 16 data (4)
  "leaderboard_animated",
  "score_bug",
  "up_next_bug",
  "match_scores_day",
  // Plan 16 full-screen (3)
  "starting_soon_basic",
  "starting_soon_timer",
  "stream_ended",
  // Plan 16 stats (4)
  "top_scorers",
  "orgs_roster",
  "coach_intros",
  "player_penalties",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export type TemplateGroup =
  | "legacy"
  | "stingers"
  | "layouts"
  | "matchups"
  | "data"
  | "fullscreen"
  | "stats";

type TemplateEntry = {
  schema: ZodType;
  route: string;
  group: TemplateGroup;
  label: string;
  defaultSoundSlot: string | null;
};

// Using `ZodType<unknown>` on the map keeps consumers narrow via
// `.parse()` without losing compile-time template_key safety.
export const TEMPLATE_REGISTRY: Record<TemplateKey, TemplateEntry> = {
  // Plan 12
  scorebar: {
    schema: scorebarSchema,
    route: "/overlay/scorebar",
    group: "legacy",
    label: "Scorebar",
    defaultSoundSlot: null,
  },
  lower_third: {
    schema: lowerThirdSchema,
    route: "/overlay/lower-third",
    group: "legacy",
    label: "Lower Third",
    defaultSoundSlot: "whoosh-short",
  },
  standings_widget: {
    schema: standingsWidgetSchema,
    route: "/overlay/standings-widget",
    group: "legacy",
    label: "Standings Widget",
    defaultSoundSlot: null,
  },
  player_card: {
    schema: playerCardSchema,
    route: "/overlay/player-card",
    group: "legacy",
    label: "Player Card",
    defaultSoundSlot: null,
  },
  punishment_ticker: {
    schema: punishmentTickerSchema,
    route: "/overlay/punishment-ticker",
    group: "legacy",
    label: "Punishment Ticker",
    defaultSoundSlot: null,
  },
  intro: {
    schema: introSchema,
    route: "/overlay/intro",
    group: "legacy",
    label: "Intro",
    defaultSoundSlot: null,
  },
  outro: {
    schema: outroSchema,
    route: "/overlay/outro",
    group: "legacy",
    label: "Outro",
    defaultSoundSlot: null,
  },
  // Plan 16 — stingers
  stinger_intro: {
    schema: stingerIntroSchema,
    route: "/overlay/stinger-intro",
    group: "stingers",
    label: "Intro Stinger (10s)",
    defaultSoundSlot: "stinger-intro",
  },
  stinger_normal: {
    schema: stingerNormalSchema,
    route: "/overlay/stinger-normal",
    group: "stingers",
    label: "Normal Stinger (2s)",
    defaultSoundSlot: "stinger-normal",
  },
  stinger_replay: {
    schema: stingerReplaySchema,
    route: "/overlay/stinger-replay",
    group: "stingers",
    label: "Replay Stinger (2s)",
    defaultSoundSlot: "stinger-replay",
  },
  stinger_goal: {
    schema: stingerGoalSchema,
    route: "/overlay/stinger-goal",
    group: "stingers",
    label: "Goal Stinger (2s)",
    defaultSoundSlot: "stinger-goal",
  },
  stinger_winner: {
    schema: stingerWinnerSchema,
    route: "/overlay/stinger-winner",
    group: "stingers",
    label: "Winner Stinger (2s)",
    defaultSoundSlot: "stinger-winner",
  },
  // Plan 16 — persistent layouts
  layout_4pip: {
    schema: layout4PipSchema,
    route: "/overlay/layout-4pip",
    group: "layouts",
    label: "4-PIP Layout",
    defaultSoundSlot: null,
  },
  layout_2pip: {
    schema: layout2PipSchema,
    route: "/overlay/layout-2pip",
    group: "layouts",
    label: "2-PIP Layout",
    defaultSoundSlot: null,
  },
  layout_brb_full: {
    schema: layoutBrbFullSchema,
    route: "/overlay/layout-brb-full",
    group: "layouts",
    label: "BRB (Ad + Timer)",
    defaultSoundSlot: null,
  },
  layout_brb_basic: {
    schema: layoutBrbBasicSchema,
    route: "/overlay/layout-brb-basic",
    group: "layouts",
    label: "BRB (Basic)",
    defaultSoundSlot: null,
  },
  layout_timer: {
    schema: layoutTimerSchema,
    route: "/overlay/layout-timer",
    group: "layouts",
    label: "Timer",
    defaultSoundSlot: "tick-1s",
  },
  layout_animated_bg: {
    schema: layoutAnimatedBgSchema,
    route: "/overlay/layout-animated-bg",
    group: "layouts",
    label: "Animated BG",
    defaultSoundSlot: null,
  },
  layout_casters_chat: {
    schema: layoutCastersChatSchema,
    route: "/overlay/layout-casters-chat",
    group: "layouts",
    label: "Casters + Chat",
    defaultSoundSlot: null,
  },
  // Plan 16 — matchup cards
  h2h_2: {
    schema: h2h2Schema,
    route: "/overlay/h2h-2",
    group: "matchups",
    label: "H2H (2-player)",
    defaultSoundSlot: "whoosh-long",
  },
  h2h_3: {
    schema: h2h3Schema,
    route: "/overlay/h2h-3",
    group: "matchups",
    label: "H2H (3-player)",
    defaultSoundSlot: "whoosh-long",
  },
  h2h_5: {
    schema: h2h5Schema,
    route: "/overlay/h2h-5",
    group: "matchups",
    label: "H2H (5-player)",
    defaultSoundSlot: "whoosh-long",
  },
  // Plan 16 — data displays
  leaderboard_animated: {
    schema: leaderboardAnimatedSchema,
    route: "/overlay/leaderboard-animated",
    group: "data",
    label: "Leaderboard",
    defaultSoundSlot: null,
  },
  score_bug: {
    schema: scoreBugSchema,
    route: "/overlay/score-bug",
    group: "data",
    label: "Score Bug",
    defaultSoundSlot: null,
  },
  up_next_bug: {
    schema: upNextBugSchema,
    route: "/overlay/up-next-bug",
    group: "data",
    label: "Up Next Bug",
    defaultSoundSlot: null,
  },
  match_scores_day: {
    schema: matchScoresDaySchema,
    route: "/overlay/match-scores-day",
    group: "data",
    label: "Match Scores Today",
    defaultSoundSlot: null,
  },
  // Plan 16 — full-screen
  starting_soon_basic: {
    schema: startingSoonBasicSchema,
    route: "/overlay/starting-soon-basic",
    group: "fullscreen",
    label: "Starting Soon (Basic)",
    defaultSoundSlot: null,
  },
  starting_soon_timer: {
    schema: startingSoonTimerSchema,
    route: "/overlay/starting-soon-timer",
    group: "fullscreen",
    label: "Starting Soon (Timer)",
    defaultSoundSlot: "tick-1s",
  },
  stream_ended: {
    schema: streamEndedSchema,
    route: "/overlay/stream-ended",
    group: "fullscreen",
    label: "Stream Ended",
    defaultSoundSlot: null,
  },
  // Plan 16 — stats
  top_scorers: {
    schema: topScorersSchema,
    route: "/overlay/top-scorers",
    group: "stats",
    label: "Top 10 Scorers",
    defaultSoundSlot: null,
  },
  orgs_roster: {
    schema: orgsRosterSchema,
    route: "/overlay/orgs-roster",
    group: "stats",
    label: "Orgs Roster",
    defaultSoundSlot: "whoosh-long",
  },
  coach_intros: {
    schema: coachIntrosSchema,
    route: "/overlay/coach-intros",
    group: "stats",
    label: "Coach Intros",
    defaultSoundSlot: "whoosh-short",
  },
  player_penalties: {
    schema: playerPenaltiesSchema,
    route: "/overlay/player-penalties",
    group: "stats",
    label: "Player Penalties",
    defaultSoundSlot: null,
  },
};

export function isTemplateKey(x: string): x is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(x);
}

export function getTemplateRoute(key: TemplateKey): string {
  return TEMPLATE_REGISTRY[key].route;
}

export function listTemplatesByGroup(): Array<{
  group: TemplateGroup;
  templates: Array<{ key: TemplateKey; entry: TemplateEntry }>;
}> {
  const groups: Record<TemplateGroup, Array<{ key: TemplateKey; entry: TemplateEntry }>> = {
    legacy: [],
    stingers: [],
    layouts: [],
    matchups: [],
    data: [],
    fullscreen: [],
    stats: [],
  };
  for (const key of TEMPLATE_KEYS) {
    const entry = TEMPLATE_REGISTRY[key];
    groups[entry.group].push({ key, entry });
  }
  const ordered: TemplateGroup[] = [
    "stingers",
    "layouts",
    "matchups",
    "data",
    "fullscreen",
    "stats",
    "legacy",
  ];
  return ordered.map((group) => ({ group, templates: groups[group] }));
}

/**
 * Realtime channel + event names. Centralised so admin trigger code +
 * overlay subscribers + unit tests all agree.
 */
export const REALTIME = {
  channel: (sessionId: string): string => `overlay:${sessionId}`,
  eventTriggered: "overlay.triggered" as const,
  eventCleared: "overlay.cleared" as const,
  eventSessionEnded: "session.ended" as const,
  // Plan 37 — multi-instance + match clock additions
  eventInstanceTriggered: "instance.triggered" as const,
  eventInstanceCleared: "instance.cleared" as const,
  eventClockChanged: "clock.changed" as const,
};
