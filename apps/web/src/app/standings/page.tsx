import { getServerSupabase } from "@/lib/supabase/server";
import { listStandings } from "@/server/standings/read";

export const revalidate = 60; // ISR: 60s

export default async function StandingsPage() {
  const sb = await getServerSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (!season) {
    return (
      <main className="p-8">
        <p>No active season.</p>
      </main>
    );
  }

  const rows = await listStandings(sb, season.id);

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-4">
      <h1 className="text-3xl font-bold">Standings · {season.year_range}</h1>
      <table className="w-full text-sm border bg-white">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2 w-8">#</th>
            <th className="text-left p-2">Player</th>
            <th className="text-right p-2">MP</th>
            <th className="text-right p-2">W</th>
            <th className="text-right p-2">D</th>
            <th className="text-right p-2">L</th>
            <th className="text-right p-2">GF</th>
            <th className="text-right p-2">GA</th>
            <th className="text-right p-2">GD</th>
            <th className="text-right p-2 font-bold">Pts</th>
          </tr>
        </thead>
        <tbody data-testid="standings-body">
          {rows.map((r, i) => (
            <tr key={r.player_id} className="border-t">
              <td className="p-2">{i + 1}</td>
              <td className="p-2">{r.player_name}</td>
              <td className="p-2 text-right">{r.matches_played}</td>
              <td className="p-2 text-right">{r.wins}</td>
              <td className="p-2 text-right">{r.draws}</td>
              <td className="p-2 text-right">{r.losses}</td>
              <td className="p-2 text-right">{r.goals_for}</td>
              <td className="p-2 text-right">{r.goals_against}</td>
              <td className="p-2 text-right">{r.goal_difference}</td>
              <td className="p-2 text-right font-bold">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-500">
        Tiebreakers: points → goal difference → goals for.
      </p>
    </main>
  );
}
