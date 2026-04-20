import { getServerSupabase } from "@/lib/supabase/server";
import { listPlayersInActiveSeason } from "@/server/players";
import { getActiveSeason } from "@/server/seasons";
import { listStandings } from "@/server/standings/read";
import { PlayerCard, type PlayerCardStats } from "@/components/players/PlayerCard";
import { PageHeader } from "@/components/public/PageHeader";
import { EmptyState } from "@/components/public/EmptyState";

export const revalidate = 60;

export const metadata = { title: "Players" };

export default async function PlayersPage() {
  const sb = await getServerSupabase();
  const [season, players] = await Promise.all([
    getActiveSeason(sb),
    listPlayersInActiveSeason(sb),
  ]);

  const standingsRows = season ? await listStandings(sb, season.id) : [];
  const statsByPlayer = new Map<string, PlayerCardStats>();
  for (const r of standingsRows) {
    statsByPlayer.set(r.player_id, {
      matches_played: r.matches_played,
      points: r.points,
      goals_for: r.goals_for,
      goals_against: r.goals_against,
    });
  }

  return (
    <div>
      <PageHeader
        eyebrow={
          season
            ? `${season.division_name} · ${season.year_range}`
            : "Competitors"
        }
        title="The Roster"
        description="Thirteen confirmed competitors racing for the 2025–2026 crown. Tap a card for player profile, season stats, and discipline record."
        right={
          <div className="flex gap-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-4">
            <Metric label="Confirmed" value={players.length.toString()} />
            <span aria-hidden className="w-px bg-[var(--ink-4)]" />
            <Metric label="Division" value="1" sub="Elite" />
          </div>
        }
      />

      <div className="mx-auto max-w-6xl px-5 py-10">
        {players.length === 0 ? (
          <EmptyState
            title="No competitors confirmed yet"
            hint="Once the league office confirms the roster, player cards appear here."
          />
        ) : (
          <section
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="players-grid"
          >
            {players.map((p) => (
              <PlayerCard
                key={p.id}
                player={p}
                stats={statsByPlayer.get(p.id) ?? null}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col items-start">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </div>
      <div className="tabular mt-1 flex items-baseline gap-2 font-display text-2xl font-bold leading-none text-[var(--chalk-0)]">
        {value}
        {sub ? (
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--signal)]">
            {sub}
          </span>
        ) : null}
      </div>
    </div>
  );
}
