import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getPlayerById } from "@/server/players";
import { getActiveSeason } from "@/server/seasons";
import { listStandings } from "@/server/standings/read";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";

export const revalidate = 60;

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const [player, season] = await Promise.all([
    getPlayerById(sb, id),
    getActiveSeason(sb),
  ]);
  if (!player) notFound();

  const standings = season ? await listStandings(sb, season.id) : [];
  const stats = standings.find((r) => r.player_id === player.id);
  const rank = stats
    ? standings.findIndex((r) => r.player_id === player.id) + 1
    : null;

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
            <PlayerAvatar
              photoUrl={player.photo_url}
              displayName={player.display_name}
              size={152}
              jerseyNumber={player.jersey_number}
            />
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
