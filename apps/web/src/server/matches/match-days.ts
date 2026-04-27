import type { SupabaseClient } from "@supabase/supabase-js";
import { createMatchDaySchema, type CreateMatchDayInput } from "./schemas";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";

export type MatchDaySummary = {
  id: string;
  season_id: string;
  match_date: string;
  venue_name: string;
  status: string;
  match_count: number;
  // Plan 27 — null when the LOC has not yet released this match day
  // to the public /fixtures page.
  published_at: string | null;
};

export async function createMatchDay(
  sb: SupabaseClient,
  raw: CreateMatchDayInput
): Promise<{ id: string }> {
  const input = createMatchDaySchema.parse(raw);

  const { data, error } = await sb
    .from("match_days")
    .insert({
      season_id: input.seasonId,
      match_date: input.matchDate,
      arrival_cutoff_time: input.arrivalCutoffTime,
      match_start_time: input.matchStartTime,
      venue_name: input.venueName,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`createMatchDay failed: ${error?.message ?? "no data"}`);
  }
  return { id: data.id };
}

export async function listMatchDays(
  sb: SupabaseClient,
  seasonId: string
): Promise<MatchDaySummary[]> {
  const { data, error } = await sb
    .from("match_days")
    .select(
      "id, season_id, match_date, venue_name, status, published_at, matches:matches(count)",
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("match_date", { ascending: false });
  if (error) throw new Error(`listMatchDays failed: ${error.message}`);
  return (data ?? []).map(
    (r: {
      id: string;
      season_id: string;
      match_date: string;
      venue_name: string;
      status: string;
      published_at: string | null;
      matches: { count: number }[] | null;
    }) => ({
      id: r.id,
      season_id: r.season_id,
      match_date: r.match_date,
      venue_name: r.venue_name,
      status: r.status,
      match_count: r.matches?.[0]?.count ?? 0,
      published_at: r.published_at ?? null,
    })
  );
}

/**
 * Plan 26 — variant of listMatchDays that also pulls every gamer_tag
 * appearing in any of that day's fixtures, so the admin /admin/match-days
 * search bar can client-filter by participant tag without a second roundtrip.
 */
export type MatchDaySummaryWithTags = MatchDaySummary & {
  player_tags: string[];
};

export async function listMatchDaysWithTags(
  sb: SupabaseClient,
  seasonId: string
): Promise<MatchDaySummaryWithTags[]> {
  const { data, error } = await sb
    .from("match_days")
    .select(
      `
      id, season_id, match_date, venue_name, status, published_at,
      matches:matches (
        id,
        home_player:home_player_id ( id, gamer_tag ),
        away_player:away_player_id ( id, gamer_tag )
      )
      `,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("match_date", { ascending: false });
  if (error) throw new Error(`listMatchDaysWithTags failed: ${error.message}`);

  type MatchRow = {
    id: string;
    home_player: { id: string; gamer_tag: string }[] | { id: string; gamer_tag: string } | null;
    away_player: { id: string; gamer_tag: string }[] | { id: string; gamer_tag: string } | null;
  };
  type Row = {
    id: string;
    season_id: string;
    match_date: string;
    venue_name: string;
    status: string;
    published_at: string | null;
    matches: MatchRow[] | null;
  };

  const firstOrNull = <T>(v: T | T[] | null | undefined): T | null => {
    if (!v) return null;
    if (Array.isArray(v)) return v[0] ?? null;
    return v;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => {
    const tagSet = new Set<string>();
    for (const m of r.matches ?? []) {
      const h = firstOrNull(m.home_player);
      const a = firstOrNull(m.away_player);
      if (h?.gamer_tag) tagSet.add(h.gamer_tag);
      if (a?.gamer_tag) tagSet.add(a.gamer_tag);
    }
    return {
      id: r.id,
      season_id: r.season_id,
      match_date: r.match_date,
      venue_name: r.venue_name,
      status: r.status,
      match_count: r.matches?.length ?? 0,
      published_at: r.published_at ?? null,
      player_tags: [...tagSet].sort(),
    };
  });
}

export async function getMatchDay(sb: SupabaseClient, id: string) {
  const { data, error } = await sb
    .from("match_days")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !data) throw new Error(`match_day ${id} not found`);
  return data;
}

/**
 * Plan 27 — publish a match day so the public /fixtures page surfaces it.
 * Gated by the `match_days.publish` permission (admin via wildcard, loc
 * explicitly seeded). Sets `published_at = now()`. Idempotent: re-publishing
 * an already-published day is a no-op (timestamp does not move).
 */
export async function publishMatchDay(
  sb: SupabaseClient,
  actor: Actor,
  id: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "match_days.publish");
  const { error } = await sb
    .from("match_days")
    .update({ published_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .is("published_at", null);
  if (error) throw new Error(`publishMatchDay failed: ${error.message}`);
}

/**
 * Plan 27 — unpublish a match day, hiding it from the public /fixtures
 * page until republished. Same permission as publish. Clears `published_at`.
 * Idempotent: unpublishing an already-unpublished day is a no-op.
 */
export async function unpublishMatchDay(
  sb: SupabaseClient,
  actor: Actor,
  id: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "match_days.publish");
  const { error } = await sb
    .from("match_days")
    .update({ published_at: null })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(`unpublishMatchDay failed: ${error.message}`);
}

/**
 * Transition a match day's status to `completed` so the public homepage
 * "Upcoming match day" card stops surfacing it and the public fixtures
 * page renders the final-score badge. Re-uses the `match_days.publish`
 * permission (same role set: admin + loc).
 *
 * Status values match the DB check constraint:
 *   ('scheduled','in_progress','completed','cancelled')
 */
export async function setMatchDayStatus(
  sb: SupabaseClient,
  actor: Actor,
  id: string,
  status: "scheduled" | "in_progress" | "completed" | "cancelled",
): Promise<void> {
  await requirePermAsync(sb, actor, "match_days.publish");
  const { error } = await sb
    .from("match_days")
    .update({ status })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw new Error(`setMatchDayStatus failed: ${error.message}`);
}
