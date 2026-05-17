/**
 * Overlay Builder — data slot presets.
 *
 * Each preset is a one-click drop into the canvas: pre-styled element
 * pre-bound to a known feed / fieldPath. The admin sidebar reads this
 * array and renders the "Data" tab.
 *
 * The list mirrors the existing CLAUDE.md §14 auto-update overlay
 * matrix — every (feed, fieldPath) combination that ships on a
 * production overlay is callable from the builder. New overlays the
 * builder authors automatically benefit from the same Realtime
 * subscription that already powers the built-in overlays.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §7
 */

import type { Binding, Style } from "./types";

export type DataSlotCategory =
  | "standings"
  | "live_score"
  | "top_scorers"
  | "h2h"
  | "match"
  | "match_day"
  | "custom_text";

export type DataSlotPreset = {
  id: string;
  label: string;
  category: DataSlotCategory;
  binding: Binding;
  defaultElementType: "text" | "image";
  defaultStyle: Partial<Style>;
};

const TEXT_TITLE: Partial<Style> = {
  fontFamily: "Agharti",
  fontSize: 64,
  color: "#ffffff",
};
const TEXT_BODY: Partial<Style> = {
  fontFamily: "Agharti",
  fontSize: 40,
  color: "#ffffff",
};
const TEXT_NUMERAL: Partial<Style> = {
  fontFamily: "Agharti",
  fontSize: 56,
  color: "#6bcd06",
};

function standingsRank(rank: number): DataSlotPreset[] {
  const i = rank - 1;
  return [
    {
      id: `rank-${rank}-name`,
      label: `Standings — Rank ${rank} Name`,
      category: "standings",
      binding: { feed: "standings", fieldPath: `[${i}].name` },
      defaultElementType: "text",
      defaultStyle: TEXT_TITLE,
    },
    {
      id: `rank-${rank}-points`,
      label: `Standings — Rank ${rank} Points`,
      category: "standings",
      binding: { feed: "standings", fieldPath: `[${i}].points` },
      defaultElementType: "text",
      defaultStyle: TEXT_NUMERAL,
    },
    {
      id: `rank-${rank}-gd`,
      label: `Standings — Rank ${rank} GD`,
      category: "standings",
      binding: { feed: "standings", fieldPath: `[${i}].gd` },
      defaultElementType: "text",
      defaultStyle: TEXT_NUMERAL,
    },
  ];
}

