/**
 * Plan 32 — Player headshot resolver.
 *
 * Resolves a public-asset URL for a player headshot, derived from the
 * static manifest at `src/server/overlays/players-manifest.json` (Plan 22 +
 * Plan 16). Headshots are STATIC files under `apps/web/public/players/`,
 * so callers receive a path like `/players/<slug>/headshot_NN[_nobg].png`
 * suitable for `<img src=...>` or `<Image src=...>`.
 *
 * Returns `null` when the player isn't in the 13-roster manifest so the
 * UI falls back to the existing initials block in `<PlayerAvatar>`.
 *
 * Slug derivation: lowercased + spaces / hyphens replaced with underscores.
 * Matches the directory naming that Plan 22's image pipeline produced.
 */
import manifest from "@/server/overlays/players-manifest.json";

export type PlayerPhotoVariant = "normal" | "transparent";

type ManifestPose = {
  pose_index: number;
  variants: {
    headshot: string;
    headshot_nobg?: string | null;
    [k: string]: string | null | undefined;
  };
};

type ManifestEntry = {
  display_name: string;
  pose_count: number;
  poses: ManifestPose[];
};

type ManifestShape = {
  players: Record<string, ManifestEntry>;
};

const players = (manifest as unknown as ManifestShape).players;

/**
 * Per-slug default pose override.
 *
 * `getPlayerHeadshotUrl(...)` defaults to pose_index=1 for every player,
 * but for some roster members pose 01 happens to be a take the user has
 * rejected (back-of-jersey, face-covered, eyes closed, etc). Listing a
 * slug here changes the DEFAULT pose payload-driven overlays receive
 * (h2h-2/3/5, score-bug, lower-third, etc) so post-update repaints don't
 * snap back to a banned pose.
 *
 * Banned poses are also documented in tasks/lessons.md (2026-05-02 entry)
 * so future scrapes / re-processes know not to re-introduce them.
 */
const DEFAULT_POSE_BY_SLUG: Record<string, number> = {
  // 2026-05-03 — pose_05 not currently deployed to Vercel (build cache lag);
  // pose_03 (Anife flexing arm, clean face) is on prod. Switch back to 5
  // once Vercel re-syncs `_assets/players/processed/` post-prebuild.
  anife: 3, // pose_01 = hands-covering-mouth (BANNED), pose_02 has face crop user rejected, pose_05 = preferred but not yet on prod
  kingnonex: 2, // pose_01 = back-of-jersey (BANNED), pose_03 = head down / face dim
  king_nonex: 2, // alias for "KING NONEX" gamer_tag form (gamerTagToSlug collapses space → underscore)
};

/**
 * Public: convert a gamer tag (or display name) to the manifest slug.
 * Lowercased; whitespace and hyphens collapsed to underscores; trims
 * surrounding whitespace. e.g. "Killer Freak" → "killer_freak",
 * "Mr Oga" → "mr_oga".
 */
export function gamerTagToSlug(gamerTag: string): string {
  return gamerTag
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Resolve a public URL for a player's headshot.
 *
 * B6 update (2026-04-28): the v2 overlay sync script ships fully bg-
 * stripped headshots at `/overlays/v2/_assets/players/processed/<slug>/
 * headshot_<NN>_nobg.png`. The Plan 22 path at `/players/<slug>/
 * headshot_<NN>.png` still works (assets are also transparent there)
 * but the v2 path is the canonical one consumed by every v2 overlay,
 * so server payloads now hand out the v2 URL. This guarantees that
 * top-scorers, lower-third, h2h, etc. all resolve photos from the
 * same asset tree and the static-HTML fallbacks line up.
 *
 * Returns null when the slug isn't in the manifest or the requested pose
 * doesn't exist. Caller falls back to initials.
 */
export function getPlayerHeadshotUrl(
  gamerTag: string | null | undefined,
  variant: PlayerPhotoVariant = "normal",
  poseIndex?: number,
): string | null {
  if (!gamerTag) return null;
  const slug = gamerTagToSlug(gamerTag);
  if (!slug) return null;
  const entry = players[slug];
  if (!entry) return null;
  // Resolve default pose: explicit caller arg wins, else per-slug
  // override, else 1.
  const effectivePose =
    poseIndex != null ? poseIndex : (DEFAULT_POSE_BY_SLUG[slug] ?? 1);
  const pose = entry.poses.find((p) => p.pose_index === effectivePose);
  if (!pose) return null;
  // The v2 sync script publishes both `headshot_<NN>.png` and
  // `headshot_<NN>_nobg.png` under `/overlays/v2/_assets/players/
  // processed/<slug>/`. The `_nobg` PNGs are the cleanly bg-stripped
  // variant the v2 overlays expect; non-overlay consumers (the
  // CadePlayerCard photo well, /players/[id]) read the same files.
  void variant; // reserved for `headshot` (no-suffix) variant in future
  const padded = String(effectivePose).padStart(2, "0");
  return `/overlays/v2/_assets/players/processed/${slug}/headshot_${padded}_nobg.png`;
}

/**
 * Convenience: small avatar URL (default pose, normal). Used by row-level
 * UIs (standings, fixture list, match-day admin). Honours
 * `DEFAULT_POSE_BY_SLUG` so banned poses are never shown anywhere on the
 * platform.
 */
export function getPlayerAvatarUrl(gamerTag: string | null | undefined): string | null {
  return getPlayerHeadshotUrl(gamerTag, "normal");
}

/** Test-only: list known slugs. Useful for sanity checks. */
export function knownPlayerSlugs(): string[] {
  return Object.keys(players);
}
