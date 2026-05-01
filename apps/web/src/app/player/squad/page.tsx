import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  getRuleForSeason,
  weekStartThursday,
  thursdayDeadline,
  resolveSquadWindowForMatchDay,
  listSubmissionsForPlayerInSeason,
  getSubmissionForPlayerAndMatchDay,
  getDraft,
  type PlayerSubmissionSummary,
} from "@/server/squads";
import { listMatchDays } from "@/server/matches/match-days";
import { formatWat, weekendStartSaturday, weekendLabel } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { SquadPickerBuilder } from "@/components/squads/SquadPickerBuilder";
import { SquadPitchView } from "@/components/squads/SquadPitchView";
import { PlayerSquadLiveRefresh } from "@/components/player/PlayerSquadLiveRefresh";
import {
  SquadMatchDayPicker,
  type SquadMatchDayPickerItem,
} from "@/components/player/SquadMatchDayPicker";
import {
  requestUploadUrlAction,
  submitPickerAction,
} from "./actions";
import { saveSquadDraftAction } from "./draft-actions";

export const dynamic = "force-dynamic";

/**
 * Plan 56 — `/player/squad` shows EVERY match day in the active season as a
 * row in a picker. Players can:
 *   - Click a past/current match day they've submitted for → read-only
 *     <SquadPitchView />.
 *   - Click an open (window force-opened OR pre-deadline) match day they
 *     have NOT submitted for → <SquadPickerBuilder /> targeting that match
 *     day.
 *   - Click a closed match day they did not submit for → "Window closed"
 *     info card.
 *   - Click an upcoming match day not yet open → "Not open yet" info card.
 *
 * The `?matchDay=<id>` query param scopes to a single match day. Without it
 * the page renders the bucketed picker (Past / This week / Upcoming).
 *
 * The Thursday deadline + Friday change window logic is unchanged. The
 * weekly resolver only fires when a match day is ambient (not force-opened
 * by an admin); admins reopen specific match days via /admin/squads.
 */

type ResolvedRow = {
  matchDayId: string;
  matchDate: string;
  venueName: string;
  reason: string;
  isOpen: boolean;
  submission: PlayerSubmissionSummary | null;
};

