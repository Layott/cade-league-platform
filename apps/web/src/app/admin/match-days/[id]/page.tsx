import Link from "next/link";
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
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  FormField,
  inputClass,
  selectClass,
} from "@/components/admin/FormField";
import {
  PrimaryButton,
  SecondaryButton,
} from "@/components/admin/buttons";

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
    <div className="space-y-10">
      <SectionHeader
        eyebrow="Match day"
        title={formatWat(
          `${matchDay.match_date}T00:00:00Z`,
          "EEEE, MMMM d yyyy",
        )}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 text-xs uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            <span>{matchDay.venue_name}</span>
            <span className="text-[var(--ink-5)]">·</span>
            <span>
              Arrival{" "}
              <span className="text-[var(--chalk-1)] tabular">
                {String(matchDay.arrival_cutoff_time).slice(0, 5)}
              </span>
            </span>
            <span className="text-[var(--ink-5)]">·</span>
            <span>
              KO{" "}
              <span className="text-[var(--chalk-1)] tabular">
                {String(matchDay.match_start_time).slice(0, 5)}
              </span>
            </span>
            <StatusPill status={matchDay.status} className="ml-1" />
          </span>
        }
        action={
          <Link href={`/admin/match-days/${matchDay.id}/attendance`}>
            <SecondaryButton type="button">Attendance roster</SecondaryButton>
          </Link>
        }
      />

      {/* Add fixture */}
      <section
        aria-labelledby="add-fixture-heading"
        className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      >
        <h2
          id="add-fixture-heading"
          className="font-display text-base font-semibold text-[var(--chalk-0)]"
        >
          Add fixture
        </h2>
        <p className="mt-1 text-xs text-[var(--chalk-3)]">
          Pick two players from the active season roster.
        </p>
        <form
          action={addFixtureAction}
          className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
        >
          <input type="hidden" name="matchDayId" value={matchDay.id} />
          <FormField label="Home">
            <select
              name="homePlayerId"
              required
              className={selectClass}
              data-testid="add-home-select"
            >
              <option value="">—</option>
              {playerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Away">
            <select
              name="awayPlayerId"
              required
              className={selectClass}
              data-testid="add-away-select"
            >
              <option value="">—</option>
              {playerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </FormField>
          <PrimaryButton type="submit" data-testid="add-fixture-btn">
            Add
          </PrimaryButton>
        </form>
      </section>

      {/* Fixture list */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-bold text-[var(--chalk-0)]">
            Fixtures
          </h2>
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] tabular">
            {matches.length} total
          </span>
        </div>
        {matches.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-8 text-center text-sm text-[var(--chalk-3)]">
            No fixtures yet — draft them above.
          </div>
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
                  | null,
              );
              const confirmed = !!result?.confirmed_at;
              const homePlayer = firstOrNull(
                (
                  m as unknown as {
                    home_player: PlayerJoined | PlayerJoined[] | null;
                  }
                ).home_player,
              );
              const awayPlayer = firstOrNull(
                (
                  m as unknown as {
                    away_player: PlayerJoined | PlayerJoined[] | null;
                  }
                ).away_player,
              );
              const statusLabel = confirmed
                ? "confirmed"
                : result
                  ? "draft"
                  : m.status;
              return (
                <li
                  key={m.id}
                  className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
                  data-testid={`fixture-${m.id}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <PlayerChip label={playerLabel(homePlayer)} side="home" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                        vs
                      </span>
                      <PlayerChip label={playerLabel(awayPlayer)} side="away" />
                    </div>
                    <div className="flex items-center gap-3">
                      {result ? (
                        <span className="font-display text-2xl font-bold text-[var(--chalk-0)] tabular">
                          {result.home_score}
                          <span className="mx-1 text-[var(--ink-5)]">:</span>
                          {result.away_score}
                        </span>
                      ) : null}
                      <StatusPill status={statusLabel} />
                    </div>
                  </div>

                  <form
                    action={result ? editResultAction : enterResultAction}
                    className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6 md:items-end"
                    data-testid={`result-form-${m.id}`}
                  >
                    <input type="hidden" name="matchDayId" value={matchDay.id} />
                    <input type="hidden" name="matchId" value={m.id} />
                    <FormField label="Home score">
                      <input
                        name="homeScore"
                        type="number"
                        min={0}
                        defaultValue={result?.home_score ?? 0}
                        className={inputClass + " tabular"}
                      />
                    </FormField>
                    <FormField label="Away score">
                      <input
                        name="awayScore"
                        type="number"
                        min={0}
                        defaultValue={result?.away_score ?? 0}
                        className={inputClass + " tabular"}
                      />
                    </FormField>
                    <FormField label="Home poss %">
                      <input
                        name="homePossession"
                        type="number"
                        min={0}
                        max={100}
                        className={inputClass + " tabular"}
                      />
                    </FormField>
                    <FormField label="Away poss %">
                      <input
                        name="awayPossession"
                        type="number"
                        min={0}
                        max={100}
                        className={inputClass + " tabular"}
                      />
                    </FormField>
                    <FormField label="Type">
                      <select
                        name="resultType"
                        defaultValue={result?.result_type ?? "normal"}
                        className={selectClass}
                      >
                        <option value="normal">Normal</option>
                        <option value="forfeit">Forfeit (3-0)</option>
                        <option value="void">Void</option>
                      </select>
                    </FormField>
                    <div className="pt-[18px]">
                      <PrimaryButton
                        type="submit"
                        data-testid={`result-submit-${m.id}`}
                      >
                        {result ? "Update" : "Enter"}
                      </PrimaryButton>
                    </div>
                  </form>

                  {result && !confirmed ? (
                    <form
                      action={confirmResultAction}
                      className="mt-3 flex items-center justify-end"
                    >
                      <input
                        type="hidden"
                        name="matchDayId"
                        value={matchDay.id}
                      />
                      <input type="hidden" name="matchId" value={m.id} />
                      <PrimaryButton
                        type="submit"
                        data-testid={`confirm-${m.id}`}
                      >
                        Confirm result
                      </PrimaryButton>
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

function PlayerChip({
  label,
  side,
}: {
  label: string;
  side: "home" | "away";
}) {
  const initials = label
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden
        className={
          "flex h-9 w-9 items-center justify-center rounded-full border-2 font-display text-xs font-bold tabular " +
          (side === "home"
            ? "border-[var(--signal)] bg-[rgba(0,255,136,0.08)] text-[var(--signal)]"
            : "border-[var(--ink-5)] bg-[var(--ink-3)] text-[var(--chalk-1)]")
        }
      >
        {initials || "—"}
      </div>
      <span className="font-display text-base font-semibold text-[var(--chalk-0)]">
        {label}
      </span>
    </div>
  );
}
