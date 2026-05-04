/**
 * Plan 54 — typed template registry for broadcast social-media assets.
 *
 * Mirrors the seed in migration `20260801000004_seed_social_render_templates.sql`
 * (Wave 1A) so this module can be imported anywhere without paying a DB
 * round-trip just to enumerate the 5 Phase-1 templates. The seed is the source
 * of TRUTH at runtime (admins may toggle `active` etc. in the future), but the
 * shape + identity of these 5 keys is locked in code so OG routes + admin tiles
 * can compile against a discriminated TemplateKey union.
 *
 * Adding a new template (Phase 2+):
 *   1. Add a row to `SOCIAL_TEMPLATES` here.
 *   2. Extend the `TemplateKey` union type.
 *   3. Add a fetcher in `data.ts`.
 *   4. Add the seed row to a NEW migration that updates
 *      `social_render_templates`.
 *   5. Add an OG route at `apps/web/src/app/api/social/og/<key>/[size]`.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §4 + §6.
 */

import type { SocialSize } from "@/lib/social-sizes";

export type TemplateFormat = "image" | "video" | "both";

/**
 * The set of Phase-1 template keys. Locked enum — adding a new key here is a
 * type-level breaking change that forces every consumer (data fetchers, OG
 * routes, admin tiles) to update in lockstep.
 */
export type TemplateKey =
  | "leaderboard"
  | "top-scorers"
  | "upcoming-fixtures"
  | "gd-leaders"
  | "league-avg";

export interface SocialTemplate {
  /** Stable identifier — also the URL slug under `/admin/broadcast/social/`. */
  templateKey: TemplateKey;
  /** Human-readable label rendered in the admin tile grid. */
  label: string;
  /**
   * One-sentence description of what the template renders. Surfaces as the
   * tile subtitle + as a tooltip on the render button.
   */
  description: string;
  /**
   * `image` = `next/og` static PNG only. `video` = MP4 worker only.
   * `both` = either path is valid; admin chooses at render time.
   */
  format: TemplateFormat;
  /**
   * Path to the live-data feed used by the OG route to populate the design.
   * `{sessionId}` is a literal placeholder substituted at render time. For
   * derived templates (no upstream endpoint, computed in-process) this stays
   * pointed at a logical URL for documentation only — no fetch is issued.
   */
  dataEndpoint: string;
  /**
   * Sizes the template will render correctly at. The admin SizePicker filters
   * its options against this list; an unsupported size is greyed out.
   */
  supportedSizes: ReadonlyArray<SocialSize>;
  /**
   * Phase-3 video worker scene path — points at the v2 overlay HTML to
   * screencast for animated MP4 output. Null for static-only templates.
   */
  scenePath: string | null;
  /** Tile sort order (low first). Stable across phases. */
  sortOrder: number;
}

/**
 * Seed catalog. Mirrors the Wave 1A migration row-for-row.
 *
 * The list is `readonly` so callers can't accidentally mutate the registry —
 * any changes flow through a new migration + a code update in lockstep.
 */
export const SOCIAL_TEMPLATES: ReadonlyArray<SocialTemplate> = [
  {
    templateKey: "leaderboard",
    label: "Weekly Leaderboard",
    description:
      "Top 13 standings ranked by points, GD, GF — the league's flagship recap.",
    format: "both",
    dataEndpoint: "/api/broadcast/sessions/{sessionId}/leaderboard",
    supportedSizes: ["1080x1920", "1080x1080", "1200x675"] as const,
    scenePath:
      "KNOWLEDGE/brand-assets/elements/v2/07-leaderboard/index.html",
    sortOrder: 10,
  },
  {
    templateKey: "top-scorers",
    label: "Golden Boot Race",
    description:
      "Top 10 scorers ranked by goals — Golden Pad showcase for season finishers.",
    format: "both",
    dataEndpoint: "/api/broadcast/sessions/{sessionId}/top-scorers",
    supportedSizes: ["1080x1920", "1080x1080"] as const,
    scenePath:
      "KNOWLEDGE/brand-assets/elements/v2/14-top-scorers/index.html",
    sortOrder: 20,
  },
  {
    templateKey: "upcoming-fixtures",
    label: "Upcoming Fixtures",
    description:
      "Next match-day's slate, ordered by scheduled time — pre-event hype card.",
    format: "image",
    dataEndpoint: "/api/broadcast/sessions/{sessionId}/match-scores-day",
    supportedSizes: ["1080x1080", "1080x1920"] as const,
    scenePath: null,
    sortOrder: 30,
  },
  {
    templateKey: "gd-leaders",
    label: "Goal Difference Leaders",
    description:
      "Top 5 by goal difference — derived from leaderboard, the silent ladder mover.",
    format: "image",
    dataEndpoint: "/api/broadcast/sessions/{sessionId}/leaderboard",
    supportedSizes: ["1080x1080"] as const,
    scenePath: null,
    sortOrder: 40,
  },
  {
    templateKey: "league-avg",
    label: "League Average Stats",
    description:
      "Aggregate per-player averages — wins, GF, points across the season.",
    format: "image",
    dataEndpoint: "/api/broadcast/sessions/{sessionId}/leaderboard",
    supportedSizes: ["1080x1080"] as const,
    scenePath: null,
    sortOrder: 50,
  },
] as const;

/** O(1) lookup map keyed by templateKey. */
const TEMPLATES_BY_KEY: ReadonlyMap<TemplateKey, SocialTemplate> = new Map(
  SOCIAL_TEMPLATES.map((t) => [t.templateKey, t]),
);

/**
 * Fetch a template by its key. Throws when the key is not in the catalog —
 * callers SHOULD type-narrow against `TemplateKey` first; this guard exists for
 * the route-param boundary where a string lands from the URL.
 */
export function getTemplate(key: TemplateKey): SocialTemplate {
  const t = TEMPLATES_BY_KEY.get(key);
  if (!t) {
    throw new Error(`Unknown social template key: ${String(key)}`);
  }
  return t;
}

/**
 * Return the catalog ordered by `sortOrder` ascending. The source array is
 * already in sorted order; this helper exists so consumers don't depend on the
 * internal source order. Returns a fresh array so callers can sort/filter
 * without mutating the registry.
 */
export function listActiveTemplates(): ReadonlyArray<SocialTemplate> {
  return [...SOCIAL_TEMPLATES].sort((a, b) => a.sortOrder - b.sortOrder);
}
