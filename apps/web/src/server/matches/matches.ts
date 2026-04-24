import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createMatchSchema,
  editMatchSchema,
  removeMatchSchema,
  type CreateMatchInput,
  type EditMatchInput,
  type RemoveMatchInput,
} from "./schemas";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";

export async function createMatch(
  sb: SupabaseClient,
  raw: CreateMatchInput
): Promise<{ id: string }> {
  const input = createMatchSchema.parse(raw);

  // Resolve season_id from the match_day row.
  const { data: md, error: mdErr } = await sb
    .from("match_days")
    .select("season_id")
    .eq("id", input.matchDayId)
    .is("deleted_at", null)
    .single();
  if (mdErr || !md) throw new Error(`match_day ${input.matchDayId} not found`);

  const { data, error } = await sb
    .from("matches")
    .insert({
      season_id: md.season_id,
      match_day_id: input.matchDayId,
      home_player_id: input.homePlayerId,
      away_player_id: input.awayPlayerId,
      scheduled_time: input.scheduledTime ?? null,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createMatch failed: ${error?.message ?? "no data"}`);
  return { id: data.id };
}

export async function editMatch(
  sb: SupabaseClient,
  raw: EditMatchInput
): Promise<void> {
  const input = editMatchSchema.parse(raw);
  const { error } = await sb
    .from("matches")
    .update({
      home_player_id: input.homePlayerId,
      away_player_id: input.awayPlayerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.matchId)
    .is("deleted_at", null);
  if (error) throw new Error(`editMatch failed: ${error.message}`);
}

export async function softDeleteMatch(
  sb: SupabaseClient,
  raw: RemoveMatchInput
): Promise<void> {
  const input = removeMatchSchema.parse(raw);
  const { error } = await sb
    .from("matches")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.matchId)
    .is("deleted_at", null);
  if (error) throw new Error(`softDeleteMatch failed: ${error.message}`);
}

export async function listByMatchDay(sb: SupabaseClient, matchDayId: string) {
  const { data, error } = await sb
    .from("matches")
    .select(
      `
      id, status, scheduled_time, notes, match_order,
      home_player:home_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( id, display_name ) ),
      away_player:away_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( id, display_name ) ),
      result:match_results ( id, home_score, away_score, result_type, confirmed_at, voided_by_action_id )
    `
    )
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .order("match_order", { ascending: true })
    .order("scheduled_time", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listByMatchDay failed: ${error.message}`);
  return data ?? [];
}

export async function voidMatch(sb: SupabaseClient, matchId: string): Promise<void> {
  const { error } = await sb.from("matches").update({ status: "voided" }).eq("id", matchId);
  if (error) throw new Error(`voidMatch failed: ${error.message}`);
}

/**
 * Plan 27 — atomically rewrite the `match_order` column for every fixture
 * inside a match day. Caller passes the full ordered list of match ids;
 * each entry receives `match_order = (index + 1)`. Idempotent — re-running
 * the same array yields the same DB state.
 *
 * Gated by `matches.edit` (same permission as add/edit/delete fixture).
 *
 * The update happens via N parallel updates rather than a single SQL CASE
 * because the Supabase JS client doesn't expose CASE expressions directly
 * and Plan 27's match-day cardinality is bounded (≤ 11 fixtures per day).
 * If perf becomes an issue, push this into a Postgres function later.
 */
export async function reorderMatches(
  sb: SupabaseClient,
  actor: Actor,
  matchDayId: string,
  orderedIds: readonly string[],
): Promise<void> {
  await requirePermAsync(sb, actor, "matches.edit");
  if (orderedIds.length === 0) return;
  // Reject duplicates so a programmer error surfaces instead of silently
  // re-ordering only the last reference.
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) {
      throw new Error(`reorderMatches: duplicate id ${id}`);
    }
    seen.add(id);
  }
  // Verify every id belongs to the same match day. Cheap select first.
  const { data: existing, error: selErr } = await sb
    .from("matches")
    .select("id")
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null);
  if (selErr) throw new Error(`reorderMatches verify failed: ${selErr.message}`);
  const dayIds = new Set((existing ?? []).map((r: { id: string }) => r.id));
  for (const id of orderedIds) {
    if (!dayIds.has(id)) {
      throw new Error(`reorderMatches: ${id} is not in match_day ${matchDayId}`);
    }
  }
  // Apply updates. Run sequentially so the audit trigger emits one row
  // per change in the order the admin saw the swap.
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const { error } = await sb
      .from("matches")
      .update({ match_order: i + 1, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) {
      throw new Error(`reorderMatches: update ${id} failed: ${error.message}`);
    }
  }
}
