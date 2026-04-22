"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  approveSubmission,
  rejectSubmission,
  acceptFcdbCandidate,
} from "@/server/squads";
import type { Actor } from "@/perms";

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
  revalidatePath(`/admin/squads/${submissionId}`);
  revalidatePath("/admin/squads");
  redirect(`/admin/squads/${submissionId}`);
}

export async function rejectAction(formData: FormData): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!submissionId) throw new Error("missing submissionId");
  const sb = await getServerSupabase();
  const actor = await loadActor(sb);
  await rejectSubmission(sb, actor, submissionId, reason);
  revalidatePath(`/admin/squads/${submissionId}`);
  revalidatePath("/admin/squads");
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
