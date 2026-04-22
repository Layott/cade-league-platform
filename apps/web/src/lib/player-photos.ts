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
 * Plan 22 deposited transparent-background headshots at
 * `public/players/<slug>/headshot_<NN>.png`. The accompanying manifest
 * also references a `*_nobg.png` sibling that was processed separately
 * and is NOT shipped in /public — so the `transparent` variant resolves
 * to the same file as `normal` (the existing headshot is already
 * transparent). Once the bg-stripped pipeline is shipped, this helper
 * will start preferring the `_nobg` filename when present in the
 * manifest pose entry.
 *
 * Returns null when the slug isn't in the manifest or the requested pose
 * doesn't exist. Caller falls back to initials.
 */
export function getPlayerHeadshotUrl(
  gamerTag: string | null | undefined,
  variant: PlayerPhotoVariant = "normal",
  poseIndex: number = 1,
): string | null {
  if (!gamerTag) return null;
  const slug = gamerTagToSlug(gamerTag);
  if (!slug) return null;
  const entry = players[slug];
  if (!entry) return null;
  const pose = entry.poses.find((p) => p.pose_index === poseIndex);
  if (!pose) return null;
  // Plan 22 ships only the `headshot_<NN>.png` family in /public — these
  // PNGs are already transparent, suitable for both backgrounded and
  // composed contexts (CadePlayerCard photo well). The manifest mentions a
  // `_nobg` sibling but the bg-stripped pipeline output isn't deployed
  // yet. Resolve both `normal` and `transparent` to the same filename so
  // referenced URLs always resolve to a real file in /public.
  void variant; // reserved for future _nobg preference
  const rel = pose.variants.headshot;
  if (!rel) return null;
  return `/players/${rel}`;
}

/**
 * Convenience: small avatar URL (pose 01, normal). Used by row-level UIs
 * (standings, fixture list, match-day admin). Same fallback semantics.
 */
export function getPlayerAvatarUrl(gamerTag: string | null | undefined): string | null {
  return getPlayerHeadshotUrl(gamerTag, "normal", 1);
}

/** Test-only: list known slugs. Useful for sanity checks. */
export function knownPlayerSlugs(): string[] {
  return Object.keys(players);
}
