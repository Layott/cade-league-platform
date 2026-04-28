import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import {
  publishNowFromDetail,
  unpublishFromDetail,
} from "./[id]/actions";

type Row = {
  id: string;
  title: string;
  priority: string;
  audience_type: string;
  published_at: string | null;
  scheduled_publish_at: string | null;
  is_public: boolean;
};

export default async function AnnouncementsListPage() {
  const sb = await getServerSupabase();
  const { data: rows } = await sb
    .from("announcements")
    .select(
      "id, title, priority, audience_type, published_at, scheduled_publish_at, is_public",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const data = (rows ?? []) as Row[];

  const columns: DataTableColumn<Row>[] = [
    {
      key: "title",
      label: "Title",
      render: (r) => (
        <Link
          href={`/admin/announcements/${r.id}`}
          className="font-display text-sm font-semibold text-[var(--chalk-0)] underline-offset-4 hover:text-[var(--signal)] hover:underline"
        >
          {r.title}
        </Link>
      ),
    },
    {
      key: "priority",
      label: "Priority",
      render: (r) => <StatusPill status={r.priority} />,
    },
    {
      key: "audience",
      label: "Audience",
      render: (r) => (
        <span className="text-xs uppercase tracking-[0.16em] text-[var(--chalk-2)]">
          {r.audience_type.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => {
        if (r.published_at)
          return (
            <span className="space-y-0.5">
              <StatusPill status="published" />
              <div className="mt-1 font-mono text-[11px] text-[var(--chalk-3)] tabular">
                {formatWat(r.published_at, "yyyy-MM-dd HH:mm")}
              </div>
            </span>
          );
        if (r.scheduled_publish_at)
          return (
            <span className="space-y-0.5">
              <StatusPill tone="amber">scheduled</StatusPill>
              <div className="mt-1 font-mono text-[11px] text-[var(--chalk-3)] tabular">
                {formatWat(r.scheduled_publish_at, "yyyy-MM-dd HH:mm")}
              </div>
            </span>
          );
        return <StatusPill tone="muted">draft</StatusPill>;
      },
    },
    {
      key: "public",
      label: "Public",
      align: "center",
      render: (r) =>
        r.is_public ? (
          <StatusPill status="active">Public</StatusPill>
        ) : (
          <span className="text-[var(--chalk-3)] text-xs uppercase tracking-[0.2em]">
            no
          </span>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <Link href={`/admin/announcements/${r.id}`}>
            <SecondaryButton type="button">Open</SecondaryButton>
          </Link>
          {r.published_at ? (
            <form action={unpublishFromDetail}>
              <input type="hidden" name="id" value={r.id} />
              <DangerButton
                type="submit"
                data-testid={`unpublish-row-${r.id}`}
              >
                Unpublish
              </DangerButton>
            </form>
          ) : (
            <form action={publishNowFromDetail}>
              <input type="hidden" name="id" value={r.id} />
              <PrimaryButton
                type="submit"
                data-testid={`publish-row-${r.id}`}
              >
                Publish
              </PrimaryButton>
            </form>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Broadcast"
        title="Announcements"
        description="Drafts, scheduled publishes, and live briefings from the league office."
        action={
          <Link href="/admin/announcements/new">
            <PrimaryButton>+ New announcement</PrimaryButton>
          </Link>
        }
      />

      <DataTable
        columns={columns}
        rows={data}
        rowKey={(r) => r.id}
        emptyLabel="The studio is quiet"
        emptyHint="Nothing drafted or published. Compose the first briefing."
      />
    </div>
  );
}
