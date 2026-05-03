import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePlayerPose } from './resolver';

type SelectionRow = {
  player_id: string;
  overlay_key: string | null;
  pose_index: number;
  source: string;
};

/**
 * Build a minimal Supabase-like mock whose fluent chain ends at
 * `from(...).select(...).eq(...).is(...).or(...)` and resolves with the
 * provided rows. Mirrors the single read path in resolvePlayerPose.
 */
function mkSb(rows: SelectionRow[]): SupabaseClient {
  const sb = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            or: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  };
  return sb as unknown as SupabaseClient;
}

describe('resolvePlayerPose', () => {
  it('prefers per-overlay override over global', async () => {
    const sb = mkSb([
      { player_id: 'P', overlay_key: null, pose_index: 5, source: 'manifest' },
      { player_id: 'P', overlay_key: '19-player-squads', pose_index: 3, source: 'manifest' },
    ]);
    const result = await resolvePlayerPose(sb, 'P', '19-player-squads');
    expect(result.poseIndex).toBe(3);
    expect(result.source).toBe('manifest');
  });
  it('falls back to global when no per-overlay row', async () => {
    const sb = mkSb([
      { player_id: 'P', overlay_key: null, pose_index: 5, source: 'manifest' },
    ]);
    const result = await resolvePlayerPose(sb, 'P', '07-leaderboard');
    expect(result.poseIndex).toBe(5);
  });
  it('falls back to legacy default for known slug when DB empty', async () => {
    const sb = mkSb([]);
    const result = await resolvePlayerPose(sb, 'P', null, { slug: 'anife' });
    expect(result.poseIndex).toBe(3); // legacy DEFAULT_POSE_BY_SLUG.anife
  });
  it('falls back to pose 1 when nothing matches', async () => {
    const sb = mkSb([]);
    const result = await resolvePlayerPose(sb, 'P', null, { slug: 'unknown_slug' });
    expect(result.poseIndex).toBe(1);
    expect(result.source).toBe('manifest');
  });
});
