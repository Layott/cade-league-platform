/**
 * Plan 22 — derive a manifest slug from a display name.
 *
 * The processed-headshots manifest uses lowercase + underscore slugs
 * (`baji_jnr`, `killer_freak`, `mr_oga`). The DB doesn't carry the slug
 * directly so we derive it deterministically. Public copies live at
 * /players/<slug>/headshot_<NN>.png.
 *
 * Examples:
 *   "Adefola"      -> "adefola"
 *   "Baji Jnr"     -> "baji_jnr"
 *   "Killer Freak" -> "killer_freak"
 */
export function slugFromDisplayName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Public URL for a synced player headshot (Plan 22 sync script). */
export function publicHeadshotUrl(slug: string, pose = 1): string {
  const idx = String(pose).padStart(2, "0");
  return `/players/${slug}/headshot_${idx}.png`;
}
