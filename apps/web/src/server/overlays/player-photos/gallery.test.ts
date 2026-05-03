import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, vi } from 'vitest';
import { listPlayerGallery } from './gallery';

vi.mock('@/server/overlays/players-manifest.json', () => ({
  default: {
    players: {
      mr_oga: {
        display_name: 'Mr Oga',
        pose_count: 3,
        poses: [
          { pose_index: 1, variants: { headshot_nobg: 'mr_oga/headshot_01_nobg.png' } },
          { pose_index: 2, variants: { headshot_nobg: 'mr_oga/headshot_02_nobg.png' } },
          { pose_index: 3, variants: { headshot_nobg: 'mr_oga/headshot_03_nobg.png' } },
        ],
      },
      anife: {
        display_name: 'Anife',
        pose_count: 3,
        poses: [
          { pose_index: 1, variants: { headshot_nobg: 'anife/headshot_01_nobg.png' } },
          { pose_index: 2, variants: { headshot_nobg: 'anife/headshot_02_nobg.png' } },
          { pose_index: 3, variants: { headshot_nobg: 'anife/headshot_03_nobg.png' } },
        ],
      },
    },
  },
}));

type SelectionRow = {
  overlay_key: string | null;
  pose_index: number;
  source: string;
};

type UploadRow = {
  pose_index: number;
  status: string;
  uploaded_at: string;
  variants_json: Record<string, unknown>;
};

/**
 * Build a Supabase-like mock that branches on the table name. The gallery
 * module reads two tables (`player_photo_selections` and `player_photo_uploads`)
 * with the same `from(...).select(...).eq(...).is(...)` chain shape AND also
 * resolves through the resolver which uses an extra `.or(...)` step. The mock
 * returns selection rows for both `is(...)` and `or(...)` terminals so the
 * resolver call inside listPlayerGallery sees the same selection data.
 */
function mkSb(selectionRows: SelectionRow[], uploadRows: UploadRow[] = []): SupabaseClient {
  const sb = {
    from: vi.fn((tbl: string) => {
      const rows = tbl === 'player_photo_selections' ? selectionRows : uploadRows;
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              // Some chains end here (gallery's own reads), others tack on `.or(...)`
              // (resolver's read). Make the `is(...)` step thenable AND chainable.
              or: vi.fn().mockResolvedValue({ data: rows, error: null }),
              then: (resolve: (v: { data: unknown; error: null }) => void) => {
                resolve({ data: rows, error: null });
              },
            }),
          }),
        }),
      };
    }),
  };
  return sb as unknown as SupabaseClient;
}

describe('listPlayerGallery', () => {
  it('returns manifest poses with banned flag for legacy bans', async () => {
    const sb = mkSb([{ overlay_key: null, pose_index: 3, source: 'manifest' }]);
    const result = await listPlayerGallery(sb, 'P', { slug: 'anife' });
    // anife pose 1 is banned per legacy
    const pose1 = result.manifestPoses.find((p) => p.poseIndex === 1);
    expect(pose1?.banned).toBe(true);
  });
  it('joins uploaded poses ready for selection', async () => {
    const sb = mkSb(
      [],
      [
        {
          pose_index: 100,
          status: 'ready',
          uploaded_at: '2026-05-04T00:00:00Z',
          variants_json: { headshot_nobg: 'x' },
        },
      ],
    );
    const result = await listPlayerGallery(sb, 'P', { slug: 'mr_oga' });
    expect(result.uploadedPoses.length).toBe(1);
    expect(result.uploadedPoses[0].poseIndex).toBe(100);
  });
});
