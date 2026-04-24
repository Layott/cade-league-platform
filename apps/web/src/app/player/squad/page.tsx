import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  getCurrentWeekSubmissionForPlayer,
  getRuleForSeason,
  weekStartThursday,
  thursdayDeadline,
} from "@/server/squads";
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

export default async function PlayerSquadPage() {
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
      ) : !windowOpen ? (
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
