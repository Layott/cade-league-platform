import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { listAllForAdmin } from "@/server/punishments";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function PunishmentsAdminPage() {
  const sb = await getServerSupabase();
  const rows = await listAllForAdmin(sb);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Punishments</h2>
        <Link
          href="/admin/punishments/new"
          className="rounded bg-black text-white text-sm px-3 py-2"
        >
          New punishment
        </Link>
      </div>

      <table className="w-full text-sm border" data-testid="punishments-table">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2">Imposed (WAT)</th>
            <th className="text-left p-2">Player</th>
            <th className="text-left p-2">Incident</th>
            <th className="text-left p-2">Sanction</th>
            <th className="text-left p-2">Magnitude</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2">{formatWat(r.imposed_at, "yyyy-MM-dd HH:mm")}</td>
              <td className="p-2">
                <Link
                  href={`/players/${r.player.id}`}
                  className="underline hover:text-black"
                >
                  {r.player.display_name}
                </Link>
                <div className="text-xs text-slate-500">{r.player.gamer_tag}</div>
              </td>
              <td className="p-2">{r.incident_type}</td>
              <td className="p-2">{r.sanction_type}</td>
              <td className="p-2">{r.magnitude}</td>
              <td className="p-2">{r.revoked_at ? "revoked" : "active"}</td>
              <td className="p-2">
                <Link
                  href={`/admin/punishments/${r.id}`}
                  className="underline text-sm"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="p-4 text-center text-slate-500">
                No punishments recorded.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
