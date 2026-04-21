import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { inputClass } from "@/components/admin/FormField";
import { PrimaryButton } from "@/components/admin/buttons";
import {
  listByMatchDay,
  type ContentSessionRow,
} from "@/server/content";
import { formatWat } from "@/lib/time";
import { saveSessionsAction } from "./actions";

export const dynamic = "force-dynamic";

async function resolveGate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "content.verify");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: content.verify");
    throw e;
  }
  return svc;
}

export default async function SessionAttendanceGridPage({
  params,
}: {
  params: Promise<{ matchDayId: string }>;
}) {
  const sb = await resolveGate();
  const { matchDayId } = await params;

  const { data: matchDay } = await sb
    .from("match_days")
    .select("id, match_date, venue_name, status")
    .eq("id", matchDayId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!matchDay) return notFound();

  const sessions: ContentSessionRow[] = await listByMatchDay(sb, matchDayId);

  // Resolve player names.
  const playerIds = Array.from(new Set(sessions.map((s) => s.player_id)));
  const playerMap = new Map<string, string>();
  if (playerIds.length > 0) {
    const { data: rows } = await sb
      .from("players")
      .select("id, gamer_tag, users:users!players_user_id_fkey(display_name)")
      .in("id", playerIds);
    type Row = {
      id: string;
      gamer_tag: string;
      users: { display_name: string } | null;
    };
    for (const r of (rows ?? []) as unknown as Row[]) {
      playerMap.set(r.id, r.users?.display_name ?? r.gamer_tag);
    }
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={`Match day · ${formatWat((matchDay as { match_date: string }).match_date + "T00:00:00Z", "EEE MMM d")}`}
        title="Content sessions"
        description="Mark attendance per player. Schedule a makeup time if absent; tick the makeup checkbox once they attend."
      />

      {sessions.length === 0 ? (
        <p className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-sm text-[var(--chalk-2)]">
          No sessions scheduled for this match day yet.
        </p>
      ) : (
        <form action={saveSessionsAction} data-testid="sessions-grid-form">
          <input type="hidden" name="matchDayId" value={matchDayId} />
          <div className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]">
            <table className="w-full text-sm text-[var(--chalk-1)]">
              <thead>
                <tr className="border-b border-[var(--ink-4)] bg-[var(--ink-3)]/60 text-left">
                  <th className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                    Player
                  </th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                    Scheduled
                  </th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                    Attended
                  </th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                    Makeup at
                  </th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                    Makeup done
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-[var(--ink-4)]/70 last:border-b-0"
                  >
                    <input type="hidden" name="sessionIds[]" value={s.id} />
                    <td className="px-3 py-2 text-[var(--chalk-0)]">
                      {playerMap.get(s.player_id) ?? s.player_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--chalk-3)]">
                      {formatWat(s.scheduled_time, "HH:mm")}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        name={`attended.${s.id}`}
                        value="1"
                        defaultChecked={s.attended_bool}
                        data-testid={`session-attended-${s.id}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="datetime-local"
                        name={`makeupAt.${s.id}`}
                        defaultValue={
                          s.makeup_session_scheduled_at
                            ? s.makeup_session_scheduled_at.slice(0, 16)
                            : ""
                        }
                        className={inputClass}
                        data-testid={`session-makeup-at-${s.id}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        name={`makeupAttended.${s.id}`}
                        value="1"
                        defaultChecked={s.makeup_attended_bool}
                        disabled={!s.makeup_session_scheduled_at}
                        data-testid={`session-makeup-attended-${s.id}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-end">
            <PrimaryButton type="submit" data-testid="sessions-save-btn">
              Save grid
            </PrimaryButton>
          </div>
        </form>
      )}
    </div>
  );
}
