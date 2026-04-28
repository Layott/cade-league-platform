import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  getCurrentWeekSubmissionForPlayer,
  getRuleForSeason,
  weekStartThursday,
  thursdayDeadline,
  resolveSquadWindowForMatchDay,
} from "@/server/squads";
import { listMatchDays } from "@/server/matches/match-days";
import { getCurrentSquadStatus } from "@/server/profile/squadStatus";
import { formatWat } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { SquadPickerBuilder } from "@/components/squads/SquadPickerBuilder";
import { SquadPitchView } from "@/components/squads/SquadPitchView";
import { PlayerSquadLiveRefresh } from "@/components/player/PlayerSquadLiveRefresh";
import {
  requestUploadUrlAction,
  submitPickerAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Plan 30 — player squad page, Futbin-style picker.
 *
 * The page is a server component. If the player already has a live
 * submission for the current week we render a read-only summary — no
 * in-place editing, the Friday change window still uses its own route.
 * Otherwise we mount <SquadPickerBuilder /> with the active rule payload
 * so the totals bar can render budget + Nigerian thresholds.
 */

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
          title="This week's squad"
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

  const weekStart = weekStartThursday(new Date());
  const deadline = thursdayDeadline(weekStart);
  const existing = await getCurrentWeekSubmissionForPlayer(sb, player.id, weekStart);

  // Per-match-day window mode (admin override). Surface every match day
  // whose window resolves to OPEN as a CTA the player can target. The
  // weekly picker below stays as the fallback flow when no match-day
  // override is in effect.
  const svcEarly = getServiceRoleSupabase();
  type OpenMatchDay = {
    id: string;
    matchDate: string;
    venueName: string;
    reason: string;
    isMatchDayForcedOpen: boolean;
  };
  let openMatchDays: OpenMatchDay[] = [];
  let selectedMatchDay: OpenMatchDay | null = null;
  if (season?.id) {
    const days = await listMatchDays(svcEarly, season.id);
    const now = new Date();
    const resolutions = await Promise.all(
      days.map(async (d) => {
        const r = await resolveSquadWindowForMatchDay(svcEarly, d.id, { now });
        return { day: d, resolution: r };
      }),
    );
    openMatchDays = resolutions
      // Only surface match days the admin has explicitly forced OPEN —
      // surfacing every "default open" match day would clutter the UI
      // with the entire upcoming season.
      .filter(({ resolution }) => resolution.reason === "match_day_force_open")
      .map(({ day, resolution }) => ({
        id: day.id,
        matchDate: day.match_date,
        venueName: day.venue_name,
        reason: resolution.reason,
        isMatchDayForcedOpen: true,
      }));

    if (sp.matchDay) {
      const candidate = openMatchDays.find((m) => m.id === sp.matchDay);
      if (candidate) selectedMatchDay = candidate;
    }
  }

  // Load the live rule for the totals bar. Safe against missing season or
  // missing rule row (picker renders with rule=null).
  let rule = null;
  if (season?.id) {
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
  }

  // Plan 10 + Plan 41 — squad window gating. If the deadline has
  // passed AND no admin-reopen / change-window is in effect, hide the
  // picker so players can't submit a late squad.
  const svc = getServiceRoleSupabase();
  const submissionStatus = await getCurrentSquadStatus(svc, player.id, new Date());
  const windowOpen =
    submissionStatus.kind === "pre_deadline" ||
    submissionStatus.kind === "reopened_by_admin" ||
    submissionStatus.kind === "friday_change_window";

  // If the player landed via a `?matchDay=<id>` link AND the admin has
  // forced that match day's window open, mount the picker even if the
  // weekly window is otherwise closed. The match-day mode is its own
  // gate; the weekly resolver is bypassed when matchDayId is plumbed in.
  const matchDayPickerOpen = selectedMatchDay !== null;

  // Per-match-day picker: weekStartDate must equal the Thursday anchor of
  // the match day's date (NOT necessarily this week's anchor — admins can
  // open a future or past match day). The submit pipeline accepts the
  // mismatched anchor when matchDayId is supplied.
  const matchDayWeekStart = selectedMatchDay
    ? weekStartThursday(selectedMatchDay.matchDate)
    : weekStart;

  return (
    <div className="space-y-6">
      <PlayerSquadLiveRefresh
        playerId={player.id}
        weekStartDate={weekStart}
      />
      <SectionHeader
        eyebrow={`Week of ${weekStart}`}
        title="This week's squad"
        description={`Deadline: Thursday ${formatWat(deadline, "HH:mm")} WAT (${formatWat(deadline, "yyyy-MM-dd")}).`}
      />

      {openMatchDays.length > 0 && !selectedMatchDay ? (
        <section
          className="rounded-sm border border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.06)] p-4"
          data-testid="squad-match-day-ctas"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--signal)]">
            Submission open by match day
          </div>
          <p className="mt-1 text-xs text-[var(--chalk-2)]">
            An admin has opened squad submissions for the match day(s) below.
            Select one to file a squad targeted at that match day.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {openMatchDays.map((md) => (
              <li
                key={md.id}
                data-testid={`squad-match-day-cta-${md.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3"
              >
                <div>
                  <div className="font-display text-sm font-semibold text-[var(--chalk-0)]">
                    {md.matchDate}
                  </div>
                  <div className="text-[11px] text-[var(--chalk-2)]">
                    {md.venueName}
                  </div>
                </div>
                <a
                  href={`/player/squad?matchDay=${encodeURIComponent(md.id)}`}
                  className="inline-flex items-center justify-center rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--primary-ink)] transition-colors hover:bg-[#82e21a]"
                >
                  Submit squad for this match day
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {existing ? (
        <section
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
          data-testid="squad-existing-summary"
        >
          <div className="flex items-center gap-3">
            <StatusPill status={existing.submission.validation_status} />
            <span className="text-xs text-[var(--chalk-2)]">
              Submitted {formatWat(existing.submission.submitted_at, "yyyy-MM-dd HH:mm")} WAT
            </span>
          </div>
          {existing.submission.rejection_reason ? (
            <p className="mt-3 text-sm text-[var(--flare)]">
              Rejection reason: {existing.submission.rejection_reason}
            </p>
          ) : null}
          <div className="mt-4">
            <SquadPitchView items={existing.items} />
          </div>
        </section>
      ) : selectedMatchDay ? (
        <section data-testid="squad-match-day-picker">
          <div className="mb-3 rounded-sm border border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.08)] p-3 text-xs text-[var(--chalk-1)]">
            Building squad for match day{" "}
            <span className="font-mono font-semibold text-[var(--chalk-0)]">
              {selectedMatchDay.matchDate}
            </span>{" "}
            · {selectedMatchDay.venueName}.{" "}
            <a
              href="/player/squad"
              className="underline-offset-2 hover:underline"
            >
              Cancel
            </a>
          </div>
          <SquadPickerBuilder
            weekStartDate={matchDayWeekStart}
            rule={rule}
            submitAction={(payload) =>
              submitPickerAction({
                ...payload,
                matchDayId: selectedMatchDay!.id,
              })
            }
            requestUploadUrlAction={requestUploadUrlAction}
          />
        </section>
      ) : !windowOpen && !matchDayPickerOpen ? (
        <section
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6 text-center"
          data-testid="squad-window-closed"
        >
          <div className="mb-2 font-display text-lg font-bold text-[var(--chalk-0)]">
            Squad window closed
          </div>
          <p className="text-sm text-[var(--chalk-2)]">
            {submissionStatus.kind === "window_closed"
              ? "This week's deadline has passed. Contact an admin to reopen submission for you."
              : "Submission is not accepting new squads right now."}
          </p>
        </section>
      ) : (
        <SquadPickerBuilder
          weekStartDate={weekStart}
          rule={rule}
          submitAction={submitPickerAction}
          requestUploadUrlAction={requestUploadUrlAction}
        />
      )}
    </div>
  );
}
