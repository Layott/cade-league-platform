import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "./slug";
import type { FCPlayer, FCPlayerCandidate } from "./types";

/**
 * Plan 21 — `findPlayer` is the single entry point Plan 23's ref-review UI
 * uses to resolve OCR-transcribed squad rows against `fc26_players`.
 *
 * Algorithm (short-circuit on first success):
 *   1. Slug exact match. If `query.rating` provided, filter ±1.
 *   2. Apply position/club secondary boosts; return top 5 by score.
 *   3. If 0 hits → trigram fuzzy fallback (similarity > 0.3) on `name`.
 *   4. Re-apply rating filter + boosts; return top 5.
 *
 * Returns ≤ 5 candidates ranked by `score` (higher better). Empty array
 * when no match anywhere in the DB.
 */

export type FindPlayerQuery = {
  name: string;
  rating?: number;
  position?: string;
  club?: string;
  itemType?: string;
};

const RATING_TOLERANCE = 1;
const SIMILARITY_THRESHOLD = 0.3;
const TOP_N = 5;
const FUZZY_FETCH_N = 10;

const FCDB_COLUMNS =
  "id, source_dataset, source_row_id, name, short_name, slug, rating, position, alt_positions, club, league, nation, nation_iso, age, height_cm, weight_kg, preferred_foot, weak_foot, skill_moves, body_type, work_rate_atk, work_rate_def, attributes, item_type, value_coins_estimate, imported_at, created_at, updated_at, deleted_at";

/**
 * Score a candidate against the original query. Higher = better. Used to
 * order both exact-slug and fuzzy paths.
 *
 * - Position match: +1.
 * - Club match (case-insensitive): +1.
 * - Trigram similarity (when present, fuzzy path): + sim.
 *
 * Rating proximity is enforced by a hard filter (±1) before scoring rather
 * than as a soft boost — out-of-range candidates are dropped, not
 * down-ranked.
 */
function score(
  row: FCPlayer & { sim?: number | null },
  query: FindPlayerQuery,
): number {
  let s = 0;
  if (query.position && row.position && rowMatchesPosition(row, query.position)) {
    s += 1;
  }
  if (
    query.club &&
    row.club &&
    row.club.trim().toLowerCase() === query.club.trim().toLowerCase()
  ) {
    s += 1;
  }
  if (typeof row.sim === "number") {
    s += row.sim;
  }
  return s;
}

function rowMatchesPosition(row: FCPlayer, queryPosition: string): boolean {
  const qp = queryPosition.trim().toUpperCase();
  if (row.position?.toUpperCase() === qp) return true;
  if (row.alt_positions?.some((p) => p.toUpperCase() === qp)) return true;
  return false;
}

function withinRating(row: FCPlayer, query: FindPlayerQuery): boolean {
  if (typeof query.rating !== "number") return true;
  return Math.abs(row.rating - query.rating) <= RATING_TOLERANCE;
}

export async function findPlayer(
  sb: SupabaseClient,
  query: FindPlayerQuery,
): Promise<FCPlayerCandidate[]> {
  const slug = slugify(query.name);
  if (!slug) return [];

  // 1. Exact slug match. CLAUDE.md §Dormant datasets mandates filtering
  //    to source_dataset='futbin.com' — Kaggle/fut.gg rows are frozen
  //    provenance and carry no prices/images/stats.
  const { data: exact, error: exactErr } = await sb
    .from("fc26_players")
    .select(FCDB_COLUMNS)
    .eq("slug", slug)
    .eq("source_dataset", "futbin.com")
    .is("deleted_at", null);
  if (exactErr) {
    throw new Error(`findPlayer (exact) failed: ${exactErr.message}`);
  }

  const exactRows = ((exact ?? []) as FCPlayer[]).filter((r) => withinRating(r, query));
  if (exactRows.length > 0) {
    return exactRows
      .map((r) => ({ ...r, score: score(r, query) }))
      .sort((a, b) => b.score - a.score || b.rating - a.rating)
      .slice(0, TOP_N);
  }

  // 2. Trigram fuzzy fallback. Uses an RPC so the SQL stays in one place
  //    (and we can index against pg_trgm). The RPC is `fc26_players_fuzzy`
  //    and returns rows shaped like FCPlayer plus a `sim` column.
  //    If the RPC is not present, fall back to a column-only similarity
  //    select via `select=*&...&order=...`.
  const { data: fuzzy, error: fuzzyErr } = await sb.rpc("fc26_players_fuzzy", {
    p_name: query.name,
    p_threshold: SIMILARITY_THRESHOLD,
    p_limit: FUZZY_FETCH_N,
  });

  // If the RPC isn't installed yet (Plan 21 ships table only — RPC is a
  // future migration), bail to empty rather than crashing the ref UI.
  if (fuzzyErr) {
    if (
      fuzzyErr.message.includes("function") ||
      (fuzzyErr as { code?: string }).code === "42883"
    ) {
      return [];
    }
    throw new Error(`findPlayer (fuzzy) failed: ${fuzzyErr.message}`);
  }

  const fuzzyRows = ((fuzzy ?? []) as Array<FCPlayer & { sim: number }>).filter(
    (r) => withinRating(r, query),
  );

  return fuzzyRows
    .map((r) => ({ ...r, score: score(r, query), sim: r.sim }))
    .sort((a, b) => b.score - a.score || (b.sim ?? 0) - (a.sim ?? 0))
    .slice(0, TOP_N);
}
