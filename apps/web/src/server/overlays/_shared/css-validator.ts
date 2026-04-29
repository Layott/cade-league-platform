/**
 * Overlay Design Page v2 — shared CSS / element-id validators.
 *
 * Used by:
 *   - text/elements.ts to validate font_family, color, alignment.
 *   - animations/elements.ts to validate easing strings.
 *   - animations/elements.ts (via sanitize_keyframes.ts) to scrub
 *     custom @keyframes bodies against an allowlist of CSS properties.
 *   - text/elements.ts to validate kebab-case element_id strings.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §3.5
 */

/**
 * Validate `#rgb`, `#rrggbb`, `#rrggbbaa`, or `rgba(...)` / `rgb(...)`
 * strings. Cap accepts up to 8 hex chars. The body of an `rgba(...)`
 * is permitted to contain digits, dot, comma, percent, whitespace, and
 * a leading minus (rare but legal in HSL siblings — kept tight).
 */
export const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%-]+\))$/;

/**
 * Kebab-case element_id (must start with a lowercase letter, may
 * include digits + hyphens). Length capped at 64 characters to align
 * with HTML attribute conventions.
 */
export const ELEMENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Brand-locked font allowlist. Adding a new family requires
 * `next/font/local` wiring + license sign-off. Keep in sync with
 * `apps/web/src/server/overlays/design/defaults.ts::FONT_VALUES`.
 */
export const FONT_FAMILY_ALLOWLIST = [
  "Agharti",
  "Quedora",
  "Inter",
  "JetBrains Mono",
] as const;

/**
 * CSS easing — preset list OR a literal `cubic-bezier(...)` whose
 * arguments are 4 numbers (signed, decimal allowed).
 */
export const EASING_RE =
  /^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\(\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*,\s*-?[0-9.]+\s*\))$/;

/**
 * CSS / HTML metacharacters we never let through into a string that
 * gets concatenated into a CSS rule. Matches the existing
 * `apps/web/src/server/overlays/design/preview.ts::FORBIDDEN_CHARS`.
 */
export const FORBIDDEN_CSS_CHARS = /[;{}<>"'`]/;

/**
 * Allowlist of CSS properties valid inside a custom `@keyframes`
 * body. Anything outside this list = reject. Picked to cover the
 * built-in animation family (slide, fade, scale, glow, etc.) without
 * exposing layout-affecting properties (width, height, padding) that
 * could produce unexpected reflows in OBS browser sources.
 */
export const ALLOWED_KEYFRAMES_PROPS = new Set<string>([
  "opacity",
  "transform",
  "filter",
  "letter-spacing",
  "color",
  "background-color",
  "border-color",
  "text-shadow",
  "box-shadow",
]);

/**
 * Allowlist of CSS alignment values for text-align.
 */
export const ALIGNMENT_VALUES = ["left", "center", "right", "justify"] as const;

export function isValidColor(v: string | null | undefined): boolean {
  if (!v) return false;
  if (FORBIDDEN_CSS_CHARS.test(v)) return false;
  return COLOR_RE.test(v);
}

export function isValidElementId(v: string | null | undefined): boolean {
  if (!v) return false;
  return ELEMENT_ID_RE.test(v);
}

export function isValidFont(v: string | null | undefined): boolean {
  if (!v) return false;
  return (FONT_FAMILY_ALLOWLIST as readonly string[]).includes(v);
}

export function isValidEasing(v: string | null | undefined): boolean {
  if (!v) return false;
  if (FORBIDDEN_CSS_CHARS.test(v)) return false;
  return EASING_RE.test(v);
}

export function isValidAlignment(v: string | null | undefined): boolean {
  if (!v) return false;
  return (ALIGNMENT_VALUES as readonly string[]).includes(v);
}

/**
 * Scrub an arbitrary CSS-leaning string. Strips the metacharacters
 * that can break out of a CSS variable / declaration / rule context.
 * Mirrors `apps/web/src/server/overlays/design/preview.ts::escapeCssValue`.
 */
export function escapeCssValue(v: string): string {
  return v.replace(/[;{}<>"'`]/g, "");
}
