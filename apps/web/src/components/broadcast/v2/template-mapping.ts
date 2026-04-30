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
};

export function v2ToLegacy(key: V2OverlayKey): TemplateKey {
  return V2_TO_LEGACY_TEMPLATE[key];
}
