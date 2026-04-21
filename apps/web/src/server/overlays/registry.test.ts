import { describe, it, expect } from "vitest";
import {
  TEMPLATE_KEYS,
  TEMPLATE_REGISTRY,
  isTemplateKey,
  REALTIME,
  getTemplateRoute,
  listTemplatesByGroup,
} from "./registry";

// Keep in sync with the DB CHECK on overlay_templates.template_type.
// Migrations:
//   - 20260503000003_overlay_templates_seed.sql  (Plan 12, 7 keys)
//   - 20260505000003_plan16_overlay_template_types.sql (Plan 16, +20)
const DB_TEMPLATE_TYPES = [
  // Plan 12
  "lower_third",
  "scorebar",
  "standings_widget",
  "player_card",
  "punishment_ticker",
  "intro",
  "outro",
  // Plan 16
  "stinger_intro",
  "stinger_normal",
  "stinger_replay",
  "stinger_goal",
  "stinger_winner",
  "layout_4pip",
  "layout_2pip",
  "layout_brb_full",
  "layout_brb_basic",
  "layout_timer",
  "layout_animated_bg",
  "layout_casters_chat",
  "h2h_2",
  "h2h_3",
  "h2h_5",
  "leaderboard_animated",
  "score_bug",
  "up_next_bug",
  "match_scores_day",
  "starting_soon_basic",
  "starting_soon_timer",
  "stream_ended",
  "top_scorers",
  "orgs_roster",
  "coach_intros",
  "player_penalties",
] as const;

describe("overlay registry", () => {
  it("TEMPLATE_KEYS exactly covers every CHECK constraint value", () => {
    expect([...TEMPLATE_KEYS].sort()).toEqual([...DB_TEMPLATE_TYPES].sort());
  });

  it("every TEMPLATE_KEYS entry has a schema + route + group + label", () => {
    for (const key of TEMPLATE_KEYS) {
      const entry = TEMPLATE_REGISTRY[key];
      expect(entry?.schema).toBeDefined();
      expect(entry?.route).toMatch(/^\/overlay\//);
      expect(entry?.group).toBeTypeOf("string");
      expect(entry?.label).toBeTypeOf("string");
    }
  });

  it("routes match /overlay/<key-hyphened> for multi-word keys", () => {
    expect(getTemplateRoute("scorebar")).toBe("/overlay/scorebar");
    expect(getTemplateRoute("lower_third")).toBe("/overlay/lower-third");
    expect(getTemplateRoute("standings_widget")).toBe(
      "/overlay/standings-widget",
    );
    expect(getTemplateRoute("player_card")).toBe("/overlay/player-card");
    expect(getTemplateRoute("punishment_ticker")).toBe(
      "/overlay/punishment-ticker",
    );
    expect(getTemplateRoute("stinger_intro")).toBe("/overlay/stinger-intro");
    expect(getTemplateRoute("layout_4pip")).toBe("/overlay/layout-4pip");
    expect(getTemplateRoute("h2h_5")).toBe("/overlay/h2h-5");
  });

  it("isTemplateKey narrows valid strings only", () => {
    expect(isTemplateKey("scorebar")).toBe(true);
    expect(isTemplateKey("stinger_intro")).toBe(true);
    expect(isTemplateKey("bogus")).toBe(false);
  });

  it("REALTIME channel name format is overlay:<sessionId>", () => {
    expect(REALTIME.channel("abc-123")).toBe("overlay:abc-123");
  });

  it("REALTIME event names are stable strings", () => {
    expect(REALTIME.eventTriggered).toBe("overlay.triggered");
    expect(REALTIME.eventCleared).toBe("overlay.cleared");
    expect(REALTIME.eventSessionEnded).toBe("session.ended");
  });

  it("listTemplatesByGroup returns 27 templates across 7 groups", () => {
    const groups = listTemplatesByGroup();
    expect(groups).toHaveLength(7);
    const total = groups.reduce((acc, g) => acc + g.templates.length, 0);
    expect(total).toBe(TEMPLATE_KEYS.length);
  });

  it("every stinger template defaults to its dedicated sound slot", () => {
    expect(TEMPLATE_REGISTRY.stinger_intro.defaultSoundSlot).toBe("stinger-intro");
    expect(TEMPLATE_REGISTRY.stinger_goal.defaultSoundSlot).toBe("stinger-goal");
    expect(TEMPLATE_REGISTRY.stinger_winner.defaultSoundSlot).toBe(
      "stinger-winner",
    );
  });
});
