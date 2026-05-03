/**
 * Plan 53 — Gallery listing for the admin player-photos UI.
 *
 * `listPlayerGallery` returns the four feeds the admin gallery page renders:
 *   - manifestPoses        — the 1..N poses pre-shipped under
 *                            `/overlays/v2/_assets/players/processed/<slug>/`,
 *                            each tagged with a `banned` flag for legacy bans
 *                            (anife 1+2, kingnonex 1).
 *   - uploadedPoses        — admin-uploaded extras (pose_index >= 100) whose
 *                            row in `player_photo_uploads` is `status='ready'`.
 *                            Each row is annotated with a `coverage` summary
 *                            derived from `variants_json` so the gallery can
 *                            warn before the admin selects a pose that lacks
 *                            (say) a card variant.
 *   - effectiveGlobalPose  — what the resolver returns for `(playerId, null)`.
 *                            Drives the "Current global default" badge.
 *   - perOverlayOverrides  — dict of `overlay_key → ResolvedPose` from active
 *                            selection rows. Used to render the per-overlay
 *                            override matrix on the same page.
 *
 * Reads only — no writes. Permission gating happens on the page action +
 * `setPlayerPose` / `clearPlayerPose` mutators.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import manifest from '@/server/overlays/players-manifest.json';
import { resolvePlayerPose, type ResolvedPose } from './resolver';
import type { PoseSource } from './variant-map';

const BANNED: Record<string, number[]> = {
  anife: [1, 2],
  kingnonex: [1],
  king_nonex: [1],
};

type ManifestPose = { pose_index: number; variants: Record<string, string | null | undefined> };
type ManifestEntry = { display_name: string; pose_count: number; poses: ManifestPose[] };
type ManifestShape = { players: Record<string, ManifestEntry> };

const players = (manifest as unknown as ManifestShape).players;

export type GalleryPose = {
  poseIndex: number;
  thumbnailUrl: string;
  banned: boolean;
};

export type UploadCoverage = 'full' | 'headshot+card' | 'headshot' | 'incomplete';

export type UploadedPose = {
  poseIndex: number;
  thumbnailUrl: string;
  status: string;
  uploadedAt: string;
  coverage: UploadCoverage;
};

type UploadRowShape = {
  pose_index: number | null;
  status: string | null;
  uploaded_at: string | null;
  variants_json: Record<string, unknown> | null;
};

type SelectionRowShape = {
  overlay_key: string | null;
  pose_index: number;
  source: PoseSource;
};

export async function listPlayerGallery(
  sb: SupabaseClient,
  playerId: string,
  opts: { slug: string },
): Promise<{
  manifestPoses: GalleryPose[];
  uploadedPoses: UploadedPose[];
  effectiveGlobalPose: ResolvedPose;
  perOverlayOverrides: Record<string, ResolvedPose>;
}> {
  const entry = players[opts.slug];
  const manifestPoses: GalleryPose[] = (entry?.poses ?? []).map((p) => ({
    poseIndex: p.pose_index,
    thumbnailUrl: `/overlays/v2/_assets/players/processed/${opts.slug}/headshot_${String(
      p.pose_index,
    ).padStart(2, '0')}_nobg.png`,
    banned: (BANNED[opts.slug] ?? []).includes(p.pose_index),
  }));

  const uploadResp = (await sb
    .from('player_photo_uploads')
    .select('pose_index, status, uploaded_at, variants_json')
    .eq('player_id', playerId)
    .is('deleted_at', null)) as unknown as { data: UploadRowShape[] | null; error: unknown };

  const uploadRows = uploadResp.data ?? [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

  const uploadedPoses: UploadedPose[] = uploadRows
    .filter((r): r is UploadRowShape & { pose_index: number; status: string } =>
      r.status === 'ready' && r.pose_index != null,
    )
    .map((r) => {
      const v = (r.variants_json ?? {}) as Record<string, unknown>;
      const hasHead = !!v.headshot_nobg;
      const hasCard = !!v.card;
      const hasFull = !!v.fullbody_nobg;
      const coverage: UploadCoverage =
        hasHead && hasCard && hasFull
          ? 'full'
          : hasHead && hasCard
            ? 'headshot+card'
            : hasHead
              ? 'headshot'
              : 'incomplete';
      const padded = String(r.pose_index).padStart(r.pose_index >= 100 ? 3 : 2, '0');
      return {
        poseIndex: r.pose_index,
        thumbnailUrl: `${supabaseUrl}/storage/v1/object/public/player-photos/processed/${playerId}/headshot_${padded}_nobg.png`,
        status: r.status,
        uploadedAt: r.uploaded_at ?? '',
        coverage,
      };
    });

  const selResp = (await sb
    .from('player_photo_selections')
    .select('overlay_key, pose_index, source')
    .eq('player_id', playerId)
    .is('deleted_at', null)) as unknown as { data: SelectionRowShape[] | null; error: unknown };

  const selRows = selResp.data ?? [];

  const effectiveGlobalPose = await resolvePlayerPose(sb, playerId, null, { slug: opts.slug });
  const perOverlayOverrides: Record<string, ResolvedPose> = {};
  for (const row of selRows) {
    if (row.overlay_key) {
      perOverlayOverrides[row.overlay_key] = { poseIndex: row.pose_index, source: row.source };
    }
  }

  return { manifestPoses, uploadedPoses, effectiveGlobalPose, perOverlayOverrides };
}
