import type { SupabaseClient } from "@supabase/supabase-js";

export type PrecedentRow = {
  player_id: string;
  category: string;
  offense_count: number;
  last_offense_at: string | null;
  last_case_id: string | null;
  updated_at: string;
};

/**
 * List every active precedent row for a player, highest-offense first.
 * Used by /admin/precedents/[playerId].
 */
export async function getPrecedents(
  sb: SupabaseClient,
  playerId: string,
): Promise<PrecedentRow[]> {
  const { data, error } = await sb
    .from("disciplinary_precedents")
    .select(
      "player_id, category, offense_count, last_offense_at, last_case_id, updated_at",
    )
    .eq("player_id", playerId)
    .is("deleted_at", null)
    .order("offense_count", { ascending: false });
  if (error) throw new Error(`getPrecedents: ${error.message}`);
  return (data ?? []) as PrecedentRow[];
}

/**
 * Cheap single-cell read. Returns 0 when no row exists. Callers in the
 * attendance ladder must NOT treat "no row" as an error.
 */
export async function getOffenseCount(
  sb: SupabaseClient,
  playerId: string,
  category: string,
): Promise<number> {
  const { data, error } = await sb
    .from("disciplinary_precedents")
    .select("offense_count")
    .eq("player_id", playerId)
    .eq("category", category)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getOffenseCount: ${error.message}`);
  return (data?.offense_count as number | undefined) ?? 0;
}
