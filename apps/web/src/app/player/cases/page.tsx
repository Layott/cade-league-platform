import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  DataTable,
  type DataTableColumn,
} from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { DeadlineBadge } from "@/components/admin/DeadlineBadge";
import { PrimaryButton } from "@/components/admin/buttons";
import {
  listForUser as listDisputesForUser,
  type DisputeRow,
} from "@/server/disputes";
import {
  listForUser as listAppealsForUser,
  type AppealRow,
} from "@/server/appeals";
import { formatWat } from "@/lib/time";
import { PlayerAppealsLiveRefresh } from "@/components/player/PlayerAppealsLiveRefresh";
import { CasesSegmentedTabs, type CasesTab } from "./CasesSegmentedTabs";

export const dynamic = "force-dynamic";

/**
 * UI Audit Slice 2 (2026-04-28) — merged `/player/cases` page.
 * Replaces `/player/disputes` + `/player/appeals` with one surface
 * carrying a segmented control (Disputes · Appeals) at the top. The
 * default segment is "disputes" (?tab missing → disputes). Both
 * old paths now 307 to here.
 *
 * Submit forms (`/player/disputes/new` + `/player/appeals/new`) keep
 * working unchanged — Slice 2 merges the LIST views, not the submit
 * flows. Their post-submit redirect is updated to land here.
 *
 * Permissions: `disputes.read.own` for the disputes segment + the
 * disputes count pill, `appeals.read.own` for the appeals segment +
 * the appeals count pill. We always read both (so the count pills
 * are accurate even when viewing the other segment), but throw on the
 * gate for whichever segment the viewer cannot access. In practice
 * the seeded `player` role has both, so this is defense in depth.
 */

type SearchParams = { tab?: string };

function normalizeTab(raw: string | undefined): CasesTab {
  return raw === "appeals" ? "appeals" : "disputes";
}

async function resolveGate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/player/cases");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/player/cases");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  const [canDisputes, canAppeals] = await Promise.all([
    hasPermAsync(svc, { userId: pub.id, roles }, "disputes.read.own"),
    hasPermAsync(svc, { userId: pub.id, roles }, "appeals.read.own"),
  ]);
  if (!canDisputes && !canAppeals) {
    throw new Error("Forbidden: disputes.read.own / appeals.read.own");
  }
  return {
    sb: svc,
    userId: pub.id as string,
    canDisputes,
    canAppeals,
  };
}

export default async function PlayerCasesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const tab = normalizeTab(sp.tab);
  const { sb, userId, canDisputes, canAppeals } = await resolveGate();

  // Pre-flight permission gate: if the viewer asks for a segment they
  // don't have own-read perm for, throw — same shape the v1 pages
  // used. In practice every `player` row has both perms (seed map +
  // Plan 13A migration).
  if (tab === "disputes" && !canDisputes) {
    throw new Error("Forbidden: disputes.read.own");
  }
  if (tab === "appeals" && !canAppeals) {
    throw new Error("Forbidden: appeals.read.own");
  }

  // Read both lists concurrently. We always need both counts for the
  // segmented pill badges; loading the inactive segment's full list
  // keeps the data fresh on every switch with no client-side cache.
  const [disputes, appeals] = await Promise.all([
    canDisputes ? listDisputesForUser(sb, userId) : Promise.resolve([] as DisputeRow[]),
    canAppeals ? listAppealsForUser(sb, userId) : Promise.resolve([] as AppealRow[]),
  ]);

  const description =
    tab === "disputes"
      ? "Grievances you have raised. IDC/LOC reviews each one."
      : "Appeals you have filed against disciplinary cases. Deadlines are in Africa/Lagos (WAT).";

  const action =
    tab === "disputes" ? (
      <Link href="/player/disputes/new">
        <PrimaryButton data-testid="new-dispute-btn">+ Raise a dispute</PrimaryButton>
      </Link>
    ) : null;

  return (
    <div className="space-y-6" data-testid="player-cases-page" data-active-tab={tab}>
      {/* Live-refresh subscriber for ruling/withdrawal events (kept from
          the old /player/appeals page). Always mounted — no-op when the
          user lacks an appeals row in flight. */}
      <PlayerAppealsLiveRefresh userId={userId} />

      <SectionHeader
        eyebrow="Cases"
        title="My disputes & appeals"
        description={description}
        action={action}
      />

      <CasesSegmentedTabs
        active={tab}
        disputesCount={disputes.length}
        appealsCount={appeals.length}
      />

      {tab === "disputes" ? (
        <DisputesSegment rows={disputes} />
      ) : (
        <AppealsSegment rows={appeals} />
      )}
    </div>
  );
}

/* ---------------------------------- */
/* Disputes segment (was /player/disputes) */
/* ---------------------------------- */
function DisputesSegment({ rows }: { rows: DisputeRow[] }) {
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
      key: "title",
      label: "Title",
      render: (d) => (
        <span className="text-sm text-[var(--chalk-0)]">{d.title ?? "—"}</span>
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
    <DataTable
      columns={cols}
      rows={rows}
      rowKey={(d) => d.id}
      testId="player-disputes-list"
      emptyLabel="No disputes yet"
      emptyHint={
        <span>
          Raise one if something needs review.{" "}
          <Link
            href="/player/disputes/new"
            className="text-[var(--signal)] hover:underline"
          >
            File a dispute →
          </Link>
        </span>
      }
    />
  );
}

/* ---------------------------------- */
/* Appeals segment (was /player/appeals) */
/* ---------------------------------- */
function AppealsSegment({ rows }: { rows: AppealRow[] }) {
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
    <DataTable
      columns={cols}
      rows={rows}
      rowKey={(a) => a.id}
      testId="player-appeals-list"
      rowAttrs={(a) => ({ "data-testid": `player-appeal-row-${a.id}` })}
      emptyLabel="No appeals yet"
      emptyHint={
        <span>
          You can appeal a disciplinary case from the case detail page or your{" "}
          <Link href="/profile" className="text-[var(--signal)] hover:underline">
            profile sanctions list
          </Link>
          .
        </span>
      }
    />
  );
}
