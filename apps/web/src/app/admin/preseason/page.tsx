import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { PrimaryButton } from "@/components/admin/buttons";
import {
  listShoots,
  type PreseasonShootRow,
} from "@/server/preseason";
import { formatWat } from "@/lib/time";

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

export default async function AdminPreseasonListPage() {
  const sb = await resolveGate();
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();

  const shoots: PreseasonShootRow[] = season
    ? await listShoots(sb, season.id)
    : [];

  // Count attendance per shoot.
  const counts = new Map<string, { total: number; attended: number }>();
  if (shoots.length > 0) {
    const { data: att } = await sb
      .from("preseason_shoot_attendance")
      .select("shoot_id, attended_bool")
      .in("shoot_id", shoots.map((s) => s.id))
      .is("deleted_at", null);
    for (const r of (att ?? []) as {
      shoot_id: string;
      attended_bool: boolean;
    }[]) {
      const cur = counts.get(r.shoot_id) ?? { total: 0, attended: 0 };
      cur.total += 1;
      if (r.attended_bool) cur.attended += 1;
      counts.set(r.shoot_id, cur);
    }
  }

  const cols: DataTableColumn<PreseasonShootRow>[] = [
    {
      key: "date",
      label: "Date",
      render: (s) => (
        <span className="font-mono text-sm text-[var(--chalk-0)]">
          {s.shoot_date}
        </span>
      ),
    },
    {
      key: "type",
      label: "Type",
      render: (s) => <StatusPill status={s.type} tone="muted" />,
    },
    {
      key: "location",
      label: "Location",
      render: (s) => (
        <span className="text-xs text-[var(--chalk-1)]">
          {s.location ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (s) => <StatusPill status={s.status} />,
    },
    {
      key: "attendance",
      label: "Attendance",
      align: "right",
      render: (s) => {
        const c = counts.get(s.id);
        return (
          <span className="font-mono tabular text-xs text-[var(--chalk-2)]">
            {c ? `${c.attended} / ${c.total}` : "—"}
          </span>
        );
      },
    },
    {
      key: "updated",
      label: "Updated",
      render: (s) => (
        <span className="font-mono text-[11px] text-[var(--chalk-3)]">
          {formatWat(s.updated_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (s) => (
        <Link
          href={`/admin/preseason/${s.id}`}
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
        >
          Open
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={season ? `Season ${season.year_range}` : "Preseason"}
        title="Preseason shoots"
        description="Photo, video, and interview shoots. Rule 2.5 auto-warns any roster miss."
        action={
          season ? (
            <Link href="/admin/preseason/new">
              <PrimaryButton data-testid="new-shoot-btn">
                + Schedule shoot
              </PrimaryButton>
            </Link>
          ) : null
        }
      />
      {season ? (
        <DataTable
          columns={cols}
          rows={shoots}
          rowKey={(s) => s.id}
          testId="preseason-list"
          rowAttrs={(s) => ({ "data-testid": `shoot-row-${s.id}` })}
          emptyLabel="No shoots yet"
          emptyHint="Click + Schedule shoot to add one."
        />
      ) : (
        <p className="text-xs text-[var(--chalk-3)]">No active season found.</p>
      )}
    </div>
  );
}
