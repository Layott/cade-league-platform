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
import { DeadlineBadge } from "@/components/admin/DeadlineBadge";
import { listForUser, type AppealRow } from "@/server/appeals";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

async function resolveGate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/player/appeals");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/player/appeals");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "appeals.read.own");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: appeals.read.own");
    throw e;
  }
  return { sb: svc, userId: pub.id };
}

export default async function PlayerAppealsListPage() {
  const { sb, userId } = await resolveGate();
  const appeals = await listForUser(sb, userId);

  const cols: DataTableColumn<AppealRow>[] = [
    {
      key: "submitted",
      label: "Submitted",
      render: (a) => (
        <span className="font-mono text-[11px] tabular text-[var(--chalk-1)]">
          {formatWat(a.submitted_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      key: "case",
      label: "Case",
      render: (a) => (
        <span className="font-mono text-xs text-[var(--chalk-2)]">
          {a.disciplinary_case_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (a) => <StatusPill status={a.status} />,
    },
    {
      key: "deadline",
      label: "Deadline",
      render: (a) => (
        <div className="flex items-center gap-2">
          <DeadlineBadge deadlineIso={a.deadline_at} status={a.status} />
          <span className="font-mono text-[11px] text-[var(--chalk-3)]">
            {formatWat(a.deadline_at, "yyyy-MM-dd HH:mm")}
          </span>
        </div>
      ),
    },
    {
      key: "ruling",
      label: "Ruling",
      render: (a) => (
        <span className="line-clamp-2 text-xs text-[var(--chalk-1)]">
          {a.ruling ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Appeals"
        title="My appeals"
        description="Deadlines are in Africa/Lagos (WAT)."
      />
      <DataTable
        columns={cols}
        rows={appeals}
        rowKey={(a) => a.id}
        testId="player-appeals-list"
        rowAttrs={(a) => ({ "data-testid": `player-appeal-row-${a.id}` })}
        emptyLabel="No appeals yet"
        emptyHint="You can appeal a disciplinary case from the case detail page."
      />
    </div>
  );
}
