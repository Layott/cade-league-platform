import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { PrimaryButton } from "@/components/admin/buttons";
import { formatWat } from "@/lib/time";
import {
  getActiveSession,
  listSessions,
  type StreamSessionRow,
} from "@/server/broadcast/sessions";
import { startSessionAction } from "./actions";

export const dynamic = "force-dynamic";

type MatchDayRow = {
  id: string;
  match_date: string;
  venue_name: string;
  status: string;
};

async function resolveAdmin() {
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

  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, "broadcast.manage");
  } catch (err) {
    if (err instanceof PermissionError) throw err;
    throw err;
  }
  return sb;
}

export default async function BroadcastPage({
  searchParams,
}: {
  searchParams: Promise<{ matchDayId?: string }>;
}) {
  const sb = await resolveAdmin();
  const sp = await searchParams;

  // Pull last-30-day match_days (covers scheduled/in-progress/recent).
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const until = new Date();
  until.setDate(until.getDate() + 90);
  const { data: matchDaysRaw } = await sb
    .from("match_days")
    .select("id, match_date, venue_name, status")
    .is("deleted_at", null)
    .gte("match_date", since.toISOString().slice(0, 10))
    .lte("match_date", until.toISOString().slice(0, 10))
    .order("match_date", { ascending: false })
    .limit(40);
  const matchDays = (matchDaysRaw ?? []) as MatchDayRow[];

  // Resolve selected match day (default: nearest to today with a scheduled
  // or in_progress status, else the first row).
  const selectedId =
    sp.matchDayId ??
    matchDays.find((d) => d.status === "in_progress" || d.status === "scheduled")
      ?.id ??
    matchDays[0]?.id ??
    "";

  const selected = matchDays.find((d) => d.id === selectedId) ?? null;
  const active: StreamSessionRow | null = selected
    ? await getActiveSession(sb, selected.id)
    : null;
  const past: StreamSessionRow[] = selected
    ? await listSessions(sb, selected.id)
    : [];

  const cols: DataTableColumn<StreamSessionRow>[] = [
    {
      key: "started",
      label: "Started",
      render: (s) => (
        <span className="tabular text-[var(--chalk-0)]">
          {formatWat(s.started_at, "EEE MMM d · HH:mm")}
        </span>
      ),
    },
    {
      key: "ended",
      label: "Ended",
      render: (s) => (
        <span className="tabular text-[var(--chalk-2)]">
          {s.ended_at ? formatWat(s.ended_at, "HH:mm") : "—"}
        </span>
      ),
    },
    {
      key: "tag",
      label: "Tag",
      render: (s) => (
        <span className="text-[var(--chalk-1)]">
          {s.vmix_session_tag ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (s) => (
        <StatusPill status={s.ended_at ? "ended" : "live"} />
      ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (s) => (
        <div className="flex justify-end gap-3 text-xs font-semibold uppercase tracking-[0.18em]">
          <Link
            href={`/admin/broadcast/${s.id}`}
            className="text-[var(--chalk-2)] hover:text-[var(--signal)]"
            data-testid={`resume-${s.id}`}
          >
            Open
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Broadcast"
        title="Stream control"
        description="Start a stream session against a scheduled match day, then trigger overlays from its control panel. vMix browser sources point at /overlay/<key>?session=<id>."
      />

      <form
        method="get"
        className="flex flex-col gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 md:flex-row md:items-end"
      >
        <div className="flex-1">
          <label
            htmlFor="matchDayId"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]"
          >
            Match day
          </label>
          <select
            id="matchDayId"
            name="matchDayId"
            defaultValue={selectedId}
            data-testid="match-day-picker"
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-sm text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
          >
            {matchDays.length === 0 ? (
              <option value="">— no match days in window —</option>
            ) : null}
            {matchDays.map((d) => (
              <option key={d.id} value={d.id}>
                {formatWat(`${d.match_date}T00:00:00Z`, "EEE MMM d")} ·{" "}
                {d.venue_name} · {d.status}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
        >
          Select
        </button>
      </form>

      {selected ? (
        active ? (
          <div
            className="flex flex-col gap-2 rounded-sm border border-[var(--signal)] bg-[rgba(0,255,136,0.06)] p-5 md:flex-row md:items-center md:justify-between"
            data-testid="active-session-card"
          >
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--signal)]">
                Active session
              </div>
              <div className="mt-1 font-display text-lg text-[var(--chalk-0)]">
                Started {formatWat(active.started_at, "HH:mm")} WAT
              </div>
              <div className="text-xs text-[var(--chalk-2)]">
                Tag: {active.vmix_session_tag ?? "—"}
              </div>
            </div>
            <Link
              href={`/admin/broadcast/${active.id}`}
              data-testid="resume-active"
            >
              <PrimaryButton>Resume session</PrimaryButton>
            </Link>
          </div>
        ) : (
          <form action={startSessionAction}>
            <input type="hidden" name="matchDayId" value={selected.id} />
            <div className="flex flex-col gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 md:flex-row md:items-end">
              <div className="flex-1">
                <label
                  htmlFor="tag"
                  className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]"
                >
                  Session tag (optional)
                </label>
                <input
                  id="tag"
                  name="tag"
                  placeholder="e.g. MD-08 main output"
                  className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-sm text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
                />
              </div>
              <PrimaryButton type="submit" data-testid="start-session-btn">
                Start stream session
              </PrimaryButton>
            </div>
          </form>
        )
      ) : null}

      {selected ? (
        <div className="space-y-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
            Past sessions · this match day
          </h2>
          <DataTable
            columns={cols}
            rows={past.filter((s) => !active || s.id !== active.id)}
            rowKey={(s) => s.id}
            emptyLabel="No prior sessions"
            emptyHint="Nothing recorded for this match day yet."
          />
        </div>
      ) : null}
    </div>
  );
}
