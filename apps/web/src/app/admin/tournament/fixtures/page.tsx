import Link from "next/link";
import { getActiveSeason } from "@/server/seasons";
import { resolveTabGate } from "../_components/helpers";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Plan 51 — Fixtures tab.
 *
 * Read-only list of every match in the active season grouped by match-day.
 * Each row shows the two players, scheduled time, result if confirmed, and
 * a walkover / void badge. Row click takes the admin to the match-day
 * detail page (canonical fixture editor lives at /admin/match-days/[id]).
 */

type MatchRow = {
  id: string;
  match_day_id: string;
  scheduled_time: string | null;
  status: string;
  home: { id: string; name: string };
  away: { id: string; name: string };
  homeScore: number | null;
  awayScore: number | null;
  resultType: string | null;
  isWalkover: boolean;
  walkoverPending: boolean;
};

type DayBlock = {
  id: string;
  date: string | null;
  venue: string | null;
  matches: MatchRow[];
};

export default async function FixturesPage() {
  const { svc } = await resolveTabGate("tournament.read");
  const season = await getActiveSeason(svc);
  if (!season) {
    return (
      <section className="space-y-6" data-testid="tournament-tab-fixtures">
        <EmptyShell
          title="No active season"
          message="There is no active season — once one is started, fixtures will list here."
        />
      </section>
    );
  }

  // Bug 1 (2026-05-02): PostgREST embeds do not inherit parent .is filters.
  // Filter the matches embed by deleted_at IS NULL so soft-deleted fixtures
  // don't show up in the admin tournament fixtures list. Same root cause as
  // listMatchDaysWithTags + listMatchDays in server/matches/match-days.ts.
  const { data: matchDays, error: mdErr } = await svc
    .from("match_days")
    .select(
      `
      id, match_date, venue_name,
      matches:matches (
        id, match_day_id, scheduled_time, status, deleted_at,
        home:home_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) ),
        away:away_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) ),
        result:match_results ( home_score, away_score, result_type, is_walkover, walkover_pending )
      )
      `,
    )
    .eq("season_id", season.id)
    .is("deleted_at", null)
    .is("matches.deleted_at", null)
    .order("match_date", { ascending: true });

  if (mdErr) {
    throw new Error(`fixtures read failed: ${mdErr.message}`);
  }

  type RawDay = {
    id: string;
    match_date: string | null;
    venue_name: string | null;
    matches: RawMatch[] | null;
  };
  type RawMatch = {
    id: string;
    match_day_id: string;
    scheduled_time: string | null;
    status: string;
    home:
      | {
          id: string;
          gamer_tag: string;
          users: { display_name: string | null } | null;
        }
      | { id: string; gamer_tag: string; users: { display_name: string | null } | null }[]
      | null;
    away:
      | {
          id: string;
          gamer_tag: string;
          users: { display_name: string | null } | null;
        }
      | { id: string; gamer_tag: string; users: { display_name: string | null } | null }[]
      | null;
    result:
      | {
          home_score: number;
          away_score: number;
          result_type: string | null;
          is_walkover?: boolean | null;
          walkover_pending?: boolean | null;
        }[]
      | {
          home_score: number;
          away_score: number;
          result_type: string | null;
          is_walkover?: boolean | null;
          walkover_pending?: boolean | null;
        }
      | null;
  };

  const firstOrNull = <T,>(v: T | T[] | null | undefined): T | null => {
    if (!v) return null;
    if (Array.isArray(v)) return v[0] ?? null;
    return v;
  };

  const days: DayBlock[] = ((matchDays ?? []) as unknown as RawDay[]).map((d) => {
    const matches: MatchRow[] = (d.matches ?? [])
      .map((m) => {
        const home = firstOrNull(m.home);
        const away = firstOrNull(m.away);
        const result = firstOrNull(m.result);
        return {
          id: m.id,
          match_day_id: m.match_day_id,
          scheduled_time: m.scheduled_time,
          status: m.status,
          home: {
            id: home?.id ?? "",
            name: home?.users?.display_name ?? home?.gamer_tag ?? "TBD",
          },
          away: {
            id: away?.id ?? "",
            name: away?.users?.display_name ?? away?.gamer_tag ?? "TBD",
          },
          homeScore: result?.home_score ?? null,
          awayScore: result?.away_score ?? null,
          resultType: result?.result_type ?? null,
          isWalkover: result?.is_walkover === true,
          walkoverPending: result?.walkover_pending === true,
        };
      })
      .sort((a, b) =>
        (a.scheduled_time ?? "99:99").localeCompare(b.scheduled_time ?? "99:99"),
      );
    return {
      id: d.id,
      date: d.match_date,
      venue: d.venue_name,
      matches,
    };
  });

  const totalFixtures = days.reduce((acc, d) => acc + d.matches.length, 0);

  return (
    <section className="space-y-6" data-testid="tournament-tab-fixtures">
      <header className="flex flex-col gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Fixtures · {totalFixtures} total · {days.length} match-days
        </div>
        <p className="text-[12px] text-[var(--chalk-2)]">
          Read-only roster of every match in the active season. Edit fixture
          assignments from{" "}
          <Link className="text-[var(--signal)] hover:underline" href="/admin/match-days">
            /admin/match-days
          </Link>
          .
        </p>
      </header>

      {days.length === 0 ? (
        <EmptyShell
          title="No match-days yet"
          message="Schedule the first match-day from /admin/match-days/new."
        />
      ) : (
        days.map((d) => (
          <DayBlockView key={d.id} day={d} />
        ))
      )}
    </section>
  );
}

