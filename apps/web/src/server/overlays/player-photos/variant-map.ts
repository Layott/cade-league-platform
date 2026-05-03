/**
 * Plan 53 — Variant-kind map + photo URL builder.
 *
 * Each v2 broadcast overlay key maps to a "variant kind" (headshot | card | fullbody)
 * which selects which processed image variant to use when rendering the player.
 *
 * Manifest paths: /overlays/v2/_assets/players/processed/<slug>/<variant>_<NN>[_nobg].png
 *   - headshot + fullbody → use _nobg suffix (transparent stripped image)
 *   - card                → no suffix (card art is full-frame, includes bg)
 *
 * Upload paths: <supabaseUrl>/storage/v1/object/public/player-photos/processed/<playerId>/<variant>_<NN>[_nobg].png
 *   - same suffix rule as manifest
 *   - playerId is the players.id UUID (not slug) to keep storage layout neutral on rename
 *   - upload pose indexes are 100+ to stay distinct from manifest 01..09
 */

export type VariantKind = 'headshot' | 'card' | 'fullbody';
export type PoseSource = 'manifest' | 'upload';

export const OVERLAY_VARIANT_KIND: Record<string, VariantKind> = {
  '04-h2h-2': 'headshot',
  '05-h2h-3': 'headshot',
  '06-h2h-5': 'headshot',
  '07-leaderboard': 'headshot',
  '08-lower-third': 'headshot',
  '09-secondary-score-bug': 'headshot',
  '10-up-next-bug': 'headshot',
  '11-match-scores-day': 'headshot',
  '14-top-scorers': 'headshot',
  '15-orgs': 'headshot',
  '16-coaches': 'headshot',
  '17-penalties': 'headshot',
  '19-player-squads': 'card',
  '01-long-intro': 'fullbody',
  '05-stinger-winner': 'fullbody',
};

export function getVariantKindForOverlay(key: string): VariantKind {
  return OVERLAY_VARIANT_KIND[key] ?? 'headshot';
}

export interface BuildPhotoUrlOptions {
  slug: string;
  playerId: string;
  poseIndex: number;
  variantKind: VariantKind;
  source: PoseSource;
  /**
   * Public Supabase URL origin (no trailing slash). Defaults to
   * `process.env.NEXT_PUBLIC_SUPABASE_URL` when omitted. Tests pass this
   * explicitly so they don't depend on the runtime env var.
   */
  supabaseUrl?: string;
}

export function buildPhotoUrl(opts: BuildPhotoUrlOptions): string {
  const { slug, playerId, poseIndex, variantKind, source } = opts;
  const supabaseUrl = opts.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const padded = String(poseIndex).padStart(poseIndex >= 100 ? 3 : 2, '0');
  const suffix = variantKind === 'card' ? '' : '_nobg';
  if (source === 'manifest') {
    return `/overlays/v2/_assets/players/processed/${slug}/${variantKind}_${padded}${suffix}.png`;
  }
  return `${supabaseUrl}/storage/v1/object/public/player-photos/processed/${playerId}/${variantKind}_${padded}${suffix}.png`;
}
