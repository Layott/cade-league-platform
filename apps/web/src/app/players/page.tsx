import { getServerSupabase } from "@/lib/supabase/server";
import { listPlayersInActiveSeason } from "@/server/players";
import { getActiveSeason } from "@/server/seasons";
import { PlayerCard } from "@/components/players/PlayerCard";

export const revalidate = 60;

export default async function PlayersPage() {
  const sb = await getServerSupabase();
  const [season, players] = await Promise.all([
    getActiveSeason(sb),
    listPlayersInActiveSeason(sb),
  ]);

  return (
    <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      <header className="space-y-1">
        <p className="text-sm uppercase tracking-wide text-slate-500">
          {season ? `${season.division_name} · ${season.year_range}` : "Roster"}
        </p>
        <h1 className="text-3xl font-bold">Players</h1>
      </header>

      {players.length === 0 ? (
        <p className="text-slate-600" data-testid="players-empty">
          No players registered yet.
        </p>
      ) : (
        <section
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          data-testid="players-grid"
        >
          {players.map((p) => (
            <PlayerCard key={p.id} player={p} />
          ))}
        </section>
      )}
    </main>
  );
}
