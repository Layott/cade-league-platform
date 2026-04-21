import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  listSubmissionsForWeek,
  weekStartThursday,
  type SubmissionRow,
} from "@/server/squads";
import { formatWat } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { SecondaryButton } from "@/components/admin/buttons";

export const dynamic = "force-dynamic";

type StatusFilter = "all" | "pending" | "approved" | "rejected";

export default async function AdminSquadsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; week?: string }>;
}) {
  const sp = await searchParams;
  const sb = await getServerSupabase();

  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();

  const weekStart = sp.week ?? weekStartThursday(new Date());
  const status = (sp.status ?? "all") as StatusFilter;

  const rows: SubmissionRow[] = season
    ? await listSubmissionsForWeek(sb, season.id, weekStart, {
        status: status === "all" ? undefined : status,
      })
    : [];

  const columns: DataTableColumn<SubmissionRow>[] = [
    {
      key: "player",
      label: "Player",
      render: (r) => (
        <Link
          href={`/players/${r.player?.id ?? r.player_id}`}
          className="font-display text-sm font-semibold text-[var(--chalk-0)] underline-offset-4 hover:text-[var(--signal)] hover:underline"
        >
          {r.player?.display_name ?? r.player_id.slice(0, 8)}
        </Link>
      ),
    },
    {
      key: "submitted",
      label: "Submitted (WAT)",
      render: (r) => (
        <span className="font-mono text-[12px] tabular text-[var(--chalk-1)]">
          {formatWat(r.submitted_at, "yyyy-MM-dd HH:mm")}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusPill status={r.validation_status} />,
    },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (r) => (
        <Link
          href={`/admin/squads/${r.id}`}
          className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
        >
          Review
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={`Week of ${weekStart}`}
        title="Squads"
        description="Weekly squad submissions. Pending rows await a referee decision; approved rows are public on player profiles."
        action={
          <Link href="/admin/squads/rules">
            <SecondaryButton>Rules</SecondaryButton>
          </Link>
        }
      />

      <form method="GET" className="flex items-center gap-3">
        <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
          Filter
        </label>
        <select
          name="status"
          defaultValue={status}
          data-testid="squad-filter"
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-xs text-[var(--chalk-0)]"
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <input type="hidden" name="week" value={weekStart} />
        <button
          type="submit"
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
        >
          Apply
        </button>
      </form>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        testId="squads-list"
        rowAttrs={(r) => ({ "data-testid": `squad-row-${r.id}` })}
        emptyLabel="No submissions this week"
        emptyHint="Players submit by Thursday 10:00 WAT. Check back later."
      />
    </div>
  );
}
