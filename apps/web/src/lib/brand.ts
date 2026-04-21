/**
 * Brand asset registry.
 *
 * Paths resolve from `apps/web/public/` — use them directly in `<Image src>` /
 * `<img src>` / metadata fields. Source files live in
 * `KNOWLEDGE/brand-assets/logos/` (do not reference the KNOWLEDGE paths from
 * application code; only the copies under `public/brand/logos/` are shipped).
 */

export const PRIMARY_LOGOS = {
  cade: "/brand/logos/primary/cade.png",
  gameevoBlack: "/brand/logos/primary/gameevo-black.png",
  gameevoWhite: "/brand/logos/primary/gameevo-white.png",
  proLeague: "/brand/logos/primary/pro-league.png",
} as const;

export const PARTNER_LOGOS = {
  esportsAfricaNewsBlack: "/brand/logos/partners/esports-africa-news-black.png",
  esportsAfricaNewsWhite: "/brand/logos/partners/esports-africa-news-white.png",
  gamepride: "/brand/logos/partners/gamepride.png",
  esfNigeria: "/brand/logos/partners/esf-nigeria.png",
} as const;

export const BRAND_TOKENS = {
  primary: "#6bcd06",
  secondary: "#fe036d",
  black: "#000000",
  white: "#ffffff",
} as const;

export type PrimaryLogoKey = keyof typeof PRIMARY_LOGOS;
export type PartnerLogoKey = keyof typeof PARTNER_LOGOS;
export type BrandTokenKey = keyof typeof BRAND_TOKENS;
