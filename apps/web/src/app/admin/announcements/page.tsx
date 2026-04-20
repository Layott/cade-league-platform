import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";

export default async function AnnouncementsListPage() {
  const sb = await getServerSupabase();
  const { data: rows } = await sb
    .from("announcements")
    .select("id, title, priority, audience_type, published_at, scheduled_publish_at, is_public")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Announcements</h2>
        <Link
          href="/admin/announcements/new"
          className="bg-black text-white rounded px-3 py-2 text-sm"
        >
          New
        </Link>
      </div>
      <table className="w-full text-sm border">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2">Title</th>
            <th className="text-left p-2">Priority</th>
            <th className="text-left p-2">Audience</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Public</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2">
                <Link href={`/admin/announcements/${r.id}`} className="underline">
                  {r.title}
                </Link>
              </td>
              <td className="p-2">{r.priority}</td>
              <td className="p-2">{r.audience_type}</td>
              <td className="p-2">
                {r.published_at
                  ? `Published ${formatWat(r.published_at, "yyyy-MM-dd HH:mm")}`
                  : r.scheduled_publish_at
                  ? `Scheduled ${formatWat(r.scheduled_publish_at, "yyyy-MM-dd HH:mm")}`
                  : "Draft"}
              </td>
              <td className="p-2">{r.is_public ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
