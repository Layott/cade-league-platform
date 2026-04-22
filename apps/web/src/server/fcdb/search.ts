import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { slugify } from "./slug";
import type { FCPlayer } from "./types";

/**
 * Plan 30 — typeahead search for the Futbin-style squad picker.
 *
 * Thin wrapper around Plan 21's `fc26_players_fuzzy` RPC, with an exact-slug
 * shortcut for performance. Unlike `findPlayer` (Plan 21), the ref-review
 * lookup, `searchCards` is UI-facing:
 *   - No rating filter (user hasn't typed a rating)
 *   - Position filter is a soft boost, not a hard gate — slot "RB" should
 *     still match "CB" cards so a versatile defender shows up
 *   - Returns a compact projection shaped for the picker tile (FutCard)
 *
 * Graceful empty-table: returns `[]` rather than throwing. The UI shows a
 * "No matches — ask admin to import catalogue" banner.
 */

export const searchCardsInputSchema = z.object({
  q: z.string().trim().min(2).max(40),
  position: z.string().trim().min(1).max(8).optional(),
  limit: z.number().int().min(1).max(25).default(10),
});

export type SearchCardsInput = z.infer<typeof searchCardsInputSchema>;

export type CardSearchResult = {
  id: string;
  name: string;
  rating: number;
  position: string;
  positionsAlt: string[];
  club: string | null;
  league: string | null;
  nation: string | null;
  nationIso: string | null;
  itemType: string;
  priceCoins: number | null;
  cardImageUrl: string | null;
};

const FUZZY_THRESHOLD = 0.2;
const SELECT_COLUMNS =
  "id, name, rating, position, alt_positions, club, league, nation, nation_iso, item_type, value_coins_estimate";

function projectRow(row: FCPlayer & { sim?: number }): CardSearchResult {
  return {
    id: row.id,
    name: row.name,
    rating: row.rating,
    position: row.position,
    positionsAlt: row.alt_positions ?? [],
    club: row.club,
    league: row.league,
    nation: row.nation,
    nationIso: row.nation_iso,
    itemType: row.item_type,
    // Plan 30 §3.5: the fc26_players table ships `value_coins_estimate`; a
    // later Plan 24 "price refresh" job may introduce a denormalised
    // `price_coins` column. Until then we mirror the estimate.
    priceCoins: row.value_coins_estimate,
    // No card_image_url in the schema yet — picker falls back to an avatar.
    cardImageUrl: null,
  };
}

function scoreRow(row: CardSearchResult, positionFilter?: string): number {
  if (!positionFilter) return 0;
  const qp = positionFilter.trim().toUpperCase();
  if (!qp) return 0;
  if (row.position.toUpperCase() === qp) return 2;
  if (row.positionsAlt.some((p) => p.toUpperCase() === qp)) return 1;
  return 0;
}

/**
 * Typeahead search. See module docstring for semantics. Returns up to
 * `limit` cards ranked (primary) by trigram similarity, (secondary) by
 * position-filter score, (tertiary) by rating desc.
 */
export async function searchCards(
  sb: SupabaseClient,
  input: SearchCardsInput,
): Promise<CardSearchResult[]> {
  const parsed = searchCardsInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "invalid search input");
  }
  const v = parsed.data;

  const slug = slugify(v.q);

  // 1. Exact slug pre-check. Cheap and a fast path for "Mbappe" typed out.
  if (slug) {
    const { data: exact, error: exactErr } = await sb
      .from("fc26_players")
      .select(SELECT_COLUMNS)
      .eq("slug", slug)
      .is("deleted_at", null)
      .limit(v.limit);
    if (exactErr) {
      // Short-circuit on a schema-less / empty DB rather than breaking the UI.
      return [];
    }
    const rows = (exact ?? []) as FCPlayer[];
    if (rows.length > 0) {
      const projected = rows.map(projectRow);
      projected.sort(
        (a, b) =>
          scoreRow(b, v.position) - scoreRow(a, v.position) ||
          b.rating - a.rating,
      );
      return projected.slice(0, v.limit);
    }
  }

  // 2. Trigram fuzzy RPC. Graceful fallback when the RPC is missing
  //    (pre-migration dev DB) or returns an error.
  const { data: fuzzy, error: fuzzyErr } = await sb.rpc("fc26_players_fuzzy", {
    p_name: v.q,
    p_threshold: FUZZY_THRESHOLD,
    p_limit: v.limit * 2,
  });
  if (fuzzyErr) {
    // 42883 = "function does not exist" — pre-Plan 21 migration state.
    return [];
  }

  const fuzzyRows = ((fuzzy ?? []) as Array<FCPlayer & { sim: number }>).map((r) => ({
    ...projectRow(r),
    sim: r.sim,
  }));

  fuzzyRows.sort(
    (a, b) =>
      scoreRow(b, v.position) - scoreRow(a, v.position) ||
      (b.sim ?? 0) - (a.sim ?? 0) ||
      b.rating - a.rating,
  );

  return fuzzyRows.slice(0, v.limit).map((row) => {
    // Strip the `sim` key before handing to callers — it's an internal
    // ranking signal only.
    const rest: CardSearchResult = {
      id: row.id,
      name: row.name,
      rating: row.rating,
      position: row.position,
      positionsAlt: row.positionsAlt,
      club: row.club,
      league: row.league,
      nation: row.nation,
      nationIso: row.nationIso,
      itemType: row.itemType,
      priceCoins: row.priceCoins,
      cardImageUrl: row.cardImageUrl,
    };
    return rest;
  });
}
