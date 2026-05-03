/**
 * Plan 53 — Pose resolver.
 *
 * Resolution order:
 *   1. per-overlay override (player_photo_selections row with matching overlay_key)
 *   2. global default     (player_photo_selections row with overlay_key IS NULL)
 *   3. legacy DEFAULT_POSE_BY_SLUG (hard-coded slugs that need a non-1 pose)
 *   4. pose 1, source 'manifest'
 *
 * Each row in `player_photo_selections` carries (player_id, overlay_key NULLABLE,
 * pose_index, source). A non-null overlay_key means "use this pose for that overlay
 * only"; a null overlay_key means "use this pose for every overlay that doesn't have
 * its own row".
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PoseSource } from './variant-map';

export type ResolvedPose = { poseIndex: number; source: PoseSource };

const LEGACY_DEFAULTS: Record<string, number> = {
  anife: 3,
  kingnonex: 2,
  king_nonex: 2,
};

export async function resolvePlayerPose(
  sb: SupabaseClient,
  playerId: string,
  overlayKey: string | null,
  opts?: { slug?: string },
): Promise<ResolvedPose> {
  const { data, error } = await sb
    .from('player_photo_selections')
    .select('overlay_key, pose_index, source')
    .eq('player_id', playerId)
    .is('deleted_at', null)
    .or(`overlay_key.is.null,overlay_key.eq.${overlayKey ?? '__never__'}`);

  if (error) {
    return fallback(opts?.slug);
  }
  const rows = (data ?? []) as Array<{ overlay_key: string | null; pose_index: number; source: PoseSource }>;
  if (overlayKey) {
    const perOverlay = rows.find((r) => r.overlay_key === overlayKey);
    if (perOverlay) return { poseIndex: perOverlay.pose_index, source: perOverlay.source };
  }
  const global = rows.find((r) => r.overlay_key === null);
  if (global) return { poseIndex: global.pose_index, source: global.source };
  return fallback(opts?.slug);
}

function fallback(slug?: string): ResolvedPose {
  if (slug && LEGACY_DEFAULTS[slug] != null) {
    return { poseIndex: LEGACY_DEFAULTS[slug], source: 'manifest' };
  }
  return { poseIndex: 1, source: 'manifest' };
}

