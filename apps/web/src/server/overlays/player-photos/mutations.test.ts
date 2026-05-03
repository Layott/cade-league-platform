import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, vi } from 'vitest';
import { setPlayerPose, clearPlayerPose } from './mutations';

// Real `Actor` shape from `@/perms` is `{ userId: string | null; roles: readonly string[] }`.
const ALL_PERMS = { userId: 'admin-uid', roles: ['admin'] as const };

type MockCall =
  | { op: 'select'; tbl: string }
  | { op: 'insert'; tbl: string; row: Record<string, unknown> }
  | { op: 'update'; tbl: string; patch: Record<string, unknown> };

function mkSb(opts: { existingId?: string | null } = {}) {
  const existingId = opts.existingId ?? null;
  const calls: MockCall[] = [];
  const sb = {
    calls,
    from: vi.fn((tbl: string) => ({
      // setPlayerPose lookup chain: .select('id').eq('player_id', x).is('deleted_at', null)
      //   .is('overlay_key', null) | .eq('overlay_key', k)
      //   .maybeSingle()
      select: vi.fn(() => {
        calls.push({ op: 'select', tbl });
        const finalize = () => Promise.resolve({
          data: existingId ? { id: existingId } : null,
          error: null,
        });
        const lookupChain: {
          eq: ReturnType<typeof vi.fn>;
          is: ReturnType<typeof vi.fn>;
          maybeSingle: ReturnType<typeof vi.fn>;
        } = {
          eq: vi.fn(() => lookupChain),
          is: vi.fn(() => lookupChain),
          maybeSingle: vi.fn(() => finalize()),
        };
        return lookupChain;
      }),
      // setPlayerPose update branch: .update(patch).eq('id', existingId)
      // clearPlayerPose: .update(patch).eq('player_id', P).is('overlay_key', null)
      //                  | .update(patch).eq('player_id', P).eq('overlay_key', k).is('deleted_at', null)
      update: vi.fn((patch: Record<string, unknown>) => {
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
      // setPlayerPose insert branch
      insert: vi.fn(async (row: Record<string, unknown>) => {
        calls.push({ op: 'insert', tbl, row });
        return { error: null };
      }),
    })),
  };
  return sb;
}

vi.mock('@/lib/perms-db', () => ({
  requirePermAsync: vi.fn(async () => undefined),
}));

describe('mutations', () => {
  it('setPlayerPose inserts with global scope when no existing row', async () => {
    const sb = mkSb({ existingId: null });
    await setPlayerPose({
      sb: sb as unknown as SupabaseClient,
      actor: ALL_PERMS,
      playerId: 'P',
      overlayKey: null,
      poseIndex: 4,
      source: 'manifest',
    });
    const insertCall = sb.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    if (insertCall?.op !== 'insert') throw new Error('unreachable');
    expect(insertCall.row.overlay_key).toBeNull();
    expect(insertCall.row.pose_index).toBe(4);
    expect(insertCall.row.source).toBe('manifest');
  });
  it('setPlayerPose inserts with per-overlay scope when no existing row', async () => {
    const sb = mkSb({ existingId: null });
    await setPlayerPose({
      sb: sb as unknown as SupabaseClient,
      actor: ALL_PERMS,
      playerId: 'P',
      overlayKey: '19-player-squads',
      poseIndex: 3,
      source: 'upload',
    });
    const insertCall = sb.calls.find((c) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    if (insertCall?.op !== 'insert') throw new Error('unreachable');
    expect(insertCall.row.overlay_key).toBe('19-player-squads');
    expect(insertCall.row.source).toBe('upload');
    expect(insertCall.row.pose_index).toBe(3);
  });
  it('setPlayerPose updates existing row instead of inserting', async () => {
    const sb = mkSb({ existingId: 'sel-123' });
    await setPlayerPose({
      sb: sb as unknown as SupabaseClient,
      actor: ALL_PERMS,
      playerId: 'P',
      overlayKey: '07-leaderboard',
      poseIndex: 5,
      source: 'manifest',
    });
    const insertCall = sb.calls.find((c) => c.op === 'insert');
    const updateCall = sb.calls.find((c) => c.op === 'update');
    expect(insertCall).toBeUndefined();
    expect(updateCall).toBeDefined();
    if (updateCall?.op !== 'update') throw new Error('unreachable');
    expect(updateCall.patch.pose_index).toBe(5);
    expect(updateCall.patch.source).toBe('manifest');
  });
  it('clearPlayerPose soft-deletes the row', async () => {
    const sb = mkSb();
    await clearPlayerPose({
      sb: sb as unknown as SupabaseClient,
      actor: ALL_PERMS,
      playerId: 'P',
      overlayKey: '07-leaderboard',
    });
    const updateCall = sb.calls.find((c) => c.op === 'update');
    expect(updateCall).toBeDefined();
    if (updateCall?.op !== 'update') throw new Error('unreachable');
    expect(updateCall.patch.deleted_at).toBeDefined();
  });
});