function DayBlockView({ day }: { day: DayBlock }) {
  return (
    <section
      className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid={`fixtures-day-${day.id}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--ink-4)] bg-[var(--ink-3)]/50 px-4 py-3">
        <div className="flex flex-col">
          <div className="font-display text-[15px] font-semibold text-[var(--chalk-0)]">
            {day.date ? formatWat(day.date, "EEE, dd MMM yyyy") : "Date TBD"}
          </div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            {day.venue ?? "Venue TBD"} · {day.matches.length} fixtures
          </div>
        </div>
        <Link
          href={`/admin/match-days/${day.id}`}
          className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
        >
          Open match-day →
        </Link>
      </header>
      <ul className="divide-y divide-[var(--ink-4)]/70">
        {day.matches.length === 0 ? (
          <li className="px-4 py-6 text-center text-[12px] text-[var(--chalk-3)]">
            No fixtures scheduled for this match-day yet.
          </li>
        ) : (
          day.matches.map((m) => <FixtureRow key={m.id} match={m} />)
        )}
      </ul>
    </section>
  );
}

function FixtureRow({ match }: { match: MatchRow }) {
  const played = match.homeScore !== null && match.awayScore !== null;
  return (
    <li
      data-testid={`fixture-row-${match.id}`}
      className="grid grid-cols-[80px_1fr_auto_auto] items-center gap-3 px-4 py-3"
    >
      <span className="font-mono text-[11px] tabular text-[var(--chalk-3)]">
        {match.scheduled_time ?? "—"}
      </span>
      <div className="flex items-center gap-2 text-[13px] text-[var(--chalk-1)]">
        <span className="font-display font-semibold text-[var(--chalk-0)]">
          {match.home.name}
        </span>
        <span className="text-[var(--chalk-3)]">vs</span>
        <span className="font-display font-semibold text-[var(--chalk-0)]">
          {match.away.name}
        </span>
      </div>
      <div className="font-mono text-[12px] tabular text-[var(--chalk-1)]">
        {played ? (
          <span>
            {match.homeScore} <span className="text-[var(--chalk-3)]">-</span>{" "}
            {match.awayScore}
          </span>
        ) : (
          <span className="text-[var(--chalk-3)]">—</span>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        {match.isWalkover ? (
          <Badge tone="warn" testId="badge-walkover">
            {match.walkoverPending ? "Walkover (pending)" : "Walkover"}
          </Badge>
        ) : null}
        {match.resultType === "void" ? (
          <Badge tone="danger" testId="badge-void">
            Void
          </Badge>
        ) : null}
        {match.status === "in_progress" ? (
          <Badge tone="signal" testId="badge-live">
            Live
          </Badge>
        ) : null}
      </div>
    </li>
  );
}

function Badge({
  children,
  tone,
  testId,
}: {
  children: React.ReactNode;
  tone: "signal" | "warn" | "danger";
  testId?: string;
}) {
  const cls =
    tone === "signal"
      ? "border-[var(--signal)] bg-[rgba(0,255,136,0.12)] text-[var(--signal)]"
      : tone === "warn"
        ? "border-[rgba(255,191,0,0.45)] bg-[rgba(255,191,0,0.1)] text-[#ffbf00]"
        : "border-[rgba(255,91,59,0.45)] bg-[rgba(255,91,59,0.1)] text-[var(--flare)]";
  return (
    <span
      data-testid={testId}
      className={
        "inline-flex rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] " +
        cls
      }
    >
      {children}
    </span>
  );
}

function EmptyShell({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-12 text-center">
      <div className="font-display text-base text-[var(--chalk-1)]">{title}</div>
      <p className="mt-1 text-[12px] text-[var(--chalk-3)]">{message}</p>
    </div>
  );
}
