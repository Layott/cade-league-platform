import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { listMatchDays } from "@/server/matches/match-days";
import { formatWat } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { PrimaryButton } from "@/components/admin/buttons";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listMatchDays>>[number];

export default async function MatchDaysPage() {
  const sb = await getServerSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();

  const days = season ? await listMatchDays(sb, season.id) : [];

  const columns: DataTableColumn<Row>[] = [
    {
      key: "date",
      label: "Date",
      render: (d) => (
        <span className="font-mono text-[13px] text-[var(--chalk-0)] tabular">
          {formatWat(`${d.match_date}T00:00:00Z`, "EEE · MMM d yyyy")}
        </span>
      ),
    },
    {
      key: "venue",
      label: "Venue",
      render: (d) => (
        <span className="text-[var(--chalk-1)]">{d.venue_name}</span>
      ),
    },
    {
      key: "fixtures",
      label: "Fixtures",
      align: "right",
      render: (d) => (
        <span className="tabular text-[var(--chalk-1)]">{d.match_count}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (d) => <StatusPill status={d.status} />,
    },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (d) => (
        <div className="flex justify-end gap-3 text-xs font-semibold uppercase tracking-[0.18em]">
          <Link
            href={`/admin/match-days/${d.id}`}
            className="text-[var(--chalk-2)] hover:text-[var(--signal)]"
          >
            Manage
          </Link>
          <Link
            href={`/admin/match-days/${d.id}/attendance`}
            className="text-[var(--chalk-2)] hover:text-[var(--signal)]"
          >
            Attendance
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Calendar"
        title="Match days"
        description="Every past, current, and upcoming session for the active season. Click a row to enter fixtures or mark attendance."
        action={
          <Link href="/admin/match-days/new" data-testid="new-match-day-link">
            <PrimaryButton>+ New match day</PrimaryButton>
          </Link>
        }
      />

      <DataTable
        columns={columns}
        rows={days}
        rowKey={(d) => d.id}
        emptyLabel="Schedule drop pending"
        emptyHint={
          <>
            No match days on the books yet. Use{" "}
            <span className="text-[var(--signal)]">New match day</span> to lock
            in the next session.
          </>
        }
      />
    </div>
  );
}
