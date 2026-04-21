import { describe, it, expect } from "vitest";
import {
  TEMPLATE_KEYS,
  TEMPLATE_REGISTRY,
  isTemplateKey,
  REALTIME,
  getTemplateRoute,
} from "./registry";

// Keep in sync with the DB CHECK on overlay_templates.template_type.
// If the migration adds a new value, add it here first + write its
// schema, then run migrations.
const DB_TEMPLATE_TYPES = [
  "lower_third",
  "scorebar",
  "standings_widget",
  "player_card",
  "punishment_ticker",
  "intro",
  "outro",
] as const;

describe("overlay registry", () => {
  it("TEMPLATE_KEYS exactly covers every CHECK constraint value", () => {
    expect([...TEMPLATE_KEYS].sort()).toEqual([...DB_TEMPLATE_TYPES].sort());
  });

  it("every TEMPLATE_KEYS entry has a schema + route", () => {
    for (const key of TEMPLATE_KEYS) {
      expect(TEMPLATE_REGISTRY[key]?.schema).toBeDefined();
      expect(TEMPLATE_REGISTRY[key]?.route).toMatch(/^\/overlay\//);
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
  });

  it("isTemplateKey narrows valid strings only", () => {
    expect(isTemplateKey("scorebar")).toBe(true);
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
});
