import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";

export const revalidate = 60; // ISR: 60s

type PlayerJoined = {
  id: string;
  gamer_tag: string;
  users: { id: string; display_name: string | null } | null;
};

function playerLabel(p: PlayerJoined | null | undefined): string {
  if (!p) return "?";
  return p.users?.display_name ?? p.gamer_tag ?? "?";
}

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

export default async function FixturesPage() {
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

  const { data: days } = await sb
    .from("match_days")
    .select(
      `
      id, match_date, venue_name, match_start_time, status,
      matches:matches (
        id, status,
        home_player:home_player_id ( id, gamer_tag, users:user_id ( id, display_name ) ),
        away_player:away_player_id ( id, gamer_tag, users:user_id ( id, display_name ) ),
        result:match_results ( home_score, away_score, confirmed_at, result_type )
      )
    `
    )
    .eq("season_id", season.id)
    .is("deleted_at", null)
    .order("match_date", { ascending: true });

  type DayRow = {
    id: string;
    match_date: string;
    venue_name: string;
    match_start_time: string;
    status: string;
    matches: Array<{
      id: string;
      status: string;
      home_player: PlayerJoined | PlayerJoined[] | null;
      away_player: PlayerJoined | PlayerJoined[] | null;
      result:
        | Array<{
            home_score: number;
            away_score: number;
            confirmed_at: string | null;
            result_type: string;
          }>
        | {
            home_score: number;
            away_score: number;
            confirmed_at: string | null;
            result_type: string;
          }
        | null;
    }> | null;
  };

  const rows = ((days ?? []) as unknown as DayRow[]) ?? [];

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Fixtures · {season.year_range}</h1>
      {rows.map((d) => (
        <section key={d.id} className="border rounded bg-white p-4 space-y-2">
          <div className="flex justify-between">
            <h2 className="font-semibold">
              {formatWat(`${d.match_date}T00:00:00Z`, "EEE, MMM d yyyy")} · {d.venue_name}
            </h2>
            <span className="text-xs text-gray-500">KO {d.match_start_time}</span>
          </div>
          <ul className="divide-y">
            {(d.matches ?? []).map((m) => {
              const r = firstOrNull(m.result);
              const showScore = r && r.confirmed_at && r.result_type !== "void";
              const home = firstOrNull(m.home_player);
              const away = firstOrNull(m.away_player);
              return (
                <li key={m.id} className="py-2 flex justify-between">
                  <span>
                    {playerLabel(home)} vs {playerLabel(away)}
                  </span>
                  <span className="font-mono">
                    {showScore ? `${r.home_score} - ${r.away_score}` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
