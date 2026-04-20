import Link from "next/link";
import { PlayerAvatar } from "./PlayerAvatar";
import type { PlayerView } from "@/server/players/types";

export function PlayerCard({ player }: { player: PlayerView }) {
  return (
    <Link
      href={`/players/${player.id}`}
      className="block rounded-xl border bg-white p-4 hover:shadow-md transition"
      data-testid="player-card"
    >
      <div className="flex items-start gap-4">
        <PlayerAvatar photoUrl={player.photo_url} displayName={player.display_name} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold truncate">{player.display_name}</h3>
            {player.jersey_number != null ? (
              <span className="text-sm text-slate-500">#{player.jersey_number}</span>
            ) : null}
          </div>
          <p className="text-sm text-slate-600 truncate">{player.gamer_tag}</p>
        </div>
      </div>
    </Link>
  );
}
