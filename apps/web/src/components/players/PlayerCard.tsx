import Link from "next/link";
import { PlayerAvatar } from "./PlayerAvatar";
import type { PlayerView } from "@/server/players/types";
import { getPlayerAvatarUrl } from "@/lib/player-photos";

export type PlayerCardStats = {
  matches_played: number;
  points: number;
  goals_for: number;
  goals_against: number;
};

type Props = {
  player: PlayerView;
  stats?: PlayerCardStats | null;
};

export function PlayerCard({ player, stats }: Props) {
  return (
    <Link
      href={`/players/${player.id}`}
      className="group relative block overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--signal)]"
      data-testid="player-card"
      data-gamer-tag={player.gamer_tag}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full bg-[var(--signal-glow)] opacity-0 blur-3xl transition-opacity group-hover:opacity-100"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-[var(--signal)] transition-transform group-hover:scale-x-100"
      />

      <div className="relative flex items-start gap-4">
        <PlayerAvatar
          photoUrl={player.photo_url ?? getPlayerAvatarUrl(player.gamer_tag)}
          displayName={player.display_name}
          size={64}
          jerseyNumber={player.jersey_number}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            @{player.gamer_tag}
          </div>
          <h3 className="mt-1 truncate font-display text-lg font-bold leading-tight text-[var(--chalk-0)]">
            {player.display_name}
          </h3>
          {player.psn_id ? (
            <div className="mt-0.5 text-[11px] tabular uppercase tracking-[0.14em] text-[var(--chalk-3)]">
              PSN · {player.psn_id}
            </div>
          ) : null}
        </div>
      </div>

      <dl className="relative mt-5 grid grid-cols-3 divide-x divide-[var(--ink-4)] border-t border-[var(--ink-4)] pt-4">
        <StatCell label="Pts" value={stats?.points} accent />
        <StatCell label="GF" value={stats?.goals_for} />
        <StatCell label="GA" value={stats?.goals_against} />
      </dl>
    </Link>
  );
}

function StatCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | null | undefined;
  accent?: boolean;
}) {
  const shown = value == null ? "—" : String(value);
  return (
    <div className="flex flex-col items-center justify-center px-2">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </dt>
      <dd
        className={
          "tabular mt-1 text-lg font-bold leading-none " +
          (accent
            ? "text-[var(--signal)]"
            : "text-[var(--chalk-0)]")
        }
      >
        {shown}
      </dd>
    </div>
  );
}
