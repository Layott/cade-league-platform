import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import {
  listSubmissionsForWeek,
  weekStartThursday,
  getSquadWindowOverride,
  getMatchDayWindow,
  resolveSquadWindowForMatchDay,
  listPlayerSquadOverridesForWeek,
  getMatchDayScheduleOverride,
  thursdayDeadline,
  fridayWindowBounds,
  type SubmissionRow,
  type PlayerSquadOverride,
} from "@/server/squads";
import { listMatchDays } from "@/server/matches/match-days";
import { formatWat } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { SecondaryButton } from "@/components/admin/buttons";
import { SquadWindowControls } from "@/components/admin/SquadWindowControls";
import {
  SquadMatchDayWindowControls,
  type AdminMatchDayRow,
} from "@/components/admin/SquadMatchDayWindowControls";
import {
  ScheduleOverrideControls,
  type ScheduleOverrideRow,
} from "@/components/admin/ScheduleOverrideControls";
import { PlayerOverrideControls } from "@/components/admin/PlayerOverrideControls";
import { SquadSubmissionsLiveRefresh } from "@/components/admin/SquadSubmissionsLiveRefresh";
import { InlineSubmissionDecision } from "@/components/admin/InlineSubmissionDecision";
import {
  forceOpenSquadWindowAction,
  forceCloseSquadWindowAction,
  clearSquadWindowOverrideAction,
} from "./window-actions";
import {
  inlineApproveAction,
  inlineRejectAction,
} from "./inline-actions";
import {
  setMatchDayWindowAction,
  clearMatchDayWindowAction,
} from "./match_day_window_actions";
import {
  setScheduleOverrideAction,
  clearScheduleOverrideAction,
} from "./schedule-override-actions";
import {
  banPlayerForWeekAction,
  forceOpenPlayerForWeekAction,
  clearPlayerOverrideAction,
} from "./player-override-actions";
import type { Actor } from "@/perms";

export const dynamic = "force-dynamic";

type StatusFilter = "all" | "pending" | "approved" | "rejected";

