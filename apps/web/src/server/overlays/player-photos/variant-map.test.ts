import { describe, it, expect } from 'vitest';
import { getVariantKindForOverlay, buildPhotoUrl } from './variant-map';

describe('variant-map', () => {
  it('maps card-style overlays to card variant', () => {
    expect(getVariantKindForOverlay('19-player-squads')).toBe('card');
  });
  it('maps fullbody-style overlays to fullbody variant', () => {
    expect(getVariantKindForOverlay('01-long-intro')).toBe('fullbody');
    expect(getVariantKindForOverlay('05-stinger-winner')).toBe('fullbody');
  });
  it('defaults to headshot for unknown / common overlays', () => {
    expect(getVariantKindForOverlay('07-leaderboard')).toBe('headshot');
    expect(getVariantKindForOverlay('99-unknown')).toBe('headshot');
  });
  it('builds manifest path for headshot', () => {
    expect(
      buildPhotoUrl({
        slug: 'mr_oga',
        playerId: 'PID',
        poseIndex: 3,
        variantKind: 'headshot',
        source: 'manifest',
      }),
    ).toBe('/overlays/v2/_assets/players/processed/mr_oga/headshot_03_nobg.png');
  });
  it('builds manifest path for card (no _nobg suffix)', () => {
    expect(
      buildPhotoUrl({
        slug: 'mr_oga',
        playerId: 'PID',
        poseIndex: 3,
        variantKind: 'card',
        source: 'manifest',
      }),
    ).toBe('/overlays/v2/_assets/players/processed/mr_oga/card_03.png');
  });
  it('builds upload path with player id + padded pose', () => {
    const url = buildPhotoUrl({
      slug: 'mr_oga',
      playerId: 'abc-123',
      poseIndex: 100,
      variantKind: 'headshot',
      source: 'upload',
      supabaseUrl: 'https://x.supabase.co',
    });
    expect(url).toBe(
      'https://x.supabase.co/storage/v1/object/public/player-photos/processed/abc-123/headshot_100_nobg.png',
    );
  });
});
