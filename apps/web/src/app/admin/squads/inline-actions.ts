"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { approveSubmission, rejectSubmission } from "@/server/squads";
import {
  publishSquadStatusChanged,
  publishSquadChanged,
} from "@/server/squads/realtime";
import { revalidateSquadSurfaces } from "@/server/squads/revalidate";
import { notify } from "@/server/notifications";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import type { Actor } from "@/perms";

async function loadActor(
  sb: Awaited<ReturnType<typeof getServerSupabase>>,
): Promise<Actor> {
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .single();
  if (!pub) throw new Error("no public user row");
  const { data: roles } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  return {
    userId: pub.id,
    roles: (roles ?? []).map((r: { role: string }) => r.role),
  };
}

async function pingPlayerAfterReview(
  submissionId: string,
  status: "approved" | "rejected",
): Promise<{
  playerId: string;
  matchDayId: string | null;
  weekStartDate: string;
} | null> {
  try {
    const svc = getServiceRoleSupabase();
    const { data } = await svc
      .from("squad_submissions")
      .select("player_id, week_start_date, match_day_id, season_id")
      .eq("id", submissionId)
      .maybeSingle();
    const row = data as
      | {
          player_id: string;
          week_start_date: string;
          match_day_id: string | null;
          season_id: string | null;
        }
      | null;
    if (!row) return null;
    await publishSquadStatusChanged(svc, {
      submissionId,
      playerId: row.player_id,
      weekStartDate: row.week_start_date,
      status,
    });
    if (row.season_id) {
      try {
        await publishSquadChanged(svc, {
          seasonId: row.season_id,
          playerId: row.player_id,
          matchDayId: row.match_day_id,
          weekStartDate: row.week_start_date,
          submissionId,
        });
      } catch {
        // best-effort
      }
    }
    return {
      playerId: row.player_id,
      matchDayId: row.match_day_id,
      weekStartDate: row.week_start_date,
    };
  } catch {
    return null;
  }
}

async function resolveSubmissionOwnerUserId(
  svc: ReturnType<typeof getServiceRoleSupabase>,
  submissionId: string,
): Promise<{ userId: string; weekStartDate: string | null } | null> {
  const { data } = await svc
    .from("squad_submissions")
    .select(
      "week_start_date, player:players!squad_submissions_player_id_fkey(user_id)",
    )
    .eq("id", submissionId)
    .is("deleted_at", null)
    .maybeSingle();
  const row = data as
    | {
        week_start_date: string | null;
        player: { user_id: string } | { user_id: string }[] | null;
      }
    | null;
  if (!row) return null;
  const playerRel = row.player;
  const userId = Array.isArray(playerRel)
    ? playerRel[0]?.user_id
    : playerRel?.user_id;
  if (!userId) return null;
  return { userId, weekStartDate: row.week_start_date };
}

function listRedirectTarget(formData: FormData): string {
  const week = String(formData.get("weekStart") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const params = new URLSearchParams();
  if (week) params.set("week", week);
  if (status) params.set("status", status);
  const qs = params.toString();
  return qs ? `/admin/squads?${qs}` : "/admin/squads";
}

/**
 * Inline approve from the list page. Same business path as the detail
 * page action but redirects back to the list (preserving week+status
 * filter) so admins can rip through a queue without context switching.
 */
export async function inlineApproveAction(formData: FormData): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  if (!submissionId) throw new Error("missing submissionId");
  const sb = await getServerSupabase();
  const actor = await loadActor(sb);
  const limited = await enforceAuthedWrite(actor.userId as string);
  if (limited) throw new Error("rate_limited");
  await approveSubmission(sb, actor, submissionId);
  const subContext = await pingPlayerAfterReview(submissionId, "approved");

  try {
    const svc = getServiceRoleSupabase();
    const owner = await resolveSubmissionOwnerUserId(svc, submissionId);
    if (owner) {
      const weekLabel = owner.weekStartDate ?? "this week";
      await notify(svc, {
        userId: owner.userId,
        kind: "squad_approved",
        title: "Squad approved",
        body: `Your squad for week ${weekLabel} has been approved by a referee. You're locked in for the match day.`,
        href: "/player/squad",
        metadata: { submissionId, weekStartDate: owner.weekStartDate },
      });
    }
  } catch (err) {
    console.error(
      `[notifications] inline squad_approved fan-out failed: ${String(err)}`,
    );
  }

  if (subContext) {
    revalidateSquadSurfaces({
      playerId: subContext.playerId,
      matchDayId: subContext.matchDayId,
      submissionId,
    });
  } else {
    revalidatePath(`/admin/squads/${submissionId}`);
    revalidatePath("/admin/squads");
    revalidatePath("/player/squad");
  }
  redirect(listRedirectTarget(formData));
}

/**
 * Inline reject from the list page. Reason captured client-side via a
 * browser prompt() so the admin never leaves the queue. Server still
 * enforces non-empty reason (rejectSubmission throws ValidationError).
 */
export async function inlineRejectAction(formData: FormData): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!submissionId) throw new Error("missing submissionId");
  const sb = await getServerSupabase();
  const actor = await loadActor(sb);
  const limited = await enforceAuthedWrite(actor.userId as string);
  if (limited) throw new Error("rate_limited");
  await rejectSubmission(sb, actor, submissionId, reason);
  const subContext = await pingPlayerAfterReview(submissionId, "rejected");

  try {
    const svc = getServiceRoleSupabase();
    const owner = await resolveSubmissionOwnerUserId(svc, submissionId);
    if (owner) {
      const weekLabel = owner.weekStartDate ?? "this week";
      await notify(svc, {
        userId: owner.userId,
        kind: "squad_rejected",
        title: "Squad rejected",
        body: `Your squad for week ${weekLabel} was rejected. Reason: ${reason || "(not provided)"}. Open /player/squad to fix and resubmit before the deadline.`,
        href: "/player/squad",
        metadata: {
          submissionId,
          weekStartDate: owner.weekStartDate,
          reason,
        },
      });
    }
  } catch (err) {
    console.error(
      `[notifications] inline squad_rejected fan-out failed: ${String(err)}`,
    );
  }

  if (subContext) {
    revalidateSquadSurfaces({
      playerId: subContext.playerId,
      matchDayId: subContext.matchDayId,
      submissionId,
    });
  } else {
    revalidatePath(`/admin/squads/${submissionId}`);
    revalidatePath("/admin/squads");
    revalidatePath("/player/squad");
  }
  redirect(listRedirectTarget(formData));
}
