/**
 * Overlay Design System — hard-coded fallback map.
 *
 * Source of truth for "what does this overlay look like with no DB
 * tokens set". The SSR overlay route + `resolveTokens` merge any
 * `overlay_design_tokens` rows OVER this baseline, so first-deploy is
 * always no-op (the visual matches the existing inline CSS in each
 * v2 HTML).
 *
 * Keeping defaults in code (not DB) means:
 *   - `npm run build` ships a working overlay even before any
 *     migration runs.
 *   - Engineering changes to the overlay HTML stay co-located with
 *     code review, not migration churn.
 *   - DB row count stays tight — only DIVERGENT values get persisted.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §3.2 + §4.4
 *
 * Token catalog (extensible — adding a new token = update this file +
 * the admin UI knob; no migration needed):
 *
 *   bg-color              color    all overlays            #050505
 *   accent-color          color    all overlays            #6bcd06
 *   text-color            color    all overlays            #ffffff
 *   font-display          font     all overlays            Agharti
 *   font-body             font     all overlays            Quedora
 *   scale                 number   all overlays            1.0
 *   pos-x                 number   score-bug, lower-third  40 (px)
 *   pos-y                 number   same                    40 (px)
 *   row-highlight-count   number   leaderboard, scorers    2
 *   pattern               enum     leaderboard, brb        none
 *   partner-strip-show    boolean  brb / starting / etc    true
 */

import type { TokenType } from "./tokens";

/**
 * Allowed values for the `font` token type. Mirrors the brand-locked
 * set defined in CLAUDE.md §Brand. Add a new family here ONLY when
 * licensing + `next/font/local` wiring lands.
 */
export const FONT_VALUES = [
  "Agharti",
  "Quedora",
  "Inter",
  "JetBrains Mono",
] as const;
export type FontValue = (typeof FONT_VALUES)[number];

/**
 * Allowed values for the `pattern` token type.
 */
export const PATTERN_VALUES = ["none", "halftone", "grid"] as const;
export type PatternValue = (typeof PATTERN_VALUES)[number];

/**
 * Brand palette — locked. Sourced from CLAUDE.md §Brand.
 */
export const BRAND_BG = "#050505";
export const BRAND_ACCENT = "#6bcd06";
export const BRAND_TEXT = "#ffffff";

/**
 * Catalog entry: token_key → expected token_type. Used by the resolver
 * + admin UI to render the right widget per token (color picker, font
 * dropdown, slider, toggle, enum select).
 */
export type TokenCatalogEntry = {
  tokenKey: string;
  tokenType: TokenType;
  /** Human label for the admin UI. */
  label: string;
  /** Hint copy shown under the widget. */
  description?: string;
};

export const TOKEN_CATALOG: readonly TokenCatalogEntry[] = [
  { tokenKey: "bg-color", tokenType: "color", label: "Background" },
  { tokenKey: "accent-color", tokenType: "color", label: "Accent" },
  { tokenKey: "text-color", tokenType: "color", label: "Text" },
  { tokenKey: "font-display", tokenType: "font", label: "Display font" },
  { tokenKey: "font-body", tokenType: "font", label: "Body font" },
  { tokenKey: "scale", tokenType: "number", label: "Scale", description: "1.0 = native size" },
  { tokenKey: "pos-x", tokenType: "number", label: "Position X (px from edge)" },
  { tokenKey: "pos-y", tokenType: "number", label: "Position Y (px from edge)" },
  {
    tokenKey: "row-highlight-count",
    tokenType: "number",
    label: "Highlight rows",
    description: "How many top rows get the accent fill",
  },
  { tokenKey: "pattern", tokenType: "enum", label: "Background pattern" },
  { tokenKey: "partner-strip-show", tokenType: "boolean", label: "Partner strip" },
  {
    tokenKey: "partner-strip-scroll",
    tokenType: "boolean",
    label: "Partner strip scroll",
    description:
      "Continuous sideways marquee. Loops seamlessly via cloned children + 35s linear animation.",
  },
  {
    tokenKey: "bg-image",
    tokenType: "image",
    label: "Background image",
    description:
      "Custom backdrop image (recommended 1920×1080 PNG/JPG/WebP, ≤2MB). Only available on full-canvas overlays.",
  },
  {
    tokenKey: "bg-persistent",
    tokenType: "boolean",
    label: "Persistent background",
    description:
      "When ON, overlay background stays visible when trigger off. Content still animates in/out.",
  },
] as const;

