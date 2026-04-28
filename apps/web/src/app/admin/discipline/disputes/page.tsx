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
import { list as listDisputes, type DisputeRow } from "@/server/disputes";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

type StatusFilter =
  | "all"
  | "submitted"
  | "under_review"
  | "resolved"
  | "withdrawn";

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
    await requirePermAsync(svc, { userId: pub.id, roles }, "disputes.read");
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error("Forbidden: disputes.read");
    }
    throw e;
  }
  return svc;
}

export default async function AdminDisputesListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sb = await resolveGate();
  const sp = await searchParams;
  const status = (sp.status ?? "all") as StatusFilter;

  const disputes = await listDisputes(sb, {
    status: status === "all" ? undefined : status,
    limit: 200,
  });

  // One batched user lookup for raiser + assignee display.
  const userIds = new Set<string>();
  for (const d of disputes) {
    userIds.add(d.raised_by_user_id);
    if (d.assigned_to_user_id) userIds.add(d.assigned_to_user_id);
  }
  const userMap = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: rows } = await sb
      .from("users")
      .select("id, display_name, email")
      .in("id", Array.from(userIds));
    for (const u of (rows ?? []) as {
      id: string;
      display_name: string | null;
      email: string;
    }[]) {
      userMap.set(u.id, u.display_name ?? u.email);
    }
  }

  const columns: DataTableColumn<DisputeRow>[] = [
    {
      key: "opened",
      label: "Opened (WAT)",
      render: (d) => (
        <span className="font-mono text-[11px] tabular text-[var(--chalk-1)]">
          {formatWat(d.opened_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      key: "raiser",
      label: "Raiser",
      render: (d) => (
        <span className="text-sm text-[var(--chalk-0)]">
          {userMap.get(d.raised_by_user_id) ?? d.raised_by_user_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "title",
      label: "Title",
      render: (d) => (
        <span className="text-sm text-[var(--chalk-0)]">
          {d.title ?? "—"}
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
      key: "assigned",
      label: "Assigned to",
      render: (d) => (
        <span className="text-xs text-[var(--chalk-2)]">
          {d.assigned_to_user_id
            ? (userMap.get(d.assigned_to_user_id) ??
              d.assigned_to_user_id.slice(0, 8))
            : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (d) => (
        <Link
          href={`/admin/discipline/disputes/${d.id}`}
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
        >
          Review
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Governance"
        title="Disputes"
        description="Player-raised grievances. IDC reviews, assigns, and rules."
      />

      <form method="GET" className="flex items-center gap-3">
        <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
          Filter
        </label>
        <select
          name="status"
          defaultValue={status}
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-xs text-[var(--chalk-0)]"
          data-testid="dispute-status-filter"
        >
          <option value="all">All</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under review</option>
          <option value="resolved">Resolved</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
        <button
          type="submit"
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
        >
          Apply
        </button>
      </form>

      <DataTable
        columns={columns}
        rows={disputes}
        rowKey={(d) => d.id}
        testId="disputes-list"
        rowAttrs={(d) => ({ "data-testid": `dispute-row-${d.id}` })}
        emptyLabel="No disputes"
        emptyHint="Nothing raised matching this filter."
      />
    </div>
  );
}
