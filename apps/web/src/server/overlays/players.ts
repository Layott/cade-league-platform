/**
 * Plan 16 — player photo URL resolver.
 *
 * Reads the processed-photos manifest committed under this folder and
 * exposes lookup helpers keyed by player slug. The manifest is produced
 * by `KNOWLEDGE/brand-assets/players/_process.py`; every pose has three
 * crop variants (headshot / card / fullbody) in either `_normal` or
 * `_nobg` treatment.
 *
 * Public URL convention: `/brand/players/<slug>/<variant>_<pose>.png`.
 * Callers should fall back to initials when `resolvePlayerPhotoUrl`
 * returns null.
 */
import manifestJson from "./players-manifest.json";

type PoseVariants = {
  headshot?: string;
  headshot_nobg?: string;
  card?: string;
  card_nobg?: string;
  fullbody?: string;
  fullbody_nobg?: string;
};

type PoseEntry = {
  pose_index: number;
  source: string;
  source_resolution: string;
  variants: PoseVariants;
  face_detected?: boolean;
};

type PlayerEntry = {
  display_name: string;
  pose_count: number;
  poses: PoseEntry[];
};

type Manifest = {
  generated_at: string;
  source_dir: string;
  output_dir: string;
  players: Record<string, PlayerEntry>;
};

const MANIFEST = manifestJson as Manifest;

export type PlayerVariant = "headshot" | "card" | "fullbody";

export type ResolvePhotoOptions = {
  /** Prefer `_nobg` (transparent background) if available. */
  preferNoBg?: boolean;
  /** Pose index (1-based). Defaults to the first pose. */
  pose?: number;
};

/**
 * Returns a web-rooted URL to the requested variant, or null if the
 * slug is missing from the manifest.
 */
export function resolvePlayerPhotoUrl(
  slug: string,
  variant: PlayerVariant = "headshot",
  opts: ResolvePhotoOptions = {},
): string | null {
  const player = MANIFEST.players[slug];
  if (!player || !player.poses.length) return null;

  const pose =
    (opts.pose != null
      ? player.poses.find((p) => p.pose_index === opts.pose)
      : undefined) ?? player.poses[0];

  const key = opts.preferNoBg ? `${variant}_nobg` : variant;
  const rel =
    (pose.variants as Record<string, string | undefined>)[key] ??
    (pose.variants as Record<string, string | undefined>)[variant] ??
    null;
  if (!rel) return null;

  // rel is like "adefola/headshot_01.png" — we publish processed PNGs
  // under /brand/players. The public copy is optional (missing during
  // early agent runs); callers still get a stable URL string.
  return `/brand/players/${rel.replaceAll("\\", "/")}`;
}

/** List available player slugs (stable sort). */
export function listPlayerSlugs(): string[] {
  return Object.keys(MANIFEST.players).sort();
}

/** Map slug → display name. */
export function getPlayerDisplayName(slug: string): string | null {
  return MANIFEST.players[slug]?.display_name ?? null;
}

export const PLAYER_MANIFEST_META = {
  generatedAt: MANIFEST.generated_at,
  playerCount: Object.keys(MANIFEST.players).length,
} as const;