/**
 * Map of catalog entries by tokenKey for O(1) type lookup.
 */
export const TOKEN_CATALOG_BY_KEY: Record<string, TokenCatalogEntry> =
  Object.fromEntries(TOKEN_CATALOG.map((e) => [e.tokenKey, e]));

/**
 * Required token keys every overlay must have a default for. Asserted
 * in `defaults.test.ts` so adding an overlay key without seeding the
 * baseline fails CI.
 */
export const REQUIRED_DEFAULT_KEYS = [
  "bg-color",
  "accent-color",
  "text-color",
  "font-display",
] as const;

/**
 * Canonical list of overlay keys served by `/overlay/v2/[key]`.
 * Mirrors `ALLOWED_KEYS` in the route file + the seed in migration
 * `20260601000001_overlay_template_variants.sql`.
 */
export const OVERLAY_KEYS = [
  "01-brb",
  "02-timer",
  "04-h2h-2",
  "05-h2h-3",
  "06-h2h-5",
  "07-leaderboard",
  "08-lower-third",
  "09-secondary-score-bug",
  "10-up-next-bug",
  "11-match-scores-day",
  "12-starting-soon",
  "13-stream-ended",
  "14-top-scorers",
  "15-orgs",
  "16-coaches",
  "17-penalties",
  "19-player-squads",
  "20-highlight",
  "21-streaks",
  "22-power-rankings",
  "23-org-standings",
  "24-biggest-margins",
  "25-did-you-know",
  "26-card-meta",
  "27-schedule",
  "28-punditry",
  "29-goalfests",
] as const;
export type OverlayKey = (typeof OVERLAY_KEYS)[number];

/**
 * Per-overlay baseline defaults. Each map's keys are token_keys, values
 * are the default token_value as a string (typed checks happen at the
 * resolver / setDesignToken level). Missing keys fall through to the
 * BASE_DEFAULTS below.
 */
const BASE_DEFAULTS: Record<string, string> = {
  "bg-color": BRAND_BG,
  "accent-color": BRAND_ACCENT,
  "text-color": BRAND_TEXT,
  "font-display": "Agharti",
  "font-body": "Quedora",
  scale: "1.0",
  "pos-x": "40",
  "pos-y": "40",
  "row-highlight-count": "2",
  pattern: "none",
  "partner-strip-show": "true",
  "partner-strip-scroll": "false",
  "bg-persistent": "true",
};

/**
 * Per-overlay overrides over BASE_DEFAULTS. Most overlays are pure
 * brand defaults; a handful diverge (e.g. brb shows partner strip,
 * leaderboard wants 3 highlight rows). Any key NOT listed here for an
 * overlay falls back to BASE_DEFAULTS.
 */
