import { getServerSupabase } from "@/lib/supabase/server";
import { listStandings } from "@/server/standings/read";
import { listSeasonMatchDays } from "@/server/standings/cutoff";
import { getActiveSeason } from "@/server/seasons";
import { PageHeader } from "@/components/public/PageHeader";
import { StandingsTable } from "@/components/public/StandingsTable";
import { EmptyState } from "@/components/public/EmptyState";
import { MatchDayPicker } from "@/components/public/MatchDayPicker";
import { StandingsLiveRefresh } from "@/components/public/StandingsLiveRefresh";

export const revalidate = 60;

export const metadata = { title: "Standings" };

export default async function StandingsPage() {
  const sb = await getServerSupabase();
  const season = await getActiveSeason(sb);
  const rows = season ? await listStandings(sb, season.id) : [];
  const mdItems = season ? await listSeasonMatchDays(sb, season.id) : [];

  const played = rows.reduce((sum, r) => sum + r.matches_played, 0) / 2;
  const totalGoals = rows.reduce((sum, r) => sum + r.goals_for, 0);

  return (
    <div>
      <StandingsLiveRefresh seasonId={season?.id ?? null} />
      <PageHeader
        eyebrow={season ? `${season.division_name} · ${season.year_range}` : "Standings"}
        title="League Table"
        description={
          season
            ? "Live standings for the active season. Updated within seconds of each confirmed scoreline."
            : "Standings will open once the active season begins."
        }
        right={
          rows.length > 0 ? (
            <div className="flex gap-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-4">
              <Metric label="Matches" value={played.toString()} />
              <span aria-hidden className="w-px bg-[var(--ink-4)]" />
              <Metric label="Goals" value={totalGoals.toString()} />
              <span aria-hidden className="w-px bg-[var(--ink-4)]" />
              <Metric label="Competitors" value={rows.length.toString()} />
            </div>
          ) : null
        }
      />

      <div className="mx-auto max-w-6xl px-5 py-10">
        <MatchDayPicker items={mdItems} activeMatchDayId={null} />
        {rows.length === 0 ? (
          <EmptyState
            title="No matches confirmed yet"
            hint="Standings populate the moment match day 1 results are signed off by the referee."
          />
        ) : (
          <StandingsTable rows={rows} />
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
