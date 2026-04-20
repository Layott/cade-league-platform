import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { listMatchDays } from "@/server/matches/match-days";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function MatchDaysPage() {
  const sb = await getServerSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();

  const days = season ? await listMatchDays(sb, season.id) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Match Days</h2>
        <Link
          href="/admin/match-days/new"
          className="bg-black text-white px-4 py-2 rounded text-sm"
          data-testid="new-match-day-link"
        >
          + New match day
        </Link>
      </div>
      <table className="w-full text-sm border bg-white">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2">Date</th>
            <th className="text-left p-2">Venue</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Fixtures</th>
            <th className="text-left p-2"></th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="p-2">
                {formatWat(`${d.match_date}T00:00:00Z`, "EEE, MMM d yyyy")}
              </td>
              <td className="p-2">{d.venue_name}</td>
              <td className="p-2">{d.status}</td>
              <td className="p-2">{d.match_count}</td>
              <td className="p-2 space-x-3">
                <Link href={`/admin/match-days/${d.id}`} className="underline">
                  Manage
                </Link>
                <Link
                  href={`/admin/match-days/${d.id}/attendance`}
                  className="underline"
                >
                  Attendance
                </Link>
              </td>
            </tr>
          ))}
          {days.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-4 text-center text-gray-500">
                No match days yet. Click &quot;New match day&quot; to create one.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
