/**
 * Plan 53 Task 11 — Server-rendered grid of per-player photo cards.
 *
 * Renders 13 cards (one per active roster player). Each card calls the
 * Plan 53 resolver with `overlayKey=null` to find the EFFECTIVE GLOBAL
 * pose, then builds a thumbnail URL pointing at either the static asset
 * tree (`/overlays/v2/_assets/players/processed/<slug>/...`) or the
 * Supabase Storage bucket (uploaded poses, pose_index >= 100).
 *
 * Server boundary stops at `<PlayerPhotoModalLauncher>` — that client
 * component handles the modal opening (Task 12 wires the body).
 *
 * Mounted in `apps/web/src/app/admin/broadcast/v2/design/page.tsx` after
 * the design Tokens / Templates / History sections.
 */
import { getServerSupabase } from "@/lib/supabase/server";
import { resolvePlayerPose } from "@/server/overlays/player-photos/resolver";
import { gamerTagToSlug } from "@/lib/player-photos";
import {
  PlayerPhotoModalLauncher,
  type PlayerPhotoCard,
} from "./PlayerPhotoModalLauncher.client";

export async function PlayerPhotoPanel() {
  const sb = await getServerSupabase();
  // `players` table has `gamer_tag NOT NULL` but no `display_name`
  // column — a player's friendly name lives on `users` via the FK.
  // For this panel we only need a stable, unique tag (the slug seed),
  // so `gamer_tag` alone is sufficient.
  const { data: players } = await sb
    .from("players")
    .select("id, gamer_tag")
    .is("deleted_at", null)
    .order("gamer_tag");

  const supabaseBase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  const cards: PlayerPhotoCard[] = await Promise.all(
    (players ?? []).map(async (p: { id: string; gamer_tag: string | null }) => {
      const tag = p.gamer_tag ?? "";
      const slug = gamerTagToSlug(tag);
      const resolved = await resolvePlayerPose(sb, p.id, null, { slug });
      const padded = String(resolved.poseIndex).padStart(
        resolved.poseIndex >= 100 ? 3 : 2,
        "0",
      );
      const thumbUrl =
        resolved.source === "manifest"
          ? `/overlays/v2/_assets/players/processed/${slug}/headshot_${padded}_nobg.png`
          : `${supabaseBase}/storage/v1/object/public/player-photos/processed/${p.id}/headshot_${padded}_nobg.png`;
      return {
        id: p.id,
        slug,
        name: tag || "?",
        thumbUrl,
        poseIndex: resolved.poseIndex,
      };
    }),
  );

  return (
    <section className="space-y-3" data-testid="player-photo-panel">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
          Player photos · {cards.length}
        </h2>
        <p className="text-xs text-[var(--chalk-3)]">
          Pick or upload the photo each player shows in overlays.
        </p>
      </header>
      {cards.length === 0 ? (
        <p className="text-sm text-[var(--chalk-3)]">
          No active roster players found.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-5 lg:grid-cols-7">
          {cards.map((c) => (
            <PlayerPhotoModalLauncher key={c.id} card={c} />
          ))}
        </div>
      )}
    </section>
  );
}