export default async function AdminSquadsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; week?: string; matchDay?: string }>;
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
  const matchDayFilter = (sp.matchDay ?? "all").trim();

  const rows: SubmissionRow[] = season
    ? await listSubmissionsForWeek(sb, season.id, weekStart, {
        status: status === "all" ? undefined : status,
        matchDayId:
          matchDayFilter === "all"
            ? undefined
            : matchDayFilter === "none"
              ? "none"
              : matchDayFilter,
      })
    : [];

  // Resolve viewer + perm check for the window-override controls.
  const { data: auth } = await sb.auth.getUser();
  let actor: Actor = { userId: null, roles: [] };
  if (auth.user) {
    const { data: pub } = await sb
      .from("users")
      .select("id")
      .eq("supabase_auth_id", auth.user.id)
      .maybeSingle();
    if (pub) {
      const { data: roleRows } = await sb
        .from("user_roles")
        .select("role")
        .eq("user_id", pub.id)
        .is("deleted_at", null);
      actor = { userId: pub.id, roles: (roleRows ?? []).map((r: { role: string }) => r.role) };
    }
  }
  const svc = getServiceRoleSupabase();
  const canManageWindow = await hasPermAsync(svc, actor, "squads.window.manage");
  const canManagePlayerOverride = await hasPermAsync(
    svc,
    actor,
    "squads.player_override.manage",
  );
  const canValidate = await hasPermAsync(svc, actor, "squads.validate");
  const [squadWindowOverride, playerOverrides, allPlayers] = await Promise.all([
    canManageWindow ? getSquadWindowOverride(svc, weekStart) : Promise.resolve(null),
    canManagePlayerOverride
      ? listPlayerSquadOverridesForWeek(svc, weekStart)
      : Promise.resolve([] as PlayerSquadOverride[]),
    canManagePlayerOverride && season
      ? svc
          .from("players")
          .select("id, gamer_tag, users:users!players_user_id_fkey(display_name)")
          .is("deleted_at", null)
          .order("gamer_tag", { ascending: true })
          .then(({ data, error }) => {
            if (error) throw new Error(`players list: ${error.message}`);
            type R = {
              id: string;
              gamer_tag: string;
              users: { display_name: string | null } | null;
            };
            return (data ?? []) as unknown as R[];
          })
      : Promise.resolve([] as Array<{
          id: string;
          gamer_tag: string;
          users: { display_name: string | null } | null;
        }>),
  ]);
  const playerOverrideByPlayerId = new Map(
    playerOverrides.map((o) => [o.playerId, o]),
  );
  const submittedPlayerIds = new Set(rows.map((r) => r.player_id));

  // Match days for the current season — used by both the per-match-day
  // override panel (perm-gated) AND the always-on Match Day filter
  // dropdown above the submissions table. Cheap (~13 rows / season).
  const allMatchDays = season ? await listMatchDays(svc, season.id) : [];

  // Filter options: only match days that fall inside the currently
  // selected week (Thursday-anchor → next Wednesday). The list view is
  // already week-scoped, so showing every season match day in the
  // dropdown would just produce no-op selections.
  const weekMatchDays = allMatchDays.filter(
    (d) => weekStartThursday(d.match_date) === weekStart,
  );

  // Per-match-day override panel data. Only build when the user has the
  // window perm — same gate as the weekly panel.
  let matchDayRows: AdminMatchDayRow[] = [];
  let scheduleOverrideRows: ScheduleOverrideRow[] = [];
  if (canManageWindow && season) {
    const days = allMatchDays;
    const now = new Date();
    const both = await Promise.all(
      days.map(async (d) => {
        const [override, resolution, scheduleOverride] = await Promise.all([
          getMatchDayWindow(svc, d.id),
          resolveSquadWindowForMatchDay(svc, d.id, { now }),
          getMatchDayScheduleOverride(svc, d.id),
        ]);
        const ws = weekStartThursday(d.match_date);
        const friday = fridayWindowBounds(ws);
        return {
          windowRow: {
            id: d.id,
            matchDate: d.match_date,
            venueName: d.venue_name,
            status: d.status,
            matchCount: d.match_count,
            override,
            resolvedOpen: resolution.open,
            resolvedReason: resolution.reason,
          } satisfies AdminMatchDayRow,
          scheduleRow: {
            id: d.id,
            matchDate: d.match_date,
            venueName: d.venue_name,
            status: d.status,
            matchCount: d.match_count,
            weekStart: ws,
            override: scheduleOverride,
            defaultSubmissionOpenAt: null,
            defaultSubmissionDeadlineAt: thursdayDeadline(ws).toISOString(),
            defaultChangeWindowOpenAt: friday.openAt.toISOString(),
            defaultChangeWindowCloseAt: friday.closeAt.toISOString(),
          } satisfies ScheduleOverrideRow,
        };
      }),
    );
    matchDayRows = both.map((b) => b.windowRow);
    scheduleOverrideRows = both.map((b) => b.scheduleRow);
  }

  // Plan 56 — when any submission in the list is stamped with a
  // match_day_id, fetch the match days in one round-trip + build a
  // {match_day_id → match_date} map so the table can show "Match day:
  // YYYY-MM-DD" inline. Cheap because match-days/season is bounded (~13).
  const matchDayIds = Array.from(
    new Set(rows.map((r) => r.match_day_id).filter((v): v is string => !!v)),
  );
  let matchDayDates = new Map<string, string>();
  if (matchDayIds.length > 0) {
    const { data: mdRows } = await svc
      .from("match_days")
      .select("id, match_date")
      .in("id", matchDayIds)
      .is("deleted_at", null);
    matchDayDates = new Map(
      (
        (mdRows ?? []) as Array<{ id: string; match_date: string }>
      ).map((r) => [r.id, r.match_date]),
    );
  }

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
      key: "match_day",
      label: "Match day",
      render: (r) =>
        r.match_day_id ? (
          <span
            className="font-mono text-[11px] tabular text-[var(--primary)]"
            data-testid={`squad-row-md-${r.id}`}
          >
            {matchDayDates.get(r.match_day_id) ?? r.match_day_id.slice(0, 8)}
          </span>
        ) : (
          <span className="font-mono text-[11px] text-[var(--chalk-3)]">
            —
          </span>
        ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusPill status={r.validation_status} />,
    },
    ...(canManagePlayerOverride
      ? [
          {
            key: "override",
            label: "Override",
            render: (r: SubmissionRow) => (
              <div className="relative inline-block">
                <PlayerOverrideControls
                  playerId={r.player_id}
                  playerLabel={r.player?.display_name ?? r.player_id.slice(0, 8)}
                  weekStart={weekStart}
                  override={playerOverrideByPlayerId.get(r.player_id) ?? null}
                  banPlayer={banPlayerForWeekAction}
                  forceOpenPlayer={forceOpenPlayerForWeekAction}
                  clearPlayerOverride={clearPlayerOverrideAction}
                />
              </div>
            ),
          } satisfies DataTableColumn<SubmissionRow>,
        ]
      : []),
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (r) => (
        <div className="flex items-center justify-end gap-3">
          {canValidate && r.validation_status === "pending" ? (
            <InlineSubmissionDecision
              submissionId={r.id}
              weekStart={weekStart}
              status={status}
              approveAction={inlineApproveAction}
              rejectAction={inlineRejectAction}
            />
          ) : null}
          <Link
            href={`/admin/squads/${r.id}`}
            className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
          >
            Review
          </Link>
        </div>
      ),
    },
  ];

  // Players who have NOT submitted this week — admin may want to ban one
  // preemptively (e.g. under investigation) or force-open for one who's
  // had a genuine access issue.
  const nonSubmittedPlayers = canManagePlayerOverride
    ? allPlayers.filter((p) => !submittedPlayerIds.has(p.id))
    : [];

  return (
    <div className="space-y-8">
      <SquadSubmissionsLiveRefresh weekStartDate={weekStart} />
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

      {canManageWindow ? (
        <SquadWindowControls
          weekStart={weekStart}
          override={squadWindowOverride}
          forceOpen={forceOpenSquadWindowAction}
          forceClose={forceCloseSquadWindowAction}
          clearOverride={clearSquadWindowOverrideAction}
        />
      ) : null}

      {canManageWindow ? (
        <SquadMatchDayWindowControls
          rows={matchDayRows}
          setAction={setMatchDayWindowAction}
          clearAction={clearMatchDayWindowAction}
        />
      ) : null}

      {canManageWindow ? (
        <ScheduleOverrideControls
          rows={scheduleOverrideRows}
          setAction={setScheduleOverrideAction}
          clearAction={clearScheduleOverrideAction}
        />
      ) : null}

      <form method="GET" className="flex flex-wrap items-center gap-3">
        <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
          Status
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
        <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
          Match day
        </label>
        <select
          name="matchDay"
          defaultValue={matchDayFilter}
          data-testid="squad-match-day-filter"
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-xs text-[var(--chalk-0)]"
        >
          <option value="all">All</option>
          {weekMatchDays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.match_date}
              {d.venue_name ? ` · ${d.venue_name}` : ""}
            </option>
          ))}
          <option value="none">Legacy (no match day)</option>
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
