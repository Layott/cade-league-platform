import type { ZodType } from "zod";
import {
  scorebarSchema,
  lowerThirdSchema,
  standingsWidgetSchema,
  playerCardSchema,
  punishmentTickerSchema,
  introSchema,
  outroSchema,
} from "./schemas";

/**
 * Plan 12 — overlay template registry.
 *
 * Single source of truth binding template_key → { schema, route }.
 * `TEMPLATE_KEYS` mirrors the DB CHECK constraint on
 * overlay_templates.template_type; a unit test asserts this parity so
 * drift between code and schema is caught at CI time.
 */

export const TEMPLATE_KEYS = [
  "scorebar",
  "lower_third",
  "standings_widget",
  "player_card",
  "punishment_ticker",
  "intro",
  "outro",
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

// Using `ZodType<unknown>` keeps the map covariant and lets TemplateKey
// consumers narrow via `.parse()` without losing compile-time safety.
export const TEMPLATE_REGISTRY: Record<
  TemplateKey,
  { schema: ZodType; route: string }
> = {
  scorebar: { schema: scorebarSchema, route: "/overlay/scorebar" },
  lower_third: { schema: lowerThirdSchema, route: "/overlay/lower-third" },
  standings_widget: {
    schema: standingsWidgetSchema,
    route: "/overlay/standings-widget",
  },
  player_card: { schema: playerCardSchema, route: "/overlay/player-card" },
  punishment_ticker: {
    schema: punishmentTickerSchema,
    route: "/overlay/punishment-ticker",
  },
  intro: { schema: introSchema, route: "/overlay/intro" },
  outro: { schema: outroSchema, route: "/overlay/outro" },
};

export function isTemplateKey(x: string): x is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(x);
}

export function getTemplateRoute(key: TemplateKey): string {
  return TEMPLATE_REGISTRY[key].route;
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
};
