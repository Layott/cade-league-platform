import { getActiveSeason } from "@/server/seasons";
import { resolveTabGate } from "../_components/helpers";
import {
  ResultsEntryForm,
  type MatchDayOption,
  type MatchOption,
} from "./ResultsEntryForm";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Plan 51 — Results Entry tab.
 *
 * Pulls every match-day's fixtures so the admin can pick any (not just
 * today's) and submit a score. The submit action revalidates + the DB
 * trigger fires standings recompute + Realtime publish.
 */
export default async function ResultsEntryPage() {
  const { svc } = await resolveTabGate("tournament.score_entry");
  const season = await getActiveSeason(svc);
  if (!season) {
    return (
      <section className="space-y-6" data-testid="tournament-tab-results-entry">
        <Empty />
      </section>
    );
  }

  // Bug 1 (2026-05-02): PostgREST embeds need explicit `matches.deleted_at`
  // filter — soft-deleted fixtures otherwise leak into this list.
  const { data: rawDays, error } = await svc
    .from("match_days")
    .select(
      `
      id, match_date, venue_name,
      matches:matches (
        id, scheduled_time, deleted_at,
        home:home_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) ),
        away:away_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) ),
        result:match_results ( id, result_type, home_score, away_score, notes )
      )
      `,
    )
    .eq("season_id", season.id)
    .is("deleted_at", null)
    .is("matches.deleted_at", null)
    .order("match_date", { ascending: true });

  if (error) {
    throw new Error(`results entry read failed: ${error.message}`);
  }

  type RawDay = {
    id: string;
    match_date: string | null;
    venue_name: string | null;
    matches: RawMatch[] | null;
  };
  type RawMatch = {
    id: string;
    scheduled_time: string | null;
    home: PlayerRef | PlayerRef[] | null;
    away: PlayerRef | PlayerRef[] | null;
    result:
      | {
          id: string;
          result_type: string | null;
          home_score: number | null;
          away_score: number | null;
          notes: string | null;
        }[]
      | {
          id: string;
          result_type: string | null;
          home_score: number | null;
          away_score: number | null;
          notes: string | null;
        }
      | null;
  };
  type PlayerRef = {
    id: string;
    gamer_tag: string;
    users: { display_name: string | null } | null;
  };

  const firstOrNull = <T,>(v: T | T[] | null | undefined): T | null => {
    if (!v) return null;
    if (Array.isArray(v)) return v[0] ?? null;
    return v;
  };

  const matchDays: MatchDayOption[] = ((rawDays ?? []) as unknown as RawDay[])
    .map((d) => {
      const matches: MatchOption[] = (d.matches ?? [])
        .map((m) => {
          const home = firstOrNull(m.home);
          const away = firstOrNull(m.away);
          const result = firstOrNull(m.result);
          const homeName =
            home?.users?.display_name ?? home?.gamer_tag ?? "TBD";
          const awayName =
            away?.users?.display_name ?? away?.gamer_tag ?? "TBD";
          const time = m.scheduled_time ? `${m.scheduled_time} · ` : "";
          return {
            id: m.id,
            label: `${time}${homeName} vs ${awayName}`,
            homeName,
            awayName,
            scheduledTime: m.scheduled_time,
            hasResult: !!result,
            existingHomeScore: result?.home_score ?? null,
            existingAwayScore: result?.away_score ?? null,
            existingResultType: result?.result_type ?? null,
            existingNotes: result?.notes ?? null,
          };
        })
        .sort((a, b) =>
          (a.scheduledTime ?? "99:99").localeCompare(
            b.scheduledTime ?? "99:99",
          ),
        );
      return {
        id: d.id,
        label: d.match_date
          ? `${formatWat(d.match_date, "EEE, dd MMM")} · ${d.venue_name ?? "TBD"}`
          : "Date TBD",
        matches,
      };
    })
    .filter((d) => d.matches.length > 0);

  const totalFixtures = matchDays.reduce((acc, d) => acc + d.matches.length, 0);
  const playedFixtures = matchDays.reduce(
    (acc, d) => acc + d.matches.filter((m) => m.hasResult).length,
    0,
  );

  return (
    <section className="space-y-5" data-testid="tournament-tab-results-entry">
      <header className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Score entry · {playedFixtures} / {totalFixtures} fixtures recorded
        </div>
        <p className="text-[12px] text-[var(--chalk-2)]">
          Pick a match-day, then a fixture, and submit the final score. Saving
          recomputes standings + publishes a Realtime event for live overlays.
        </p>
      </header>
      <ResultsEntryForm matchDays={matchDays} />
    </section>
  );
}

function Empty() {
  return (
    <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-12 text-center">
      <div className="font-display text-base text-[var(--chalk-1)]">
        No active season
      </div>
      <p className="mt-1 text-[12px] text-[var(--chalk-3)]">
        Once a season is started, fixtures land here for score entry.
      </p>
    </div>
  );
}
