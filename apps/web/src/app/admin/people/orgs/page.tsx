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
import { listOrgs, type OrgRow } from "@/server/orgs";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

async function resolveGate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/people/orgs");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/people/orgs");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "orgs.read");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: orgs.read");
    throw e;
  }
  return svc;
}

type Enriched = OrgRow & { linked_players: number };

function fmtCoins(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(n));
}

export default async function AdminOrgsListPage() {
  const sb = await resolveGate();
  const rows = await listOrgs(sb);
  let enriched: Enriched[] = rows.map((r) => ({ ...r, linked_players: 0 }));
  if (rows.length > 0) {
    const { data: counts } = await sb
      .from("players")
      .select("organization_id")
      .in(
        "organization_id",
        rows.map((r) => r.id),
      )
      .is("deleted_at", null);
    const byOrg = new Map<string, number>();
    for (const c of (counts ?? []) as { organization_id: string | null }[]) {
      if (!c.organization_id) continue;
      byOrg.set(c.organization_id, (byOrg.get(c.organization_id) ?? 0) + 1);
    }
    enriched = rows.map((r) => ({
      ...r,
      linked_players: byOrg.get(r.id) ?? 0,
    }));
  }

  const columns: DataTableColumn<Enriched>[] = [
    {
      key: "name",
      label: "Name",
      render: (r) => (
        <Link
          href={`/admin/people/orgs/${r.id}`}
          className="font-display text-sm font-semibold text-[var(--chalk-0)] underline-offset-4 hover:text-[var(--signal)] hover:underline"
          data-testid={`org-link-${r.id}`}
        >
          {r.name}
        </Link>
      ),
    },
    {
      key: "logo",
      label: "Logo",
      render: (r) =>
        r.logo_url ? (
          // Plan 31 — show a thumbnail; org-logos bucket is public.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.logo_url}
            alt={`${r.name} logo`}
            className="h-8 w-8 rounded-sm border border-[var(--ink-4)] object-contain"
            data-testid={`org-list-logo-${r.id}`}
          />
        ) : (
          <span className="text-xs text-[var(--chalk-3)]">—</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusPill status={r.status} />,
    },
    {
      key: "balance",
      label: "Balance (coins)",
      align: "right",
      render: (r) => (
        <span className="font-mono tabular text-[var(--chalk-0)]">
          {fmtCoins(r.caution_fee_balance_coins)}
        </span>
      ),
    },
    {
      key: "linked",
      label: "Linked players",
      align: "right",
      render: (r) => (
        <span className="font-mono tabular text-[var(--chalk-2)]">
          {r.linked_players}
        </span>
      ),
    },
    {
      key: "updated",
      label: "Updated (WAT)",
      render: (r) => (
        <span className="font-mono text-[11px] text-[var(--chalk-3)]">
          {formatWat(r.updated_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Governance"
        title="Organizations"
        description="Esports orgs with at least one rostered player. Ledger is append-only — use an adjustment entry to correct a mistake."
        action={
          <Link href="/admin/people/orgs/new">
            <PrimaryButton data-testid="new-org-btn">+ New org</PrimaryButton>
          </Link>
        }
      />

      <DataTable
        columns={columns}
        rows={enriched}
        rowKey={(r) => r.id}
        testId="orgs-list"
        rowAttrs={(r) => ({ "data-testid": `org-row-${r.id}` })}
        emptyLabel="No organizations yet"
        emptyHint="Click + New org to register the first one."
      />
    </div>
  );
}
