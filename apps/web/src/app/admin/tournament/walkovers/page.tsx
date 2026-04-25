import { getActiveSeason } from "@/server/seasons";
import { resolveTabGate } from "../_components/helpers";
import { WalkoverConfirmCard } from "../_components/WalkoverConfirmCard";
import {
  TriggerWalkoverForm,
  type TriggerCandidate,
} from "./TriggerWalkoverForm";
import { confirmPendingWalkoverAction } from "./actions";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Plan 51 — Walkovers tab.
 *
 * Two stacked sections:
 *   1. Pending confirmations — ref-marked walkovers awaiting admin confirm.
 *   2. Trigger walkover — admin picks fixture + winner directly.
 */
export default async function WalkoversPage() {
  const { svc } = await resolveTabGate("tournament.walkover_confirm");
  const season = await getActiveSeason(svc);
  if (!season) {
    return (
      <section className="space-y-6" data-testid="tournament-tab-walkovers">
        <Empty
          title="No active season"
          message="Walkovers attach to fixtures in the active season."
        />
      </section>
    );
  }

  // Pending walkovers: match_results rows where walkover_pending = true.
  const { data: pendingRaw, error: pErr } = await svc
    .from("match_results")
    .select(
      `
      match_id, walkover_initiated_by, walkover_pending, winner_player_id,
      home_score, away_score,
      match:match_id (
        id,
        match_day:match_day_id ( id, match_date ),
        home:home_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) ),
        away:away_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) )
      )
      `,
    )
    .eq("walkover_pending", true)
    .is("deleted_at", null);

  if (pErr) {
    throw new Error(`pending walkovers read: ${pErr.message}`);
  }

  type PendingRow = {
    match_id: string;
    walkover_initiated_by: "ref" | "admin" | null;
    walkover_pending: boolean;
    winner_player_id: string | null;
    home_score: number;
    away_score: number;
    match:
      | {
          id: string;
          match_day:
            | { id: string; match_date: string | null }[]
            | { id: string; match_date: string | null }
            | null;
          home: PlayerRef | PlayerRef[] | null;
          away: PlayerRef | PlayerRef[] | null;
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

  const pendingRows = ((pendingRaw ?? []) as unknown as PendingRow[])
    .map((r) => {
      const match = r.match;
      if (!match) return null;
      const home = firstOrNull(match.home);
      const away = firstOrNull(match.away);
      const md = firstOrNull(match.match_day);
      if (!home || !away) return null;
      const homeName = home.users?.display_name ?? home.gamer_tag;
      const awayName = away.users?.display_name ?? away.gamer_tag;
      const winnerName =
        r.winner_player_id === home.id
          ? homeName
          : r.winner_player_id === away.id
            ? awayName
            : "TBD";
      return {
        matchId: r.match_id,
        homeName,
        awayName,
        winnerName,
        date: md?.match_date ? formatWat(md.match_date, "EEE, dd MMM yyyy") : null,
        initiatedBy: r.walkover_initiated_by,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Trigger candidates — fixtures with NO existing result (so we can write one).
  const { data: candRaw, error: cErr } = await svc
    .from("matches")
    .select(
      `
      id, scheduled_time,
      match_day:match_day_id ( id, match_date, venue_name ),
      home:home_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) ),
      away:away_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) ),
      result:match_results ( id )
      `,
    )
    .eq("season_id", season.id)
    .is("deleted_at", null);

  if (cErr) {
    throw new Error(`candidates read: ${cErr.message}`);
  }

  type CandRow = {
    id: string;
    scheduled_time: string | null;
    match_day:
      | { id: string; match_date: string | null; venue_name: string | null }[]
      | { id: string; match_date: string | null; venue_name: string | null }
      | null;
    home: PlayerRef | PlayerRef[] | null;
    away: PlayerRef | PlayerRef[] | null;
    result: { id: string }[] | { id: string } | null;
  };

  const candidates: TriggerCandidate[] = ((candRaw ?? []) as unknown as CandRow[])
    .filter((m) => {
      const r = firstOrNull(m.result);
      return r === null;
    })
    .map((m) => {
      const home = firstOrNull(m.home);
      const away = firstOrNull(m.away);
      const md = firstOrNull(m.match_day);
      const homeName =
        home?.users?.display_name ?? home?.gamer_tag ?? "TBD";
      const awayName =
        away?.users?.display_name ?? away?.gamer_tag ?? "TBD";
      const dayLabel = md?.match_date
        ? formatWat(md.match_date, "EEE, dd MMM")
        : "Date TBD";
      return {
        matchId: m.id,
        matchDayLabel: dayLabel,
        homeId: home?.id ?? "",
        homeName,
        awayId: away?.id ?? "",
        awayName,
      };
    })
    .filter((c) => c.homeId && c.awayId);

  return (
    <section className="space-y-8" data-testid="tournament-tab-walkovers">
      <section className="space-y-3" data-testid="walkovers-pending-section">
        <header className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Pending confirmations · {pendingRows.length}
          </div>
          <p className="text-[12px] text-[var(--chalk-2)]">
            Referee-marked walkovers awaiting admin sign-off. Confirming
            stamps `walkover_confirmed_at` and finalizes the 3-0 row.
          </p>
        </header>
        {pendingRows.length === 0 ? (
          <Empty
            title="No pending walkovers"
            message="Refs mark walkovers from /referee/attendance when a player is absent."
          />
        ) : (
          <div className="space-y-2">
            {pendingRows.map((p) => (
              <WalkoverConfirmCard
                key={p.matchId}
                matchId={p.matchId}
                homeName={p.homeName}
                awayName={p.awayName}
                winnerName={p.winnerName}
                matchDate={p.date}
                initiatedBy={p.initiatedBy}
                confirmAction={confirmPendingWalkoverAction}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" data-testid="walkovers-trigger-section">
        <header className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Trigger walkover
          </div>
          <p className="text-[12px] text-[var(--chalk-2)]">
            Award a 3-0 walkover directly. Use this for off-platform forfeits
            when a referee can&apos;t mark the absence in person.
          </p>
        </header>
        <TriggerWalkoverForm candidates={candidates} />
      </section>
    </section>
  );
}

function Empty({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-8 text-center">
      <div className="font-display text-base text-[var(--chalk-1)]">
        {title}
      </div>
      <p className="mt-1 text-[12px] text-[var(--chalk-3)]">{message}</p>
    </div>
  );
}
