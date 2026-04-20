import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { revokeSession } from "./actions";

export default async function SessionsPage() {
  const sb = await getServerSupabase();
  const { data: sessions } = await sb
    .from("sessions")
    .select("id, user_id, ip_address, user_agent, started_at, last_seen_at, revoked_at")
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Recent sessions</h2>
      <table className="w-full text-sm border">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2">Started (WAT)</th>
            <th className="text-left p-2">User</th>
            <th className="text-left p-2">IP</th>
            <th className="text-left p-2">UA</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(sessions ?? []).map((s) => (
            <tr key={s.id} className="border-t">
              <td className="p-2">{formatWat(s.started_at, "yyyy-MM-dd HH:mm")}</td>
              <td className="p-2 font-mono text-xs">{s.user_id}</td>
              <td className="p-2">{s.ip_address ?? "—"}</td>
              <td className="p-2 truncate max-w-[240px]" title={s.user_agent ?? ""}>
                {s.user_agent ?? "—"}
              </td>
              <td className="p-2">{s.revoked_at ? "revoked" : "active"}</td>
              <td className="p-2">
                {!s.revoked_at ? (
                  <form action={revokeSession}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <button className="text-red-600 underline" type="submit">
                      Revoke
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
