import { getServerSupabase } from "@/lib/supabase/server";
import { listPublic } from "@/server/punishments";
import { formatWat } from "@/lib/time";
import Link from "next/link";

export const revalidate = 60;

export default async function PublicPunishmentsPage() {
  const sb = await getServerSupabase();
  const rows = await listPublic(sb, 100);

  return (
    <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <header className="space-y-1">
        <p className="text-sm uppercase tracking-wide text-slate-500">League discipline</p>
        <h1 className="text-3xl font-bold">Punishments</h1>
      </header>

      {rows.length === 0 ? (
        <p className="text-slate-600">No public punishments on record.</p>
      ) : (
        <ul className="space-y-3" data-testid="public-punishments-list">
          {rows.map((r) => (
            <li
              key={r.id}
              className="border rounded-lg p-4 bg-white flex items-start justify-between gap-4"
            >
              <div>
                <div className="flex items-baseline gap-2">
                  <Link href={`/players/${r.player.id}`} className="font-semibold hover:underline">
                    {r.player.display_name}
                  </Link>
                  <span className="text-sm text-slate-500">({r.player.gamer_tag})</span>
                </div>
                <p className="text-sm text-slate-700 mt-1">
                  {r.sanction_type.replace("_", " ")}
                  {r.magnitude > 0 ? ` · ${r.magnitude}` : ""}
                  {" · "}
                  {r.incident_type.replace("_", " ")}
                </p>
                {r.notes ? (
                  <p className="text-sm text-slate-600 mt-1 whitespace-pre-line">{r.notes}</p>
                ) : null}
              </div>
              <time className="text-xs text-slate-500 flex-none">
                {formatWat(r.imposed_at, "yyyy-MM-dd")}
              </time>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