const OVERLAY_OVERRIDES: Record<OverlayKey, Partial<Record<string, string>>> = {
  "01-brb": {
    "partner-strip-show": "true",
    pattern: "halftone",
    "bg-image": "",
  },
  "02-timer": {
    "partner-strip-show": "false",
    "bg-persistent": "false",
  },
  "04-h2h-2": {
    "bg-image": "",
  },
  "05-h2h-3": {
    "bg-image": "",
  },
  "06-h2h-5": {
    "bg-image": "",
  },
  "07-leaderboard": {
    "row-highlight-count": "3",
    pattern: "halftone",
    "bg-image": "",
  },
  "08-lower-third": {
    "pos-x": "60",
    "pos-y": "880",
    "partner-strip-show": "false",
    "bg-persistent": "false",
  },
  "09-secondary-score-bug": {
    "pos-x": "40",
    "pos-y": "40",
    "partner-strip-show": "false",
    "bg-persistent": "false",
  },
  "10-up-next-bug": {
    "pos-x": "0",
    "pos-y": "60",
    "partner-strip-show": "false",
    "bg-persistent": "false",
  },
  "11-match-scores-day": {
    "partner-strip-show": "false",
    "bg-image": "",
  },
  "12-starting-soon": {
    "partner-strip-show": "true",
    "bg-image": "",
  },
  "13-stream-ended": {
    "partner-strip-show": "true",
    "bg-image": "",
  },
  "14-top-scorers": {
    "row-highlight-count": "3",
    "bg-image": "",
  },
  "15-orgs": {},
  "16-coaches": {},
  "17-penalties": {
    "partner-strip-show": "false",
  },
  "19-player-squads": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "true",
  },
  "20-highlight": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "false",
  },
  "21-streaks": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "true",
    "partner-strip-scroll": "true",
  },
  "22-power-rankings": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "true",
    "partner-strip-scroll": "true",
  },
  "23-org-standings": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "true",
    "partner-strip-scroll": "true",
  },
  "24-biggest-margins": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "true",
    "partner-strip-scroll": "true",
  },
  "25-did-you-know": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "true",
    "partner-strip-scroll": "true",
  },
  "26-card-meta": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "true",
    "partner-strip-scroll": "true",
  },
  "27-schedule": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "true",
    "partner-strip-scroll": "true",
  },
  "28-punditry": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "true",
    "partner-strip-scroll": "true",
  },
  "29-goalfests": {
    pattern: "halftone",
    "bg-image": "",
    "partner-strip-show": "true",
    "partner-strip-scroll": "true",
  },
};

/**
 * The nine overlay keys that are full-canvas (1920×1080 backdrop visible
 * to the viewer). Only these support a custom `bg-image` token — floating
 * UI cards (timer, lower-third, score-bug, up-next, orgs, coaches,
 * penalties) sit on a transparent canvas where a backdrop makes no sense.
 *
 * `14-top-scorers` is full-canvas (the Golden Pad podium fills the frame
 * and already paints the ELITE S2 stadium BG), so it joins the supported
 * list per Bug 3 (2026-04-28). Seeded by migration
 * `20260615000001_top_scorers_bg_image.sql`.
 *
 * The admin design editor reads this list to gate the bg-image widget.
 * The seed migration `20260612000001_overlay_design_tokens_bg_image.sql`
 * inserts default rows for the original eight keys; the top-scorers
 * follow-up migration above seeds the ninth row.
 */
export const BG_IMAGE_SUPPORTED_KEYS: readonly OverlayKey[] = [
  "01-brb",
  "04-h2h-2",
  "05-h2h-3",
  "06-h2h-5",
  "07-leaderboard",
  "11-match-scores-day",
  "12-starting-soon",
  "13-stream-ended",
  "14-top-scorers",
  "19-player-squads",
  "20-highlight",
  "21-streaks",
  "22-power-rankings",
  "23-org-standings",
  "24-biggest-margins",
  "25-did-you-know",
  "26-card-meta",
  "27-schedule",
  "28-punditry",
  "29-goalfests",
] as const;

/**
 * Whether the given overlay key supports a custom background image.
 * Used by the design editor to filter the catalog + the upload action
 * to validate the request.
 */
export function supportsBgImage(overlayKey: string): boolean {
  return (BG_IMAGE_SUPPORTED_KEYS as readonly string[]).includes(overlayKey);
}

/**
 * Resolve the hard-coded defaults for a given overlay key. DB rows in
 * `overlay_design_tokens` then layer on top via `resolveTokens`.
 *
 * Returns a fresh object every call so callers can safely mutate.
 * Unknown overlay keys return BASE_DEFAULTS (not throw) so tests +
 * preview tools tolerate stub keys.
 */
export function getDefaultsForOverlay(
  overlayKey: string,
): Record<string, string> {
  const overrides =
    (OVERLAY_OVERRIDES as Record<string, Partial<Record<string, string>>>)[
      overlayKey
    ] ?? {};
  const out: Record<string, string> = { ...BASE_DEFAULTS };
  for (const k of Object.keys(overrides)) {
    const v = overrides[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Whether the given key is a known overlay route. Used by callers that
 * want to gate input — the resolver itself is permissive.
 */
export function isOverlayKey(key: string): key is OverlayKey {
  return (OVERLAY_KEYS as readonly string[]).includes(key);
}
