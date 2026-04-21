import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { inputClass } from "@/components/admin/FormField";
import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import {
  getShootById,
  listAttendanceForShoot,
} from "@/server/preseason";
import { formatWat } from "@/lib/time";
import {
  saveAttendanceAction,
  cancelShootAction,
  completeShootAction,
} from "./actions";

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
    await requirePermAsync(svc, { userId: pub.id, roles }, "preseason.manage");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: preseason.manage");
    throw e;
  }
  return svc;
}

export default async function ShootAttendanceGridPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sb = await resolveGate();
  const { id } = await params;
  const shoot = await getShootById(sb, id);
  if (!shoot) return notFound();

  const [attendance, roster] = await Promise.all([
    listAttendanceForShoot(sb, id),
    sb
      .from("players")
      .select(
        "id, gamer_tag, users:users!players_user_id_fkey!inner(display_name)",
      )
      .is("deleted_at", null),
  ]);
  type RosterRow = {
    id: string;
    gamer_tag: string;
    users: { display_name: string };
  };
  const rosterRows = ((roster.data ?? []) as unknown as RosterRow[]).map((r) => ({
    id: r.id,
    label: r.users.display_name ?? r.gamer_tag,
    gamer_tag: r.gamer_tag,
  }));

  const byPlayer = new Map(attendance.map((a) => [a.player_id, a]));

  const attended = attendance.filter((a) => a.attended_bool).length;
  const absent = attendance.filter((a) => !a.attended_bool).length;
  const warnings = attendance.filter((a) => a.warning_issued_bool).length;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={`Preseason · ${shoot.type}`}
        title={`${shoot.shoot_date} · ${shoot.location ?? "TBA"}`}
        description={
          <span className="flex items-center gap-2">
            <StatusPill status={shoot.status} />
            <span className="text-xs text-[var(--chalk-3)]">
              Updated {formatWat(shoot.updated_at, "yyyy-MM-dd HH:mm")} WAT
            </span>
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            {shoot.status === "scheduled" ? (
              <>
                <form action={completeShootAction}>
                  <input type="hidden" name="shootId" value={shoot.id} />
                  <SecondaryButton
                    type="submit"
                    data-testid="shoot-complete-btn"
                  >
                    Mark complete
                  </SecondaryButton>
                </form>
                <form action={cancelShootAction}>
                  <input type="hidden" name="shootId" value={shoot.id} />
                  <DangerButton
                    type="submit"
                    data-testid="shoot-cancel-btn"
                  >
                    Cancel
                  </DangerButton>
                </form>
              </>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap gap-3 text-xs text-[var(--chalk-2)]">
        <span>
          Attended: <span className="font-mono text-[var(--chalk-0)]">{attended}</span>
        </span>
        <span>
          Absent: <span className="font-mono text-[var(--flare)]">{absent}</span>
        </span>
        <span>
          Auto-warned: <span className="font-mono text-[var(--amber)]">{warnings}</span>
        </span>
      </div>

      <form action={saveAttendanceAction} data-testid="shoot-attendance-form">
        <input type="hidden" name="shootId" value={shoot.id} />
        <div className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]">
          <table className="w-full text-sm text-[var(--chalk-1)]">
            <thead>
              <tr className="border-b border-[var(--ink-4)] bg-[var(--ink-3)]/60 text-left">
                <th className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Player
                </th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Attended
                </th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Notes
                </th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Warning
                </th>
              </tr>
            </thead>
            <tbody>
              {rosterRows.map((p) => {
                const row = byPlayer.get(p.id);
                return (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--ink-4)]/70 last:border-b-0"
                    data-testid={`shoot-attendance-row-${p.id}`}
                  >
                    <input type="hidden" name="playerIds[]" value={p.id} />
                    <td className="px-3 py-2 text-[var(--chalk-0)]">
                      {p.label}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        name={`attended.${p.id}`}
                        value="1"
                        defaultChecked={row?.attended_bool ?? false}
                        data-testid={`shoot-attended-${p.id}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        name={`notes.${p.id}`}
                        defaultValue={row?.notes ?? ""}
                        maxLength={500}
                        className={inputClass}
                        data-testid={`shoot-notes-${p.id}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {row?.warning_issued_bool ? (
                        <StatusPill tone="amber">Auto-warned</StatusPill>
                      ) : (
                        <span className="text-xs text-[var(--chalk-3)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-end">
          <PrimaryButton type="submit" data-testid="shoot-save-btn">
            Save attendance
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}
