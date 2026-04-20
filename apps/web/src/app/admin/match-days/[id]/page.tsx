import { getServerSupabase } from "@/lib/supabase/server";
import { getMatchDay } from "@/server/matches/match-days";
import { listByMatchDay } from "@/server/matches/matches";
import { formatWat } from "@/lib/time";
import {
  addFixtureAction,
  confirmResultAction,
  editResultAction,
  enterResultAction,
} from "./actions";

export const dynamic = "force-dynamic";

type MatchRow = Awaited<ReturnType<typeof listByMatchDay>>[number];
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

export default async function MatchDayDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const matchDay = await getMatchDay(sb, id);
  const matches = (await listByMatchDay(sb, id)) as MatchRow[];

  const { data: players } = await sb
    .from("season_participants")
    .select(
      "player_id, player:player_id ( id, gamer_tag, users:user_id ( id, display_name ) )"
    )
    .eq("season_id", matchDay.season_id)
    .is("deleted_at", null);

  type ParticipantRow = {
    player_id: string;
    player: PlayerJoined | null;
  };

  const playerOptions = ((players ?? []) as unknown as ParticipantRow[]).map((p) => ({
    id: p.player_id,
    label: playerLabel(p.player),
  }));

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-bold">
          {formatWat(`${matchDay.match_date}T00:00:00Z`, "EEEE, MMMM d yyyy")}
        </h2>
        <p className="text-gray-600">
          {matchDay.venue_name} · arrival {matchDay.arrival_cutoff_time} · KO{" "}
          {matchDay.match_start_time}
        </p>
      </header>

      {/* Add fixture */}
      <section className="border rounded bg-white p-4 space-y-3">
        <h3 className="font-semibold">Add fixture</h3>
        <form action={addFixtureAction} className="grid grid-cols-5 gap-2 items-end">
          <input type="hidden" name="matchDayId" value={matchDay.id} />
          <label className="col-span-2">
            <span className="text-xs block">Home</span>
            <select
              name="homePlayerId"
              required
              className="w-full border rounded px-2 py-1"
              data-testid="add-home-select"
            >
              <option value="">—</option>
              {playerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2">
            <span className="text-xs block">Away</span>
            <select
              name="awayPlayerId"
              required
              className="w-full border rounded px-2 py-1"
              data-testid="add-away-select"
            >
              <option value="">—</option>
              {playerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="bg-black text-white rounded px-3 py-1.5 text-sm"
            data-testid="add-fixture-btn"
          >
            Add
          </button>
        </form>
      </section>

      {/* Fixture list */}
      <section className="space-y-3">
        <h3 className="font-semibold">Fixtures ({matches.length})</h3>
        {matches.length === 0 ? (
          <p className="text-gray-500">No fixtures yet.</p>
        ) : (
          <ul className="space-y-3">
            {matches.map((m) => {
              const result = firstOrNull(
                (m as unknown as { result: unknown }).result as
                  | {
                      id: string;
                      home_score: number;
                      away_score: number;
                      result_type: string;
                      confirmed_at: string | null;
                    }
                  | Array<{
                      id: string;
                      home_score: number;
                      away_score: number;
                      result_type: string;
                      confirmed_at: string | null;
                    }>
                  | null
              );
              const confirmed = !!result?.confirmed_at;
              const homePlayer = firstOrNull(
                (m as unknown as { home_player: PlayerJoined | PlayerJoined[] | null })
                  .home_player
              );
              const awayPlayer = firstOrNull(
                (m as unknown as { away_player: PlayerJoined | PlayerJoined[] | null })
                  .away_player
              );
              return (
                <li
                  key={m.id}
                  className="border rounded bg-white p-4"
                  data-testid={`fixture-${m.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{playerLabel(homePlayer)}</span>
                      <span className="px-2 text-gray-500">vs</span>
                      <span className="font-medium">{playerLabel(awayPlayer)}</span>
                    </div>
                    <span
                      className={
                        "text-xs px-2 py-1 rounded " +
                        (confirmed
                          ? "bg-green-100 text-green-800"
                          : result
                            ? "bg-amber-100 text-amber-800"
                            : "bg-gray-100 text-gray-700")
                      }
                    >
                      {confirmed ? "confirmed" : result ? "draft" : m.status}
                    </span>
                  </div>

                  <form
                    action={result ? editResultAction : enterResultAction}
                    className="mt-3 grid grid-cols-6 gap-2 items-end"
                    data-testid={`result-form-${m.id}`}
                  >
                    <input type="hidden" name="matchDayId" value={matchDay.id} />
                    <input type="hidden" name="matchId" value={m.id} />
                    <label>
                      <span className="text-xs block">Home score</span>
                      <input
                        name="homeScore"
                        type="number"
                        min={0}
                        defaultValue={result?.home_score ?? 0}
                        className="w-full border rounded px-2 py-1"
                      />
                    </label>
                    <label>
                      <span className="text-xs block">Away score</span>
                      <input
                        name="awayScore"
                        type="number"
                        min={0}
                        defaultValue={result?.away_score ?? 0}
                        className="w-full border rounded px-2 py-1"
                      />
                    </label>
                    <label>
                      <span className="text-xs block">Home poss %</span>
                      <input
                        name="homePossession"
                        type="number"
                        min={0}
                        max={100}
                        className="w-full border rounded px-2 py-1"
                      />
                    </label>
                    <label>
                      <span className="text-xs block">Away poss %</span>
                      <input
                        name="awayPossession"
                        type="number"
                        min={0}
                        max={100}
                        className="w-full border rounded px-2 py-1"
                      />
                    </label>
                    <label>
                      <span className="text-xs block">Type</span>
                      <select
                        name="resultType"
                        defaultValue={result?.result_type ?? "normal"}
                        className="w-full border rounded px-2 py-1"
                      >
                        <option value="normal">Normal</option>
                        <option value="forfeit">Forfeit (auto 3-0)</option>
                        <option value="void">Void</option>
                      </select>
                    </label>
                    <button
                      type="submit"
                      className="bg-black text-white rounded px-3 py-1.5 text-sm"
                      data-testid={`result-submit-${m.id}`}
                    >
                      {result ? "Update" : "Enter"}
                    </button>
                  </form>

                  {result && !confirmed ? (
                    <form action={confirmResultAction} className="mt-2">
                      <input type="hidden" name="matchDayId" value={matchDay.id} />
                      <input type="hidden" name="matchId" value={m.id} />
                      <button
                        type="submit"
                        className="bg-green-600 text-white rounded px-3 py-1.5 text-sm"
                        data-testid={`confirm-${m.id}`}
                      >
                        Confirm result
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
