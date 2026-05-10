/**
 * Plan 51 — broadcast v2 ↔ legacy template_key mapping.
 *
 * The v2 control room uses 16 overlay keys (e.g. `01-brb`, `02-timer`,
 * `08-lower-third`) that mirror the v2 mockup folders. The persistent
 * tables `overlay_events` + `overlay_active_instances` carry a
 * `template_key` column whose values come from the legacy registry
 * (`@/server/overlays/registry`). Each v2 key maps to exactly one legacy
 * template key so the realtime publish path + Zod validation reuse the
 * existing infrastructure.
 *
 * Legacy keys without a v2 counterpart (`scorebar`, `intro`, `outro`,
 * stingers, etc) keep working through the legacy /admin/broadcast page —
 * the v2 control room is a parallel surface, not a replacement.
 */
import type { TemplateKey } from "@/server/overlays/registry";
import type { V2OverlayKey } from "./overlay-keys";

export const V2_TO_LEGACY_TEMPLATE: Record<V2OverlayKey, TemplateKey> = {
  "01-brb": "layout_brb_basic",
  "02-timer": "layout_timer",
  "04-h2h-2": "h2h_2",
  "05-h2h-3": "h2h_3",
  "06-h2h-5": "h2h_5",
  "07-leaderboard": "leaderboard_animated",
  "08-lower-third": "lower_third",
  "09-secondary-score-bug": "score_bug",
  "10-up-next-bug": "up_next_bug",
  "11-match-scores-day": "match_scores_day",
  "12-starting-soon": "starting_soon_basic",
  "13-stream-ended": "stream_ended",
  "14-top-scorers": "top_scorers",
  "15-orgs": "orgs_roster",
  "16-coaches": "coach_intros",
  "17-penalties": "player_penalties",
  "19-player-squads": "player_squads",
  // 20-highlight: reuse `match_scores_day` template_key — both render
  // recent fixture results, just in different visual layouts. Cleanest
  // option until we add a dedicated `highlight` enum value.
  "20-highlight": "match_scores_day",
  // 21..29 cover-up overlays: reuse closest legacy template_key. Same
  // precedent as 20-highlight — visual layouts differ but the publish
  // contract + Zod validation share with the closest semantic match.
  // `lower_third` was tried for 25/28 but its Zod schema requires a real
  // `playerId` UUID + display fields; cover-up overlays carry no payload
  // data so we route them through `top_scorers` instead (its schema
  // accepts `{}` — `rows` defaults to []).
  "21-streaks": "leaderboard_animated",
  "22-power-rankings": "leaderboard_animated",
  "23-org-standings": "orgs_roster",
  "24-biggest-margins": "match_scores_day",
  "25-did-you-know": "top_scorers",
  "26-card-meta": "top_scorers",
  "27-schedule": "match_scores_day",
  "28-punditry": "top_scorers",
  "29-goalfests": "match_scores_day",
};

export function v2ToLegacy(key: V2OverlayKey): TemplateKey {
  return V2_TO_LEGACY_TEMPLATE[key];
}

/**
 * Per-overlay minimum-viable payload for the static "cover-up" overlays
 * (21..29). The mapped legacy Zod schemas (`leaderboard_animated`,
 * `orgs_roster`, `match_scores_day`, `top_scorers`) all carry required
 * fields the cover-up HTML never reads — the overlays are static info
 * graphics whose content lives in the HTML itself, not the payload.
 * Without these placeholders, `triggerOverlay()`'s `schema.parse({})`
 * throws ZodError and the server action 500s, rendering the Next.js
 * error page — the "page crash" users see when triggering 21..29.
 *
 * Each value must:
 *  - be valid JSON
 *  - satisfy the corresponding legacy schema's required fields
 *  - carry zero meaningful runtime data (these overlays don't consume it)
 */
export const COVER_UP_PAYLOADS: Record<string, string> = {
  "21-streaks": JSON.stringify({ topN: 1, rows: [] }),
  "22-power-rankings": JSON.stringify({ topN: 1, rows: [] }),
  "23-org-standings": JSON.stringify({ org: { name: "COVER UP" } }),
  "24-biggest-margins": JSON.stringify({ matchDayLabel: "COVER UP" }),
  "25-did-you-know": JSON.stringify({}),
  "26-card-meta": JSON.stringify({}),
  "27-schedule": JSON.stringify({ matchDayLabel: "COVER UP" }),
  "28-punditry": JSON.stringify({}),
  "29-goalfests": JSON.stringify({ matchDayLabel: "COVER UP" }),
};

export function getCoverUpPayload(key: V2OverlayKey): string {
  return COVER_UP_PAYLOADS[key] ?? "{}";
}
