"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { approveSubmission, rejectSubmission } from "@/server/squads";
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
