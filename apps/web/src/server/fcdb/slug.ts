/**
 * Plan 21 — slug normalization. Must match the Python importer at
 * KNOWLEDGE/extracted/_fc26_import.py (`slugify`).
 *
 * Lowercase → diacritic-strip → non-alphanumeric runs → underscore. Trim
 * leading/trailing underscores. Used as the primary lookup key against
 * `fc26_players.slug`.
 */

export function stripDiacritics(input: string): string {
  // NFKD splits accented chars into base + combining marks; the regex drops
  // the combining marks, leaving the base char.
  return input.normalize("NFKD").replace(/\p{M}/gu, "");
}

export function slugify(name: string): string {
  if (!name) return "";
  const stripped = stripDiacritics(name).toLowerCase().trim();
  return stripped.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
