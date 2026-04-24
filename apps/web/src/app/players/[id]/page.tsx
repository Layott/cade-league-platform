import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { getPlayerById } from "@/server/players";
import { getActiveSeason } from "@/server/seasons";
import { listStandings } from "@/server/standings/read";
import { listForPlayer } from "@/server/punishments";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { CadePlayerCard } from "@/components/players/CadePlayerCard";
import { getPlayerHeadshotUrl } from "@/lib/player-photos";
import {
  getApprovedSubmissionForPlayer,
  weekStartThursday,
} from "@/server/squads";
import { SquadPitchView } from "@/components/squads/SquadPitchView";

export const revalidate = 60;

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();
  // Plan 39 RLS on disciplinary_actions blocks authenticated reads; use
  // service role for the sanctions list (public_visible filtering still
  // enforced in-function).
  const svc = getServiceRoleSupabase();
  const [player, season, sanctions] = await Promise.all([
    getPlayerById(sb, id),
    getActiveSeason(sb),
    listForPlayer(svc, id),
  ]);
  if (!player) notFound();

  const standings = season ? await listStandings(sb, season.id) : [];
  const stats = standings.find((r) => r.player_id === player.id);
  const rank = stats
    ? standings.findIndex((r) => r.player_id === player.id) + 1
    : null;
  const weekStart = weekStartThursday(new Date());
  const approvedSquad = await getApprovedSubmissionForPlayer(sb, player.id, weekStart);

  // Plan 14 — recent match stats card. Pulls player_match_stats rows whose
  // originating screenshot has parse_status='confirmed'. Unreviewed OCR
  // never leaks: the inner join on match_stat_screenshots with the status
  // filter excludes any PMS row lacking a confirmed screenshot.
  // Supabase-js types join columns as to-many by default (see
  // tasks/lessons.md 2026-04-26). We express every nested join as an
  // array-or-single union and go through `as unknown as` on read.
  type RecentRow = {
    match_id: string;
    goals: number;
    assists: number;
    custom_metrics: Record<string, number | null> | null;
    matches:
      | {
          id: string;
          match_day_id: string;
          home_player_id: string;
          away_player_id: string;
          match_stat_screenshots:
            | { id: string; parse_status: string; confirmed_at: string | null }[]
            | { id: string; parse_status: string; confirmed_at: string | null }
            | null;
          match_day:
            | { match_date: string }
            | { match_date: string }[]
            | null;
        }
      | {
          id: string;
          match_day_id: string;
          home_player_id: string;
          away_player_id: string;
          match_stat_screenshots:
            | { id: string; parse_status: string; confirmed_at: string | null }[]
            | { id: string; parse_status: string; confirmed_at: string | null }
            | null;
          match_day:
            | { match_date: string }
            | { match_date: string }[]
            | null;
        }[]
      | null;
  };
  const { data: recentRaw } = await sb
    .from("player_match_stats")
    .select(
      `match_id, goals, assists, custom_metrics,
       matches:match_id (
         id, match_day_id, home_player_id, away_player_id,
         match_stat_screenshots!inner ( id, parse_status, confirmed_at ),
         match_day:match_day_id ( match_date )
       )`
    )
    .eq("player_id", player.id)
    .is("deleted_at", null)
    .eq("matches.match_stat_screenshots.parse_status", "confirmed")
    .limit(10);

  const recentStats: Array<{
    matchId: string;
    matchDate: string | null;
    opponentId: string | null;
    goals: number;
    assists: number;
    possessionPct: number | null;
    shots: number | null;
    passAccuracyPct: number | null;
  }> = [];

  for (const raw of (recentRaw ?? []) as unknown as RecentRow[]) {
    const mRaw = raw.matches;
    if (!mRaw) continue;
    const m = Array.isArray(mRaw) ? mRaw[0] : mRaw;
    if (!m) continue;
    const ssRaw = m.match_stat_screenshots;
    const ss = Array.isArray(ssRaw) ? ssRaw : ssRaw ? [ssRaw] : [];
    if (!ss.some((s) => s.parse_status === "confirmed")) continue;
    const md = Array.isArray(m.match_day)
      ? m.match_day[0]?.match_date
      : m.match_day?.match_date;
    const opponentId =
      m.home_player_id === player.id ? m.away_player_id : m.home_player_id;
    const cm = raw.custom_metrics ?? {};
    recentStats.push({
      matchId: raw.match_id,
      matchDate: md ?? null,
      opponentId,
      goals: raw.goals,
      assists: raw.assists,
      possessionPct: (cm.possessionPct ?? null) as number | null,
      shots: (cm.shots ?? null) as number | null,
      passAccuracyPct: (cm.passAccuracyPct ?? null) as number | null,
    });
  }
  // Sort newest-first by matchDate.
  recentStats.sort((a, b) =>
    (b.matchDate ?? "").localeCompare(a.matchDate ?? ""),
  );

  return (
    <div>
      <section className="relative overflow-hidden border-b border-[var(--ink-4)] py-14">
        <div aria-hidden className="absolute inset-0 scanlines opacity-30" />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-20 top-10 h-60 w-60 rounded-full bg-[var(--signal-glow)] blur-3xl"
        />
        <div className="relative mx-auto max-w-6xl px-5">
          <Link
            href="/players"
            className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] transition-colors hover:text-[var(--signal)]"
          >
            ← Back to roster
          </Link>

          <header className="mt-6 flex flex-col items-start gap-8 md:flex-row md:items-end">
            {(() => {
              // Plan 32 — render CadePlayerCard at top of profile when a
              // transparent headshot is available; fall back to PlayerAvatar
              // for players outside the seeded 13-roster.
              const cardPhoto = getPlayerHeadshotUrl(
                player.gamer_tag,
                "transparent",
                1,
              );
              if (cardPhoto) {
                return (
                  <div data-testid="profile-cade-card">
                    <CadePlayerCard
                      displayName={player.display_name}
                      gamerTag={player.gamer_tag}
                      jerseyNumber={player.jersey_number ?? undefined}
                      rating={80}
                      position="ST"
                      photoUrl={cardPhoto}
                      stats={{
                        pac: 80,
                        sho: 80,
                        pas: 80,
                        dri: 80,
                        def: 80,
                        phy: 80,
                      }}
                      rarity="cade-special"
                      size="xl"
                    />
                  </div>
                );
              }
              return (
                <PlayerAvatar
                  photoUrl={
                    player.photo_url ?? getPlayerHeadshotUrl(player.gamer_tag)
                  }
                  displayName={player.display_name}
                  size={152}
                  jerseyNumber={player.jersey_number}
                />
              );
            })()}
            <div className="flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--signal)]">
                @{player.gamer_tag}
              </div>
              <h1 className="mt-2 font-display text-5xl font-bold leading-[0.95] tracking-tight text-[var(--chalk-0)]">
                {player.display_name}
              </h1>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em]">
                {player.jersey_number != null ? (
                  <InfoTag label="Jersey" value={`#${player.jersey_number}`} />
                ) : null}
                {player.psn_id ? (
                  <InfoTag label="PSN" value={player.psn_id} />
                ) : null}
                {rank != null ? (
                  <InfoTag label="Rank" value={`${rank} / ${standings.length}`} />
                ) : null}
              </div>
            </div>
          </header>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-10 px-5 py-10">
        <section>
          <h2 className="mb-4 font-display text-xl font-bold text-[var(--chalk-0)]">
            Season stats
          </h2>
          {stats ? (
            <dl className="grid grid-cols-2 divide-x divide-[var(--ink-4)] rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] md:grid-cols-7">
              <Stat label="MP" value={stats.matches_played} />
              <Stat label="W" value={stats.wins} />
              <Stat label="D" value={stats.draws} />
              <Stat label="L" value={stats.losses} />
              <Stat label="GF" value={stats.goals_for} />
              <Stat label="GA" value={stats.goals_against} />
              <Stat label="Pts" value={stats.points} accent />
            </dl>
          ) : (
            <p className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/60 p-6 text-sm text-[var(--chalk-2)]">
              Stats populate the moment this player&apos;s first confirmed
              match result is signed off.
            </p>
          )}
        </section>

        <section data-testid="public-recent-match-stats">
          <h2 className="mb-4 font-display text-xl font-bold text-[var(--chalk-0)]">
            Recent match stats
          </h2>
          {recentStats.length === 0 ? (
            <p className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/60 p-6 text-sm text-[var(--chalk-2)]">
              Per-match stats appear here as soon as an admin confirms a
              screenshot upload for this player&apos;s fixtures.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {recentStats.map((r) => (
                <li
                  key={r.matchId}
                  data-testid={`recent-stat-${r.matchId}`}
                  className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--chalk-3)] tabular">
                      {r.matchDate ?? "—"}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-5 gap-2 text-center">
                    <MiniStat label="G" value={r.goals} />
                    <MiniStat label="A" value={r.assists} />
                    <MiniStat label="Poss%" value={r.possessionPct} />
                    <MiniStat label="Shots" value={r.shots} />
                    <MiniStat label="Pass%" value={r.passAccuracyPct} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {approvedSquad ? (
          <section data-testid="public-week-squad">
            <h2 className="mb-3 font-display text-xl font-bold text-[var(--chalk-0)]">
              This week&apos;s squad
            </h2>
            <p className="mb-3 text-xs uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Week of {approvedSquad.submission.week_start_date}
            </p>
            <SquadPitchView items={approvedSquad.items} />
          </section>
        ) : null}

        <section data-testid="public-player-sanctions">
          <h2 className="mb-4 font-display text-xl font-bold text-[var(--chalk-0)]">
            Sanctions
          </h2>
          {sanctions.length === 0 ? (
            <p className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/60 p-6 text-sm text-[var(--chalk-2)]">
              Clean sheet. No public sanctions on record.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {sanctions.map((s) => (
                <li
                  key={s.id}
                  data-testid={`public-sanction-${s.id}`}
                  className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-[var(--signal)]">
                      {s.sanction_type.replace(/_/g, " ")}
                      {s.magnitude ? ` · ${s.magnitude}` : ""}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--chalk-3)] tabular">
                      {s.imposed_at.slice(0, 10)}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-2)]">
                    {s.incident_type.replace(/_/g, " ")}
                  </div>
                  {s.notes ? (
                    <p className="mt-2 text-[13px] text-[var(--chalk-1)]">
                      {s.notes}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {player.bio ? (
          <section>
            <h2 className="mb-3 font-display text-xl font-bold text-[var(--chalk-0)]">
              Bio
            </h2>
            <p className="max-w-3xl whitespace-pre-line text-[15px] leading-relaxed text-[var(--chalk-1)]">
              {player.bio}
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function InfoTag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-sm border border-[var(--ink-5)] bg-[var(--ink-2)] px-2.5 py-1 text-[var(--chalk-1)]">
      <span className="text-[9px] font-semibold tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </span>
      <span className="tabular font-semibold text-[var(--chalk-0)]">
        {value}
      </span>
    </span>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]/60 px-1.5 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
        {label}
      </div>
      <div className="tabular mt-1 font-display text-base font-bold text-[var(--chalk-0)]">
        {value == null ? "—" : value}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </dt>
      <dd
        className={
          "tabular mt-2 font-display text-3xl font-bold leading-none " +
          (accent ? "text-[var(--signal)]" : "text-[var(--chalk-0)]")
        }
      >
        {value}
      </dd>
    </div>
  );
}
