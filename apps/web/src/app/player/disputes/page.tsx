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
import { listForUser, type DisputeRow } from "@/server/disputes";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

async function resolveGate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/player/disputes");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/player/disputes");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "disputes.read.own");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: disputes.read.own");
    throw e;
  }
  return { sb: svc, userId: pub.id };
}

export default async function PlayerDisputesListPage() {
  const { sb, userId } = await resolveGate();
  const disputes = await listForUser(sb, userId);

  const cols: DataTableColumn<DisputeRow>[] = [
    {
      key: "opened",
      label: "Opened",
      render: (d) => (
        <span className="font-mono text-[11px] tabular text-[var(--chalk-1)]">
          {formatWat(d.opened_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      key: "subject",
      label: "Subject",
      render: (d) => (
        <span className="text-xs text-[var(--chalk-2)]">{d.subject_type}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (d) => <StatusPill status={d.status} />,
    },
    {
      key: "ruling",
      label: "Ruling",
      render: (d) => (
        <span className="line-clamp-2 text-xs text-[var(--chalk-1)]">
          {d.ruling ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Disputes"
        title="My disputes"
        description="Grievances you have raised. IDC/LOC reviews each one."
        action={
          <Link href="/player/disputes/new">
            <PrimaryButton data-testid="new-dispute-btn">
              + Raise a dispute
            </PrimaryButton>
          </Link>
        }
      />
      <DataTable
        columns={cols}
        rows={disputes}
        rowKey={(d) => d.id}
        testId="player-disputes-list"
        emptyLabel="No disputes yet"
        emptyHint="Raise one if something needs review."
      />
    </div>
  );
}
