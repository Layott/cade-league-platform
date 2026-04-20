import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveSeason, type Season } from "@/server/seasons";
import { listStandings, type StandingsRow } from "@/server/standings/read";

export type HomeMatchDay = {
  id: string;
  match_date: string;
  arrival_cutoff_time: string;
  match_start_time: string;
  venue_name: string | null;
  fixture_count: number;
};

export type HomeAnnouncement = {
  id: string;
  title: string;
  body_md: string;
  priority: "info" | "important" | "urgent" | string;
  published_at: string;
};

export type HomepageData = {
  season: Season | null;
  topStandings: StandingsRow[];
  nextMatchDay: HomeMatchDay | null;
  announcements: HomeAnnouncement[];
};

/**
 * Fetch everything the public homepage renders in parallel. Each query
 * filters `deleted_at IS NULL` so soft-deleted rows never leak into the
 * landing experience.
 */
export async function getHomepageData(
  sb: SupabaseClient,
): Promise<HomepageData> {
  const today = new Date().toISOString().slice(0, 10);

  const [season, announcementsRes, matchDayRes] = await Promise.all([
    getActiveSeason(sb),
    sb
      .from("announcements")
      .select("id, title, body_md, priority, published_at")
      .eq("is_public", true)
      .is("deleted_at", null)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(3),
    sb
      .from("match_days")
      .select(
        "id, match_date, arrival_cutoff_time, match_start_time, venue_name, matches:matches(count)",
      )
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .gte("match_date", today)
      .order("match_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const topStandings = season ? (await listStandings(sb, season.id)).slice(0, 3) : [];

  let nextMatchDay: HomeMatchDay | null = null;
  if (matchDayRes.data) {
    const md = matchDayRes.data as {
      id: string;
      match_date: string;
      arrival_cutoff_time: string;
      match_start_time: string;
      venue_name: string | null;
      matches: { count: number }[] | null;
    };
    nextMatchDay = {
      id: md.id,
      match_date: md.match_date,
      arrival_cutoff_time: md.arrival_cutoff_time,
      match_start_time: md.match_start_time,
      venue_name: md.venue_name,
      fixture_count: md.matches?.[0]?.count ?? 0,
    };
  }

  const announcements = ((announcementsRes.data ?? []) as HomeAnnouncement[]).map(
    (a) => ({
      id: a.id,
      title: a.title,
      body_md: a.body_md,
      priority: a.priority,
      published_at: a.published_at,
    }),
  );

  return {
    season,
    topStandings,
    nextMatchDay,
    announcements,
  };
}
