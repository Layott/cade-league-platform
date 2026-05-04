/**
 * Social-media render size presets for Plan 54 (broadcast social-media asset
 * generation). Each entry locks pixel dimensions + aspect ratio for one target
 * platform surface. The `width`/`height` fields are passed verbatim to
 * `next/og` `ImageResponse({ width, height })` so changing them changes the
 * rendered PNG dimensions — do not edit casually.
 *
 * Phase 1 ships these three sizes only; Phase 2/3 may add more. See spec
 * `docs/superpowers/specs/2026-05-05-broadcast-social-media.md` §3.
 */

export const SIZE_PRESETS = {
  "1080x1920": {
    width: 1080,
    height: 1920,
    label: "IG Reel / Story / TikTok / YT Short",
    aspect: "9:16",
  },
  "1080x1080": {
    width: 1080,
    height: 1080,
    label: "IG Feed",
    aspect: "1:1",
  },
  "1200x675": {
    width: 1200,
    height: 675,
    label: "X Post",
    aspect: "16:9",
  },
} as const;

export type SocialSize = keyof typeof SIZE_PRESETS;
export type SocialSizePreset = (typeof SIZE_PRESETS)[SocialSize];

/**
 * Type guard — narrows a runtime string to a known preset key.
 */
export function isValidSize(s: string): s is SocialSize {
  return Object.prototype.hasOwnProperty.call(SIZE_PRESETS, s);
}

/**
 * Parser — accepts a runtime string (e.g. from a route param) and returns the
 * matching preset key. Throws a descriptive Error if the string is not a known
 * preset. Use this at API-route boundaries so downstream code can rely on the
 * `SocialSize` narrowing.
 */
export function parseSize(s: string): SocialSize {
  if (!isValidSize(s)) {
    const valid = Object.keys(SIZE_PRESETS).join(", ");
    throw new Error(
      `Unknown social size "${s}". Valid sizes: ${valid}.`,
    );
  }
  return s;
}

/**
 * Convenience accessor — returns the preset record for a validated key.
 */
export function getSizePreset(size: SocialSize): SocialSizePreset {
  return SIZE_PRESETS[size];
}
