import Image from "next/image";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getMatchDay } from "@/server/matches/match-days";
import { listByMatchDay } from "@/server/matches/matches";
import { formatWat } from "@/lib/time";
import { getPlayerAvatarUrl } from "@/lib/player-photos";
import {
  addFixtureAction,
  confirmResultAction,
  editResultAction,
  editMatchAction,
  enterResultAction,
  markMatchDayCompleteAction,
  publishMatchDayAction,
  removeMatchAction,
  reopenMatchDayAction,
  reorderMatchAction,
  setMatchSlotLanesAction,
  unpublishMatchDayAction,
  unvoidMatchAction,
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
  DangerButton,
} from "@/components/admin/buttons";
import {
  SlotLaneDragBoard,
  type FixtureChip,
} from "@/components/admin/SlotLaneDragBoard";

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
      "player_id, player:player_id ( id, gamer_tag, users:users!players_user_id_fkey ( id, display_name ) )"
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
            {/* Plan 27 — published / draft visibility on the public Fixtures page */}
            <StatusPill
              status={matchDay.published_at ? "published" : "draft"}
              className="ml-1"
              data-testid="md-publish-pill"
            />
            {matchDay.published_at ? (
              <span className="text-[var(--chalk-3)] normal-case tracking-normal">
                Released{" "}
                <span className="text-[var(--chalk-1)] tabular">
                  {formatWat(matchDay.published_at, "MMM d, HH:mm")}
                </span>
              </span>
            ) : null}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {matchDay.published_at ? (
              <form action={unpublishMatchDayAction}>
                <input type="hidden" name="matchDayId" value={matchDay.id} />
                <SecondaryButton type="submit" data-testid="unpublish-md-btn">
                  Unpublish
                </SecondaryButton>
              </form>
            ) : (
              <form action={publishMatchDayAction}>
                <input type="hidden" name="matchDayId" value={matchDay.id} />
                <PrimaryButton type="submit" data-testid="publish-md-btn">
                  Publish to players
                </PrimaryButton>
              </form>
            )}
            {matchDay.status === "completed" ? (
              <form action={reopenMatchDayAction}>
                <input type="hidden" name="matchDayId" value={matchDay.id} />
                <SecondaryButton type="submit" data-testid="reopen-md-btn">
                  Reopen match day
                </SecondaryButton>
              </form>
            ) : (
              <form action={markMatchDayCompleteAction}>
                <input type="hidden" name="matchDayId" value={matchDay.id} />
                <PrimaryButton type="submit" data-testid="complete-md-btn">
                  Mark complete
                </PrimaryButton>
              </form>
            )}
            <Link href={`/admin/match-days/${matchDay.id}/attendance`}>
              <SecondaryButton type="button">Attendance roster</SecondaryButton>
            </Link>
          </div>
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

        {/* 2026-05-10 — drag-and-drop slot/lane assigner. Replaces the
            inline number/select inputs with a visual board so producers
            can drag fixtures into the cell where they belong. The
            component serialises its state into FormData and posts via
            setMatchSlotLanesAction (same server action as before). */}
        {matches.length > 0 ? (
          <SlotLaneDragBoard
            matchDayId={matchDay.id}
            fixtures={matches.map((m): FixtureChip => {
              const homePlayer = firstOrNull(
                (m as unknown as { home_player: PlayerJoined | PlayerJoined[] | null }).home_player,
              );
              const awayPlayer = firstOrNull(
                (m as unknown as { away_player: PlayerJoined | PlayerJoined[] | null }).away_player,
              );
              const slotRaw = (m as { match_slot?: number | null }).match_slot ?? null;
              const laneRaw = (m as { match_lane?: string | null }).match_lane ?? null;
              const lane =
                laneRaw === "primary" || laneRaw === "secondary" ? laneRaw : null;
              return {
                matchId: m.id,
                homeLabel: playerLabel(homePlayer),
                awayLabel: playerLabel(awayPlayer),
                initialSlot: typeof slotRaw === "number" ? slotRaw : null,
                initialLane: lane,
              };
            })}
            saveAction={setMatchSlotLanesAction}
          />
        ) : null}

        {matches.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-8 text-center text-sm text-[var(--chalk-3)]">
            No fixtures yet — draft them above.
          </div>
        ) : (
          <ul className="space-y-3">
            {matches.map((m, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === matches.length - 1;
              const result = firstOrNull(
                (m as unknown as { result: unknown }).result as
                  | {
                      id: string;
                      home_score: number;
                      away_score: number;
                      result_type: string;
                      confirmed_at: string | null;
                      voided_by_action_id: string | null;
                    }
                  | Array<{
                      id: string;
                      home_score: number;
                      away_score: number;
                      result_type: string;
                      confirmed_at: string | null;
                      voided_by_action_id: string | null;
                    }>
                  | null,
              );
              // Plan 50: spot auto-voids triggered by a ban.
              const voidedByBan =
                result?.result_type === "void" && !!result?.voided_by_action_id;
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
              const homePlayerId = (homePlayer as { id?: string } | null)?.id ?? "";
              const awayPlayerId = (awayPlayer as { id?: string } | null)?.id ?? "";
              return (
                <li
                  key={m.id}
                  className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
                  data-testid={`fixture-${m.id}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <PlayerChip
                        label={playerLabel(homePlayer)}
                        gamerTag={homePlayer?.gamer_tag ?? null}
                        side="home"
                      />
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                        vs
                      </span>
                      <PlayerChip
                        label={playerLabel(awayPlayer)}
                        gamerTag={awayPlayer?.gamer_tag ?? null}
                        side="away"
                      />
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

                  {/* Plan 27 — reorder chevrons (a11y-friendly buttons; no drag-drop) */}
                  <div
                    className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--chalk-3)]"
                    data-testid={`reorder-row-${m.id}`}
                  >
                    <span className="font-mono tabular text-[var(--chalk-2)]">
                      #{idx + 1}
                    </span>
                    <form action={reorderMatchAction}>
                      <input type="hidden" name="matchDayId" value={matchDay.id} />
                      <input type="hidden" name="matchId" value={m.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        type="submit"
                        disabled={isFirst}
                        aria-label="Move fixture up"
                        data-testid={`reorder-up-${m.id}`}
                        className={
                          "rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-0.5 text-[var(--chalk-1)] " +
                          (isFirst
                            ? "opacity-30"
                            : "hover:border-[var(--primary)] hover:text-[var(--primary)]")
                        }
                      >
                        ↑
                      </button>
                    </form>
                    <form action={reorderMatchAction}>
                      <input type="hidden" name="matchDayId" value={matchDay.id} />
                      <input type="hidden" name="matchId" value={m.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        disabled={isLast}
                        aria-label="Move fixture down"
                        data-testid={`reorder-down-${m.id}`}
                        className={
                          "rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-0.5 text-[var(--chalk-1)] " +
                          (isLast
                            ? "opacity-30"
                            : "hover:border-[var(--primary)] hover:text-[var(--primary)]")
                        }
                      >
                        ↓
                      </button>
                    </form>
                  </div>

                  {/* Plan 26 — inline edit + soft-delete (admins only via matches.edit) */}
                  <div className="mt-4 grid grid-cols-1 gap-3 rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-1)] p-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
                    <form
                      action={editMatchAction}
                      className="contents"
                      data-testid={`edit-fixture-form-${m.id}`}
                    >
                      <input type="hidden" name="matchDayId" value={matchDay.id} />
                      <input type="hidden" name="matchId" value={m.id} />
                      <FormField label="Home (edit)">
                        <select
                          name="homePlayerId"
                          required
                          defaultValue={homePlayerId}
                          className={selectClass}
                          data-testid={`edit-home-select-${m.id}`}
                        >
                          {playerOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </FormField>
                      <FormField label="Away (edit)">
                        <select
                          name="awayPlayerId"
                          required
                          defaultValue={awayPlayerId}
                          className={selectClass}
                          data-testid={`edit-away-select-${m.id}`}
                        >
                          {playerOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </FormField>
                      <div>
                        <SecondaryButton
                          type="submit"
                          data-testid={`edit-fixture-btn-${m.id}`}
                        >
                          Save
                        </SecondaryButton>
                      </div>
                    </form>
                    <form
                      action={removeMatchAction}
                      className="md:justify-self-end"
                      data-testid={`remove-fixture-form-${m.id}`}
                    >
                      <input type="hidden" name="matchDayId" value={matchDay.id} />
                      <input type="hidden" name="matchId" value={m.id} />
                      <DangerButton
                        type="submit"
                        data-testid={`remove-fixture-btn-${m.id}`}
                      >
                        Delete
                      </DangerButton>
                    </form>
                  </div>

                  {voidedByBan ? (
                    <div
                      data-testid={`voided-by-ban-${m.id}`}
                      className="mt-3 rounded-sm border border-[var(--flare)]/50 bg-[var(--ink-1)] p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-sm border border-[var(--flare)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--flare)]">
                          voided by ban
                        </span>
                        <Link
                          href={`/admin/discipline/punishments/${result!.voided_by_action_id}`}
                          className="font-mono text-[11px] text-[var(--signal)] underline decoration-dotted hover:no-underline"
                          data-testid={`voided-by-ban-link-${m.id}`}
                        >
                          sanction #{result!.voided_by_action_id!.slice(0, 8)}
                        </Link>
                        <span className="text-[var(--chalk-3)]">
                          Revoke the ban to auto-restore every match it
                          touched, or un-void just this one below.
                        </span>
                      </div>
                      <form
                        action={unvoidMatchAction}
                        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
                        data-testid={`unvoid-match-form-${m.id}`}
                      >
                        <input
                          type="hidden"
                          name="matchDayId"
                          value={matchDay.id}
                        />
                        <input type="hidden" name="matchId" value={m.id} />
                        <FormField label="Reason (audit)">
                          <input
                            name="reason"
                            required
                            minLength={3}
                            maxLength={500}
                            placeholder="Why un-void this specific match?"
                            className={inputClass}
                            data-testid={`unvoid-reason-${m.id}`}
                          />
                        </FormField>
                        <DangerButton
                          type="submit"
                          data-testid={`unvoid-btn-${m.id}`}
                        >
                          Un-void match
                        </DangerButton>
                      </form>
                    </div>
                  ) : null}

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
  gamerTag,
  side,
}: {
  label: string;
  gamerTag: string | null;
  side: "home" | "away";
}) {
  const initials = label
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  // Plan 32 — try resolving a static headshot for the player; fall back to
  // initials when the player isn't in the seeded 13-roster manifest.
  const photoUrl = getPlayerAvatarUrl(gamerTag);
  const ring =
    side === "home"
      ? "border-[var(--primary)]"
      : "border-[var(--ink-5)]";
  const fallbackInk =
    side === "home"
      ? "bg-[rgba(107,205,6,0.08)] text-[var(--primary)]"
      : "bg-[var(--ink-3)] text-[var(--chalk-1)]";
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden
        className={
          "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 font-display text-xs font-bold tabular " +
          ring +
          " " +
          (photoUrl ? "bg-[var(--ink-1)]" : fallbackInk)
        }
        data-testid="match-day-player-chip"
      >
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={label}
            width={36}
            height={36}
            className="h-full w-full object-cover"
          />
        ) : (
          (initials || "—")
        )}
      </div>
      <span className="font-display text-base font-semibold text-[var(--chalk-0)]">
        {label}
      </span>
    </div>
  );
}