export default async function PlayerSquadPage({
  searchParams,
}: {
  searchParams?: Promise<{ matchDay?: string }>;
}) {
  const sp: { matchDay?: string } = searchParams ? await searchParams : {};
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/player/squad");

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .single();
  if (!pub) redirect("/login?next=/player/squad");

  const { data: player } = await sb
    .from("players")
    .select("id")
    .eq("user_id", pub.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!player) {
    return (
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Squad"
          title="My squads"
          description="You do not have a player profile linked to your account yet. Contact an admin."
        />
      </div>
    );
  }

  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();

  if (!season?.id) {
    return (
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Squad"
          title="My squads"
          description="No active season — once an admin marks a season active you'll see your match days here."
        />
      </div>
    );
  }

  const now = new Date();
  const todayWeekStart = weekStartThursday(now);
  const svc = getServiceRoleSupabase();

  // Load every match day for the active season + the player's submissions
  // in parallel. Match days come back sorted DESC; we'll re-sort ASC for
  // the player view (chronological reads more naturally for a player
  // browsing the season).
  const [days, submissionMap] = await Promise.all([
    listMatchDays(svc, season.id),
    listSubmissionsForPlayerInSeason(svc, player.id, season.id),
  ]);
  const sortedDays = [...days].sort((a, b) =>
    a.match_date < b.match_date ? -1 : a.match_date > b.match_date ? 1 : 0,
  );

  // Resolve window state for each match day. Each call hits Supabase but
  // they're independent — Promise.all keeps the page render wall-clock low.
  const resolved: ResolvedRow[] = await Promise.all(
    sortedDays.map(async (d) => {
      const r = await resolveSquadWindowForMatchDay(svc, d.id, { now });
      const direct = submissionMap.get(d.id);
      const legacy = submissionMap.get(`week:${weekStartThursday(d.match_date)}`);
      return {
        matchDayId: d.id,
        matchDate: d.match_date,
        venueName: d.venue_name,
        reason: r.reason,
        isOpen: r.open,
        submission: direct ?? legacy ?? null,
      };
    }),
  );

  // Per-match-day rule for the picker totals bar.
  let rule = null;
  try {
    const raw = await getRuleForSeason(sb, season.id);
    if (raw) {
      rule = {
        maxBudgetCoins: raw.max_budget_coins,
        minNigerianItems: raw.min_nigerian_items,
        bannedItemTypes: raw.banned_item_types,
      };
    }
  } catch {
    rule = null;
  }

  // Selected match day mode — render the detail view (submission OR picker
  // OR closed-info).
  const selected = sp.matchDay
    ? resolved.find((r) => r.matchDayId === sp.matchDay) ?? null
    : null;

  if (selected) {
    // Fetch the live submission's items only when one exists. This avoids
    // pulling 13 weeks worth of items on the picker view.
    const subWithItems = selected.submission
      ? await getSubmissionForPlayerAndMatchDay(
          svc,
          player.id,
          selected.matchDayId,
          weekStartThursday(selected.matchDate),
        )
      : null;

    const matchDayWeekStart = weekStartThursday(selected.matchDate);

    // Picker autosave hydration — only relevant when we'll mount the
    // picker (open match day, no live submission). Fetch via the service
    // role client because squad_drafts.player_id points at users.id and
    // the draft row may be queried before any RLS policy is added.
    let initialDraft = null;
    if (!subWithItems && selected.isOpen) {
      try {
        initialDraft = await getDraft(
          svc,
          pub.id,
          matchDayWeekStart,
          selected.matchDayId,
        );
      } catch {
        initialDraft = null;
      }
    }

    return (
      <div className="space-y-6">
        <PlayerSquadLiveRefresh
          playerId={player.id}
          weekStartDate={todayWeekStart}
        />
        <SectionHeader
          eyebrow={`Match day · ${selected.matchDate}`}
          title={`Squad for ${selected.matchDate}`}
          description={`Venue: ${selected.venueName}. Deadline: Thursday ${formatWat(thursdayDeadline(matchDayWeekStart), "HH:mm")} WAT (${matchDayWeekStart}).`}
        />
        <div>
          <Link
            href="/player/squad"
            className="inline-flex items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
            data-testid="squad-md-back-link"
          >
            ← Back to all match days
          </Link>
        </div>

        {subWithItems ? (
          <section
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
            data-testid="squad-existing-summary"
          >
            <div className="flex items-center gap-3">
              <StatusPill status={subWithItems.submission.validation_status} />
              <span className="text-xs text-[var(--chalk-2)]">
                Submitted{" "}
                {formatWat(
                  subWithItems.submission.submitted_at,
                  "yyyy-MM-dd HH:mm",
                )}{" "}
                WAT
              </span>
            </div>
            {subWithItems.submission.rejection_reason ? (
              <p className="mt-3 text-sm text-[var(--flare)]">
                Rejection reason: {subWithItems.submission.rejection_reason}
              </p>
            ) : null}
            <div className="mt-4">
              <SquadPitchView items={subWithItems.items} />
            </div>
          </section>
        ) : selected.isOpen ? (
          <section data-testid="squad-match-day-picker">
            <div className="mb-3 rounded-sm border border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.08)] p-3 text-xs text-[var(--chalk-1)]">
              Building squad for match day{" "}
              <span className="font-mono font-semibold text-[var(--chalk-0)]">
                {selected.matchDate}
              </span>{" "}
              · {selected.venueName}.
            </div>
            <SquadPickerBuilder
              weekStartDate={matchDayWeekStart}
              rule={rule}
              matchDayId={selected.matchDayId}
              submitAction={submitPickerAction}
              requestUploadUrlAction={requestUploadUrlAction}
              initialDraft={initialDraft}
              saveDraftAction={saveSquadDraftAction}
            />
          </section>
        ) : selected.matchDate > todayWeekStart ? (
          <section
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6 text-center"
            data-testid="squad-window-not-open-yet"
          >
            <div className="mb-2 font-display text-lg font-bold text-[var(--chalk-0)]">
              Not open yet
            </div>
            <p className="text-sm text-[var(--chalk-2)]">
              Submissions for this match day open by Thursday{" "}
              {formatWat(thursdayDeadline(matchDayWeekStart), "HH:mm")} WAT on{" "}
              <span className="font-mono">{matchDayWeekStart}</span>. Check back
              once an admin opens the window or once the regular weekly cycle
              reaches this match day.
            </p>
          </section>
        ) : (
          <section
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6 text-center"
            data-testid="squad-window-closed"
          >
            <div className="mb-2 font-display text-lg font-bold text-[var(--chalk-0)]">
              Squad window closed
            </div>
            <p className="text-sm text-[var(--chalk-2)]">
              The submission deadline for this match day has passed. If you
              missed it, contact an admin to reopen submissions for you.
            </p>
          </section>
        )}
      </div>
    );
  }

  // List view — bucket every match day into past / this_week / upcoming so
  // the player's "next squad to file" sits in the most prominent group.
  const matchDayItems: SquadMatchDayPickerItem[] = resolved.map((r) => {
    const weekAnchor = weekStartThursday(r.matchDate);
    const bucket: SquadMatchDayPickerItem["bucket"] =
      weekAnchor === todayWeekStart
        ? "this_week"
        : r.matchDate < todayWeekStart
          ? "past"
          : "upcoming";

    let status: SquadMatchDayPickerItem["status"];
    if (r.submission) {
      status = "submitted";
    } else if (r.isOpen) {
      status = "open";
    } else if (bucket === "upcoming") {
      // Future match day with no live submission and no open window — the
      // weekly cycle will roll round to it eventually.
      status = "upcoming";
    } else {
      status = "closed";
    }

    return {
      matchDayId: r.matchDayId,
      matchDate: r.matchDate,
      venueName: r.venueName,
      status,
      submittedAt: r.submission?.submittedAt ?? null,
      validationStatus: r.submission?.validationStatus ?? null,
      bucket,
    };
  });

  // 2026-04-30 — Aggregate Sat+Sun match days into ONE picker entry per
  // weekend. Players submit ONE squad per weekend (per spec), and Sat+Sun
  // match days in the same Thursday-anchor week share one
  // squad_submissions row by definition. Keep the FIRST match day's id
  // as the click target so existing per-match-day routing still works.
  const byWeekend = new Map<string, SquadMatchDayPickerItem[]>();
  for (const item of matchDayItems) {
    const wkKey = weekendStartSaturday(item.matchDate);
    const arr = byWeekend.get(wkKey) ?? [];
    arr.push(item);
    byWeekend.set(wkKey, arr);
  }
  const items: SquadMatchDayPickerItem[] = [];
  for (const [satYmd, group] of byWeekend) {
    const sorted = [...group].sort((a, b) =>
      a.matchDate < b.matchDate ? -1 : a.matchDate > b.matchDate ? 1 : 0,
    );
    const head = sorted[0];
    if (sorted.length === 1) {
      // Single match in this weekend — render as-is (no displayLabel).
      items.push(head);
      continue;
    }
    // Two or more (Sat+Sun) — collapse. Status precedence: any open row
    // wins, then any submitted row, then any upcoming, fallback to head.
    const pickStatus = (): SquadMatchDayPickerItem["status"] => {
      if (sorted.some((s) => s.status === "open")) return "open";
      if (sorted.some((s) => s.status === "submitted")) return "submitted";
      if (sorted.some((s) => s.status === "upcoming")) return "upcoming";
      return head.status;
    };
    const subRow =
      sorted.find((s) => s.status === "submitted") ?? head;
    items.push({
      ...head,
      status: pickStatus(),
      submittedAt: subRow.submittedAt ?? null,
      validationStatus: subRow.validationStatus ?? null,
      displayLabel: weekendLabel(satYmd, sorted.map((s) => s.matchDate)),
      secondaryMatchDate: sorted[1]?.matchDate ?? null,
    });
  }

  // Find the "this week" match day id for the live-refresh ping.
  const thisWeekItem = items.find((i) => i.bucket === "this_week");

  return (
    <div className="space-y-6">
      <PlayerSquadLiveRefresh
        playerId={player.id}
        weekStartDate={todayWeekStart}
      />
      <SectionHeader
        eyebrow="Squad"
        title="My squads"
        description={`Pick a match day to view your submission or file a new squad. Deadline each match day: Thursday ${formatWat(thursdayDeadline(todayWeekStart), "HH:mm")} WAT.`}
      />
      <SquadMatchDayPicker
        items={items}
        currentMatchDayId={thisWeekItem?.matchDayId ?? null}
      />
    </div>
  );
}
