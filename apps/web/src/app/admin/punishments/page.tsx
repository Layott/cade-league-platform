import Link from "next/link";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { listAllForAdmin } from "@/server/punishments";
import { formatWat } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { PrimaryButton } from "@/components/admin/buttons";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listAllForAdmin>>[number];

// Plan 39 C3 enabled RLS on `disciplinary_actions` with a deny-all policy
// for anon+authenticated. This admin surface is gated by the middleware
// (ADMIN_ROLES must include the user) so we read via service role to
// bypass RLS and see every row.
export default async function PunishmentsAdminPage() {
  const sb = getServiceRoleSupabase();
  const rows = await listAllForAdmin(sb);

  const columns: DataTableColumn<Row>[] = [
    {
      key: "imposed",
      label: "Imposed",
      render: (r) => (
        <span className="font-mono text-[12px] text-[var(--chalk-1)] tabular">
          {formatWat(r.imposed_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      key: "player",
      label: "Player",
      render: (r) => (
        <div>
          <Link
            href={`/players/${r.player.id}`}
            className="font-display text-sm font-semibold text-[var(--chalk-0)] underline-offset-4 hover:text-[var(--signal)] hover:underline"
          >
            {r.player.display_name}
          </Link>
          <div className="font-mono text-[11px] text-[var(--chalk-3)]">
            {r.player.gamer_tag}
          </div>
        </div>
      ),
    },
    {
      key: "incident",
      label: "Incident",
      render: (r) => (
        <span className="text-xs uppercase tracking-[0.14em] text-[var(--chalk-2)]">
          {r.incident_type.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "sanction",
      label: "Sanction",
      render: (r) => <StatusPill status={r.sanction_type} />,
    },
    {
      key: "magnitude",
      label: "Magnitude",
      align: "right",
      render: (r) => (
        <span className="font-mono text-sm text-[var(--chalk-0)] tabular">
          {r.magnitude}
        </span>
      ),
    },
    {
      key: "state",
      label: "Status",
      render: (r) => (
        <StatusPill status={r.revoked_at ? "revoked" : "active"} />
      ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (r) => (
        <Link
          href={`/admin/punishments/${r.id}`}
          className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Discipline"
        title="Punishments"
        description="Every sanction issued across the active season. Revoke from the detail view with a written reason."
        action={
          <Link href="/admin/punishments/new">
            <PrimaryButton>+ New punishment</PrimaryButton>
          </Link>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        testId="punishments-table"
        emptyLabel="Clean slate"
        emptyHint="No punishments on the books — nobody in the book."
      />
    </div>
  );
}
