"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  approveSubmission,
  rejectSubmission,
  acceptFcdbCandidate,
  reopenSubmission,
} from "@/server/squads";
import { publishSquadStatusChanged } from "@/server/squads/realtime";
import { notify } from "@/server/notifications";
import type { Actor } from "@/perms";
import { reopenSubmissionSchema } from "./schemas";

/**
 * Live-refresh (2026-04-24) — fire a `squad.status_changed` broadcast
 * on the player's scoped channel so `/player/squad` updates without
 * a manual reload. Uses the service-role client for the lookup so
 * RLS on squad_submissions doesn't hide the row. Fire-and-forget.
 */
async function pingPlayerAfterReview(
  submissionId: string,
  status: "approved" | "rejected" | "reopened" | "pending",
): Promise<void> {
  try {
    const svc = getServiceRoleSupabase();
    const { data } = await svc
      .from("squad_submissions")
      .select("player_id, week_start_date")
      .eq("id", submissionId)
      .maybeSingle();
    const row = data as
      | { player_id: string; week_start_date: string }
      | null;
    if (!row) return;
    await publishSquadStatusChanged(svc, {
      submissionId,
      playerId: row.player_id,
      weekStartDate: row.week_start_date,
      status,
    });
  } catch {
    // best-effort
  }
}

/**
 * Resolve the owning player's `users.id` for a squad submission. Used to
 * route approve/reject notifications. Returns null if either join is
 * empty (e.g. submission was deleted between the action and the notify).
 */
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

async function loadActor(sb: Awaited<ReturnType<typeof getServerSupabase>>): Promise<Actor> {
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

export async function approveAction(submissionId: string): Promise<void> {
  const sb = await getServerSupabase();
  const actor = await loadActor(sb);
  await approveSubmission(sb, actor, submissionId);
  await pingPlayerAfterReview(submissionId, "approved");

  // Notify the submitting player via the service-role client so the
  // player → user join survives whatever RLS is active on squad_submissions.
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
    console.error(`[notifications] squad_approved fan-out failed: ${String(err)}`);
  }

  revalidatePath(`/admin/squads/${submissionId}`);
  revalidatePath("/admin/squads");
  revalidatePath("/player/squad");
  redirect(`/admin/squads/${submissionId}`);
}

export async function rejectAction(formData: FormData): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!submissionId) throw new Error("missing submissionId");
  const sb = await getServerSupabase();
  const actor = await loadActor(sb);
  await rejectSubmission(sb, actor, submissionId, reason);
  await pingPlayerAfterReview(submissionId, "rejected");

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
    console.error(`[notifications] squad_rejected fan-out failed: ${String(err)}`);
  }

  revalidatePath(`/admin/squads/${submissionId}`);
  revalidatePath("/admin/squads");
  revalidatePath("/player/squad");
  redirect(`/admin/squads/${submissionId}`);
}

/**
 * Plan 23 — server action invoked from <FcdbBadge> when the ref locks in
 * one of the ambiguous-candidates from the dropdown. Updates the squad
 * item's `resolved_fc_player_id`; audit fires via the existing trigger.
 *
 * Uses service-role for the UPDATE because squad_player_items has no
 * write-side RLS and the user-scoped client may not have the perm to
 * write directly. We still gate via `requirePermAsync(squads.validate)`
 * inside `acceptFcdbCandidate`. We pass the user-scoped client to the
 * perm check so the role lookup uses the same auth context as the
 * other ref actions on this page.
 */
export async function acceptFcdbCandidateAction(
  formData: FormData,
): Promise<void> {
  const itemId = String(formData.get("itemId") ?? "");
  const fcPlayerId = String(formData.get("fcPlayerId") ?? "");
  const submissionId = String(formData.get("submissionId") ?? "");
  if (!itemId || !fcPlayerId) {
    throw new Error("missing itemId or fcPlayerId");
  }
  const sb = await getServerSupabase();
  const actor = await loadActor(sb);
  const svc = getServiceRoleSupabase();
  await acceptFcdbCandidate(svc, actor, itemId, fcPlayerId);
  if (submissionId) revalidatePath(`/admin/squads/${submissionId}`);
}

/**
 * Plan 41 §3.5 — admin reopens a locked squad submission. Flips
 * validation_status back to 'pending' so the player can resubmit, clears
 * validator stamps, and notifies the player (notifications.type =
 * 'squad_reopened'). Redirects back to the same detail page.
 */
export async function reopenSubmissionAction(
  submissionId: string,
): Promise<void> {
  const parsed = reopenSubmissionSchema.parse({ submissionId });
  const sb = await getServerSupabase();
  const actor = await loadActor(sb);
  await reopenSubmission(sb, actor, parsed.submissionId);
  await pingPlayerAfterReview(parsed.submissionId, "reopened");
  revalidatePath(`/admin/squads/${parsed.submissionId}`);
  revalidatePath("/admin/squads");
  revalidatePath("/player/squad");
  redirect(`/admin/squads/${parsed.submissionId}`);
}
