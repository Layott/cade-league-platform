/**
 * Plan 51 — broadcast v2 control panel player roster.
 *
 * Mirrors the `PLAYER_SLUGS` / `PLAYER_NAMES` constants used by the static
 * mockup at `KNOWLEDGE/brand-assets/elements/v2/index.html` so the live
 * Next.js control room produces identical postMessage payloads. The 13
 * Elite 2025-2026 roster is hard-coded per `CLAUDE.md` repo state — no
 * multi-season abstraction.
 *
 * Slug values match the `KNOWLEDGE/brand-assets/players/<slug>/...` asset
 * paths processed by the rembg/OpenCV pipeline. Display names are the
 * upper-case stage names used on overlays.
 */
export const V2_PLAYER_SLUGS = [
  "adefola",
  "anife",
  "baji_jnr",
  "dadaboi",
  "faruk",
  "guru",
  "kaykay",
  "killer_freak",
  "king_nonex",
  "mitch",
  "mr_oga",
  "tactical",
  "wolevation",
] as const;

export type V2PlayerSlug = (typeof V2_PLAYER_SLUGS)[number];

export const V2_PLAYER_NAMES: Record<V2PlayerSlug, string> = {
  adefola: "ADEFOLA",
  anife: "ANIFE",
  baji_jnr: "BAJI JNR",
  dadaboi: "DADABOI",
  faruk: "FARUK",
  guru: "GURU",
  kaykay: "KAYKAY",
  killer_freak: "KILLER FREAK",
  king_nonex: "KING NONEX",
  mitch: "MITCH",
  mr_oga: "MR OGA",
  tactical: "TACTICAL",
  wolevation: "WOLEVATION",
};

export function v2PlayerLabel(slug: V2PlayerSlug | string): string {
  return (V2_PLAYER_NAMES as Record<string, string>)[slug] ?? slug.toUpperCase();
}
