import { getServerSupabase } from "@/lib/supabase/server";
import { getActiveSeason } from "@/server/seasons";
import { PageHeader } from "@/components/public/PageHeader";
import { EmptyState } from "@/components/public/EmptyState";
import {
  FixtureList,
  type FixtureGroup,
  type FixtureRow,
} from "@/components/public/FixtureList";

export const revalidate = 60;

export const metadata = { title: "Fixtures" };

type PlayerJoin = {
  id: string;
  gamer_tag: string;
  jersey_number: number | null;
  users: { id: string; display_name: string | null } | null;
};

type ResultJoin = {
  home_score: number;
  away_score: number;
  confirmed_at: string | null;
  result_type: string;
};

type MatchJoin = {
  id: string;
  status: string;
  scheduled_time: string | null;
  home_player: PlayerJoin | PlayerJoin[] | null;
  away_player: PlayerJoin | PlayerJoin[] | null;
  result: ResultJoin | ResultJoin[] | null;
};

type MatchDayJoin = {
  id: string;
  match_date: string;
  venue_name: string | null;
  match_start_time: string;
  arrival_cutoff_time: string;
  status: string;
  matches: MatchJoin[] | null;
};

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

function playerName(p: PlayerJoin | null): string {
  if (!p) return "TBD";
  return p.users?.display_name ?? p.gamer_tag ?? "TBD";
}

function playerTag(p: PlayerJoin | null): string {
  return p?.gamer_tag ?? "";
}

export default async function FixturesPage() {
  const sb = await getServerSupabase();
  const season = await getActiveSeason(sb);

  const groups: FixtureGroup[] = [];
  if (season) {
    const { data } = await sb
      .from("match_days")
      .select(
        `
        id, match_date, venue_name, match_start_time, arrival_cutoff_time, status,
        matches:matches (
          id, status, scheduled_time,
          home_player:home_player_id ( id, gamer_tag, jersey_number, users:users!players_user_id_fkey ( id, display_name ) ),
          away_player:away_player_id ( id, gamer_tag, jersey_number, users:users!players_user_id_fkey ( id, display_name ) ),
          result:match_results ( home_score, away_score, confirmed_at, result_type )
        )
        `,
      )
      .eq("season_id", season.id)
      .is("deleted_at", null)
      .order("match_date", { ascending: true });

    for (const md of ((data ?? []) as unknown as MatchDayJoin[])) {
      const fixtures: FixtureRow[] = (md.matches ?? [])
        .filter((m) => m != null)
        .map((m) => {
          const home = firstOrNull(m.home_player);
          const away = firstOrNull(m.away_player);
          const r = firstOrNull(m.result);
          const scoreShown = r && r.confirmed_at && r.result_type !== "void";
          return {
            id: m.id,
            scheduled_time: m.scheduled_time,
            status: m.status,
            home_name: playerName(home),
            home_tag: playerTag(home),
            home_jersey: home?.jersey_number ?? null,
            away_name: playerName(away),
            away_tag: playerTag(away),
            away_jersey: away?.jersey_number ?? null,
            home_score: scoreShown ? r.home_score : null,
            away_score: scoreShown ? r.away_score : null,
            result_type: r?.result_type ?? null,
            confirmed_at: r?.confirmed_at ?? null,
          } satisfies FixtureRow;
        })
        .sort((a, b) => {
          const at = a.scheduled_time ?? "";
          const bt = b.scheduled_time ?? "";
          return at.localeCompare(bt);
        });
      groups.push({
        id: md.id,
        match_date: md.match_date,
        match_start_time: md.match_start_time,
        arrival_cutoff_time: md.arrival_cutoff_time,
        venue_name: md.venue_name,
        status: md.status,
        fixtures,
      });
    }
  }

  const totalMatches = groups.reduce((n, g) => n + g.fixtures.length, 0);

  return (
    <div>
      <PageHeader
        eyebrow={season ? `${season.division_name} · ${season.year_range}` : "Fixtures"}
        title="Match Days"
        description={
          season
            ? "Every scheduled match day for the active season, with arrival cutoffs and confirmed scorelines."
            : "Fixture releases will appear here once the season is scheduled."
        }
        right={
          groups.length > 0 ? (
            <div className="flex gap-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-4">
              <Metric label="Match days" value={groups.length.toString()} />
              <span aria-hidden className="w-px bg-[var(--ink-4)]" />
              <Metric label="Fixtures" value={totalMatches.toString()} />
            </div>
          ) : null
        }
      />

      <div className="mx-auto max-w-6xl px-5 py-10">
        {groups.length === 0 ? (
          <EmptyState
            title="Schedule drop pending"
            hint="The league office publishes fixture releases ahead of each match day — check back here when the call goes out."
          />
        ) : (
          <FixtureList groups={groups} />
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </div>
      <div className="tabular mt-1 font-display text-2xl font-bold leading-none text-[var(--chalk-0)]">
        {value}
      </div>
    </div>
  );
}