export const DATA_SLOTS_CATALOG: DataSlotPreset[] = [
  // ────────── Standings (rank 1-10 × {name, points, gd}) = 30 ──────────
  ...standingsRank(1),
  ...standingsRank(2),
  ...standingsRank(3),
  ...standingsRank(4),
  ...standingsRank(5),
  ...standingsRank(6),
  ...standingsRank(7),
  ...standingsRank(8),
  ...standingsRank(9),
  ...standingsRank(10),

  // ────────── Live score ──────────
  {
    id: "home-name",
    label: "Live Score — Home Name",
    category: "live_score",
    binding: { feed: "live_score", fieldPath: "home_name" },
    defaultElementType: "text",
    defaultStyle: TEXT_TITLE,
  },
  {
    id: "away-name",
    label: "Live Score — Away Name",
    category: "live_score",
    binding: { feed: "live_score", fieldPath: "away_name" },
    defaultElementType: "text",
    defaultStyle: TEXT_TITLE,
  },
  {
    id: "home-score",
    label: "Live Score — Home Score",
    category: "live_score",
    binding: { feed: "live_score", fieldPath: "home_score" },
    defaultElementType: "text",
    defaultStyle: TEXT_NUMERAL,
  },
  {
    id: "away-score",
    label: "Live Score — Away Score",
    category: "live_score",
    binding: { feed: "live_score", fieldPath: "away_score" },
    defaultElementType: "text",
    defaultStyle: TEXT_NUMERAL,
  },
  {
    id: "clock",
    label: "Live Score — Clock",
    category: "live_score",
    binding: { feed: "live_score", fieldPath: "clock" },
    defaultElementType: "text",
    defaultStyle: TEXT_BODY,
  },

  // ────────── Top scorers ──────────
  {
    id: "scorer-1-name",
    label: "Top Scorers — #1 Name",
    category: "top_scorers",
    binding: { feed: "top_scorers", fieldPath: "[0].name" },
    defaultElementType: "text",
    defaultStyle: TEXT_TITLE,
  },
  {
    id: "scorer-1-goals",
    label: "Top Scorers — #1 Goals",
    category: "top_scorers",
    binding: { feed: "top_scorers", fieldPath: "[0].goals" },
    defaultElementType: "text",
    defaultStyle: TEXT_NUMERAL,
  },
  {
    id: "scorer-1-photo",
    label: "Top Scorers — #1 Photo",
    category: "top_scorers",
    binding: { feed: "top_scorers", fieldPath: "[0].photoUrl" },
    defaultElementType: "image",
    defaultStyle: { imageFit: "cover" },
  },

  // ────────── H2H ──────────
  {
    id: "player-a-name",
    label: "H2H — Player A Name",
    category: "h2h",
    binding: { feed: "h2h", fieldPath: "playerA.name" },
    defaultElementType: "text",
    defaultStyle: TEXT_TITLE,
  },
  {
    id: "player-b-name",
    label: "H2H — Player B Name",
    category: "h2h",
    binding: { feed: "h2h", fieldPath: "playerB.name" },
    defaultElementType: "text",
    defaultStyle: TEXT_TITLE,
  },
  {
    id: "player-a-win-prob",
    label: "H2H — Player A Win Probability",
    category: "h2h",
    binding: { feed: "h2h", fieldPath: "playerA.winProbPct" },
    defaultElementType: "text",
    defaultStyle: TEXT_NUMERAL,
  },
  {
    id: "player-b-win-prob",
    label: "H2H — Player B Win Probability",
    category: "h2h",
    binding: { feed: "h2h", fieldPath: "playerB.winProbPct" },
    defaultElementType: "text",
    defaultStyle: TEXT_NUMERAL,
  },

  // ────────── Match ──────────
  {
    id: "current-match-home",
    label: "Match — Current Home",
    category: "match",
    binding: { feed: "match", fieldPath: "home_name" },
    defaultElementType: "text",
    defaultStyle: TEXT_TITLE,
  },
  {
    id: "current-match-away",
    label: "Match — Current Away",
    category: "match",
    binding: { feed: "match", fieldPath: "away_name" },
    defaultElementType: "text",
    defaultStyle: TEXT_TITLE,
  },

  // ────────── Match day ──────────
  {
    id: "next-fixture-home",
    label: "Match Day — Next Home",
    category: "match_day",
    binding: { feed: "match_day", fieldPath: "[0].home_name" },
    defaultElementType: "text",
    defaultStyle: TEXT_BODY,
  },
  {
    id: "next-fixture-away",
    label: "Match Day — Next Away",
    category: "match_day",
    binding: { feed: "match_day", fieldPath: "[0].away_name" },
    defaultElementType: "text",
    defaultStyle: TEXT_BODY,
  },
  {
    id: "next-fixture-kickoff",
    label: "Match Day — Next Kickoff",
    category: "match_day",
    binding: { feed: "match_day", fieldPath: "[0].kickoff" },
    defaultElementType: "text",
    defaultStyle: TEXT_BODY,
  },

  // ────────── Custom text ──────────
  {
    id: "caster-1-name",
    label: "Custom Text — Caster 1",
    category: "custom_text",
    binding: { feed: "custom_text", fieldPath: "caster_1_name" },
    defaultElementType: "text",
    defaultStyle: TEXT_BODY,
  },
  {
    id: "lower-third-line-1",
    label: "Custom Text — Lower Third Line 1",
    category: "custom_text",
    binding: { feed: "custom_text", fieldPath: "lower_third_line_1" },
    defaultElementType: "text",
    defaultStyle: TEXT_BODY,
  },
];
