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
import { DeadlineBadge } from "@/components/admin/DeadlineBadge";
import { list as listAppeals, type AppealRow } from "@/server/appeals";
import { formatWat } from "@/lib/time";
import { AppealsLiveRefresh } from "@/components/admin/AppealsLiveRefresh";

export const dynamic = "force-dynamic";

type StatusFilter =
  | "all"
  | "submitted"
  | "under_review"
  | "ruled"
  | "withdrawn"
  | "expired";

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
    await requirePermAsync(svc, { userId: pub.id, roles }, "appeals.read");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: appeals.read");
    throw e;
  }
  return svc;
}

export default async function AdminAppealsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sb = await resolveGate();
  const sp = await searchParams;
  const status = (sp.status ?? "all") as StatusFilter;
  const appeals = await listAppeals(sb, {
    status: status === "all" ? undefined : status,
    limit: 200,
  });

  // Join submitter + discipline-case summaries.
  const userIds = new Set<string>();
  const caseIds = new Set<string>();
  for (const a of appeals) {
    userIds.add(a.submitted_by_user_id);
    caseIds.add(a.disciplinary_case_id);
  }
  const userMap = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: u } = await sb
      .from("users")
      .select("id, display_name, email")
      .in("id", Array.from(userIds));
    for (const row of (u ?? []) as {
      id: string;
      display_name: string | null;
      email: string;
    }[]) {
      userMap.set(row.id, row.display_name ?? row.email);
    }
  }
  const caseMap = new Map<string, string>();
  if (caseIds.size > 0) {
    const { data: c } = await sb
      .from("disciplinary_cases")
      .select("id, incident_type, opened_at")
      .in("id", Array.from(caseIds));
    for (const row of (c ?? []) as {
      id: string;
      incident_type: string;
      opened_at: string | null;
    }[]) {
      const suffix = row.opened_at
        ? ` · ${formatWat(row.opened_at, "yyyy-MM-dd")}`
        : "";
      caseMap.set(row.id, `${row.incident_type}${suffix}`);
    }
  }

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
        <span className="text-xs text-[var(--chalk-1)]">
          {caseMap.get(a.disciplinary_case_id) ?? a.disciplinary_case_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "submitter",
      label: "Submitter",
      render: (a) => (
        <span className="text-sm text-[var(--chalk-0)]">
          {userMap.get(a.submitted_by_user_id) ?? a.submitted_by_user_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "deadline",
      label: "Deadline (WAT)",
      render: (a) => (
        <span className="font-mono text-[11px] tabular text-[var(--chalk-2)]">
          {formatWat(a.deadline_at, "EEE yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      key: "badge",
      label: "Countdown",
      render: (a) => (
        <DeadlineBadge
          deadlineIso={a.deadline_at}
          status={a.status}
          data-testid={`deadline-badge-${a.id}`}
        />
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (a) => <StatusPill status={a.status} />,
    },
    {
      key: "panel",
      label: "Panel",
      align: "center",
      render: (a) => (
        <span className="font-mono text-xs text-[var(--chalk-2)]">
          {a.panel_member_user_ids.length} / 3
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (a) => (
        <Link
          href={`/admin/discipline/appeals/${a.id}`}
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
        >
          Review
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <AppealsLiveRefresh />
      <SectionHeader
        eyebrow="Governance"
        title="Appeals"
        description="5-business-day IDC panel rulings. Deadlines are in Africa/Lagos (WAT)."
      />

      <form method="GET" className="flex items-center gap-3">
        <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
          Filter
        </label>
        <select
          name="status"
          defaultValue={status}
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-xs text-[var(--chalk-0)]"
          data-testid="appeal-status-filter"
        >
          <option value="all">All</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under review</option>
          <option value="ruled">Ruled</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="expired">Expired</option>
        </select>
        <button
          type="submit"
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
        >
          Apply
        </button>
      </form>

      <DataTable
        columns={cols}
        rows={appeals}
        rowKey={(a) => a.id}
        testId="appeals-list"
        rowAttrs={(a) => ({ "data-testid": `appeal-row-${a.id}` })}
        emptyLabel="No appeals"
        emptyHint="Players file via /player/appeals/new?caseId=…"
      />
    </div>
  );
}
