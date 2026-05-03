import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, vi } from 'vitest';
import { setPlayerPose, clearPlayerPose } from './mutations';

// Real `Actor` shape from `@/perms` is `{ userId: string | null; roles: readonly string[] }`.
// (Plan 53 §4.1 originally drafted `{ id, role }` — adjusted here so the type contract holds.)
const ALL_PERMS = { userId: 'admin-uid', roles: ['admin'] as const };

type MockCall =
  | { op: 'upsert'; tbl: string; row: Record<string, unknown> }
  | { op: 'update'; tbl: string; patch: Record<string, unknown> };

function mkSb() {
  const calls: MockCall[] = [];
  const sb = {
    calls,
    from: vi.fn((tbl: string) => ({
      upsert: vi.fn(async (row: Record<string, unknown>) => {
        calls.push({ op: 'upsert', tbl, row });
        return { error: null };
      }),
      update: vi.fn((patch: Record<string, unknown>) => {
        // The clear path is `update().eq().is()` for the global-scope branch
        // and `update().eq().eq().is()` for the per-overlay branch. The chain
        // below resolves identically at either depth so both branches work.
        let recorded = false;
        const record = () => {
          if (recorded) return;
          calls.push({ op: 'update', tbl, patch });
          recorded = true;
        };
        const thenable: {
          eq: ReturnType<typeof vi.fn>;
          is: ReturnType<typeof vi.fn>;
          then: (resolve: (v: { error: null }) => void) => void;
        } = {
          eq: vi.fn(() => thenable),
          is: vi.fn(() => {
            record();
            return Promise.resolve({ error: null });
          }),
          then: (resolve) => {
            record();
            resolve({ error: null });
          },
        };
        return thenable;
      }),
    })),
  };
  return sb;
}

vi.mock('@/lib/perms-db', () => ({
  requirePermAsync: vi.fn(async () => undefined),
}));

describe('mutations', () => {
  it('setPlayerPose upserts with global scope when overlayKey null', async () => {
    const sb = mkSb();
    await setPlayerPose({
      sb: sb as unknown as SupabaseClient,
      actor: ALL_PERMS,
      playerId: 'P',
      overlayKey: null,
      poseIndex: 4,
      source: 'manifest',
    });
    const first = sb.calls[0];
    expect(first.op).toBe('upsert');
    if (first.op !== 'upsert') throw new Error('unreachable');
    expect(first.row.overlay_key).toBeNull();
    expect(first.row.pose_index).toBe(4);
  });
  it('setPlayerPose upserts with per-overlay scope when overlayKey provided', async () => {
    const sb = mkSb();
    await setPlayerPose({
      sb: sb as unknown as SupabaseClient,
      actor: ALL_PERMS,
      playerId: 'P',
      overlayKey: '19-player-squads',
      poseIndex: 3,
      source: 'upload',
    });
    const first = sb.calls[0];
    expect(first.op).toBe('upsert');
    if (first.op !== 'upsert') throw new Error('unreachable');
    expect(first.row.overlay_key).toBe('19-player-squads');
    expect(first.row.source).toBe('upload');
  });
  it('clearPlayerPose soft-deletes the row', async () => {
    const sb = mkSb();
    await clearPlayerPose({
      sb: sb as unknown as SupabaseClient,
      actor: ALL_PERMS,
      playerId: 'P',
      overlayKey: '07-leaderboard',
    });
    const first = sb.calls[0];
    expect(first.op).toBe('update');
    if (first.op !== 'update') throw new Error('unreachable');
    expect(first.patch.deleted_at).toBeDefined();
  });
});
