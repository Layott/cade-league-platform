/**
 * Plan 53 — Set / clear player photo selections.
 *
 * Both writes gate on the `overlay.design.manage` permission (admin / design /
 * production roles per the §15 Overlay Design System seed). The selection
 * table is `player_photo_selections` with a partial unique index on
 * `(player_id, overlay_key)` for upsert conflict resolution; `overlay_key`
 * NULL means "global default for this player across all overlays".
 *
 * Clears are soft-delete only — never DELETE — so the audit trigger captures
 * the transition and admins can restore via /trash if needed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePermAsync } from '@/lib/perms-db';
import type { Actor } from '@/perms';
import type { PoseSource } from './variant-map';

export async function setPlayerPose(opts: {
  sb: SupabaseClient;
  actor: Actor;
  playerId: string;
  overlayKey: string | null;
  poseIndex: number;
  source: PoseSource;
}): Promise<void> {
  const { sb, actor, playerId, overlayKey, poseIndex, source } = opts;
  await requirePermAsync(sb, actor, 'overlay.design.manage');
  const { error } = await sb.from('player_photo_selections').upsert(
    {
      player_id: playerId,
      overlay_key: overlayKey,
      pose_index: poseIndex,
      source,
      active: true,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'player_id,overlay_key' },
  );
  if (error) throw new Error(`setPlayerPose failed: ${error.message}`);
}

export async function clearPlayerPose(opts: {
  sb: SupabaseClient;
  actor: Actor;
  playerId: string;
  overlayKey: string | null;
}): Promise<void> {
  const { sb, actor, playerId, overlayKey } = opts;
  await requirePermAsync(sb, actor, 'overlay.design.manage');
  const q = sb
    .from('player_photo_selections')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('player_id', playerId);
  const final =
    overlayKey === null
      ? q.is('overlay_key', null)
      : q.eq('overlay_key', overlayKey).is('deleted_at', null);
  const { error } = await final;
  if (error) throw new Error(`clearPlayerPose failed: ${error.message}`);
}
