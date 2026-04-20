import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getPlayerById } from "@/server/players";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";

export const revalidate = 60;

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const player = await getPlayerById(sb, id);
  if (!player) notFound();

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <Link href="/players" className="text-sm text-slate-500 hover:underline">
        ← Back to roster
      </Link>

      <header className="flex items-start gap-6">
        <PlayerAvatar
          photoUrl={player.photo_url}
          displayName={player.display_name}
          size={128}
        />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{player.display_name}</h1>
          <div className="flex flex-wrap gap-3 text-sm text-slate-600">
            {player.jersey_number != null ? (
              <span className="px-2 py-1 rounded bg-slate-100">#{player.jersey_number}</span>
            ) : null}
            <span className="px-2 py-1 rounded bg-slate-100">Gamer tag: {player.gamer_tag}</span>
            {player.psn_id ? (
              <span className="px-2 py-1 rounded bg-slate-100">PSN: {player.psn_id}</span>
            ) : null}
          </div>
        </div>
      </header>

      {player.bio ? (
        <section className="prose max-w-none">
          <h2 className="text-lg font-semibold">Bio</h2>
          <p className="text-slate-700 whitespace-pre-line">{player.bio}</p>
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold">Season stats</h2>
        <p className="text-slate-500 text-sm">Stats appear once matches begin (Plan 3+).</p>
      </section>
    </main>
  );
}
