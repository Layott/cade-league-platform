import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { listByMatchDay } from "@/server/attendance";
import { markAction, editAction, undoAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await getServerSupabase();
  const roster = await listByMatchDay(sb, id);

  const { data: md } = await sb
    .from("match_days")
    .select("match_date, match_start_time, arrival_cutoff_time, venue_name")
    .eq("id", id)
    .maybeSingle();

  return (
    <div className="space-y-6" data-testid="attendance-page">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold">Attendance</h2>
        {md ? (
          <p className="text-sm text-gray-600">
            {md.match_date} · call {md.arrival_cutoff_time} · KO {md.match_start_time}
            {md.venue_name ? ` · ${md.venue_name}` : ""}
          </p>
        ) : null}
      </header>

      <table className="w-full text-sm border">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left p-2">#</th>
            <th className="text-left p-2">Player</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Marked</th>
            <th className="text-left p-2">Penalty</th>
            <th className="text-left p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((row) => (
            <tr
              key={row.player_id}
              className="border-t align-top"
              data-testid={`att-row-${row.player_id}`}
            >
              <td className="p-2">{row.jersey_number ?? "—"}</td>
              <td className="p-2">
                <div className="font-medium">{row.display_name}</div>
                {row.gamer_tag ? (
                  <div className="text-xs text-gray-500">{row.gamer_tag}</div>
                ) : null}
              </td>
              <td className="p-2">
                {row.status ? (
                  <span
                    data-testid={`att-status-${row.player_id}`}
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      row.status === "present"
                        ? "bg-green-100 text-green-700"
                        : row.status === "late"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {row.status}
                  </span>
                ) : (
                  <span className="text-gray-400 text-xs">unmarked</span>
                )}
              </td>
              <td className="p-2 text-xs">
                {row.marked_at ? (
                  <div>
                    <div>{formatWat(row.marked_at, "HH:mm:ss")}</div>
                    <div className="text-gray-500">{row.marked_by_name ?? "—"}</div>
                  </div>
                ) : (
                  "—"
                )}
              </td>
              <td className="p-2 text-xs">
                {row.auto_action_id ? (
                  <span className="text-red-700">linked</span>
                ) : row.status && row.status !== "present" ? (
                  <span className="text-gray-500">revoked</span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="p-2">
                {!row.mark_id ? (
                  <div className="flex gap-2">
                    {(["present", "late", "absent"] as const).map((s) => (
                      <form action={markAction} key={s}>
                        <input type="hidden" name="matchDayId" value={id} />
                        <input type="hidden" name="playerId" value={row.player_id} />
                        <input type="hidden" name="status" value={s} />
                        <button
                          data-testid={`att-btn-${s}-${row.player_id}`}
                          className="px-2 py-1 text-xs border rounded hover:bg-slate-50"
                          type="submit"
                        >
                          {s[0].toUpperCase() + s.slice(1)}
                        </button>
                      </form>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-2 items-start">
                    <details className="relative">
                      <summary
                        data-testid={`att-edit-${row.player_id}`}
                        className="cursor-pointer text-xs underline"
                      >
                        Edit
                      </summary>
                      <form
                        action={editAction}
                        className="absolute z-10 mt-1 bg-white border rounded shadow p-3 space-y-2 w-64"
                      >
                        <input type="hidden" name="markId" value={row.mark_id} />
                        <input type="hidden" name="matchDayId" value={id} />
                        <label className="block text-xs space-y-1">
                          <span>New status</span>
                          <select
                            name="newStatus"
                            aria-label="New status"
                            className="w-full border rounded px-2 py-1 text-sm"
                            defaultValue={row.status ?? "present"}
                          >
                            <option value="present">Present</option>
                            <option value="late">Late</option>
                            <option value="absent">Absent</option>
                          </select>
                        </label>
                        <label className="block text-xs space-y-1">
                          <span>Reason (required)</span>
                          <textarea
                            name="reason"
                            required
                            minLength={3}
                            data-testid={`att-reason-${row.player_id}`}
                            className="w-full border rounded px-2 py-1 text-sm"
                            rows={2}
                          />
                        </label>
                        <button
                          className="w-full bg-black text-white rounded py-1 text-xs"
                          type="submit"
                        >
                          Save edit
                        </button>
                      </form>
                    </details>
                    {row.auto_action_id ? (
                      <form action={undoAction}>
                        <input type="hidden" name="markId" value={row.mark_id} />
                        <input type="hidden" name="matchDayId" value={id} />
                        <button className="text-xs text-blue-700 underline" type="submit">
                          Undo penalty
                        </button>
                      </form>
                    ) : null}
                  </div>
                )}
              </td>
            </tr>
          ))}
          {roster.length === 0 ? (
            <tr>
              <td colSpan={6} className="p-4 text-center text-gray-500">
                No participants in this season.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
