"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  createMatch,
  editMatch,
  softDeleteMatch,
} from "@/server/matches/matches";
import { enterResult, editResult, confirmResult } from "@/server/matches/results";
import { requirePermAsync } from "@/lib/perms-db";

async function currentPublicUserId(): Promise<string> {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) throw new Error("not authenticated");
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) throw new Error("public.users row missing");
  return pub.id;
}

async function requireMatchEditPerm(): Promise<{ userId: string }> {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) throw new Error("not authenticated");
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) throw new Error("public.users row missing");
  const { data: roleRows } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  await requirePermAsync(svc, { userId: pub.id, roles }, "matches.edit");
  return { userId: pub.id };
}

export async function addFixtureAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const homePlayerId = String(formData.get("homePlayerId") ?? "");
  const awayPlayerId = String(formData.get("awayPlayerId") ?? "");
  const scheduledTime = formData.get("scheduledTime")
    ? String(formData.get("scheduledTime"))
    : undefined;

  await requireMatchEditPerm();
  const sb = getServiceRoleSupabase();
  await createMatch(sb, { matchDayId, homePlayerId, awayPlayerId, scheduledTime });
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/fixtures");
}

export async function addMatchAction(formData: FormData) {
  // Alias of addFixtureAction kept for naming consistency with editMatchAction
  // / removeMatchAction. The match-day detail page uses both names; tests
  // and any future call sites can pick either.
  return addFixtureAction(formData);
}

export async function editMatchAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const homePlayerId = String(formData.get("homePlayerId") ?? "");
  const awayPlayerId = String(formData.get("awayPlayerId") ?? "");

  await requireMatchEditPerm();
  const sb = getServiceRoleSupabase();
  await editMatch(sb, { matchId, homePlayerId, awayPlayerId });
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/fixtures");
}

export async function removeMatchAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");

  await requireMatchEditPerm();
  const sb = getServiceRoleSupabase();
  await softDeleteMatch(sb, { matchId });
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/fixtures");
}

export async function enterResultAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const resultType = (formData.get("resultType") ?? "normal") as
    | "normal"
    | "forfeit"
    | "void";

  const sb = getServiceRoleSupabase();
  const actor = await currentPublicUserId();
  await enterResult(
    sb,
    {
      matchId,
      homeScore: Number(formData.get("homeScore") ?? 0),
      awayScore: Number(formData.get("awayScore") ?? 0),
      homePossession: formData.get("homePossession")
        ? Number(formData.get("homePossession"))
        : undefined,
      awayPossession: formData.get("awayPossession")
        ? Number(formData.get("awayPossession"))
        : undefined,
      resultType,
      notes: formData.get("notes") ? String(formData.get("notes")) : undefined,
    },
    actor
  );
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/standings");
  revalidatePath("/fixtures");
}

export async function editResultAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const resultType = (formData.get("resultType") ?? "normal") as
    | "normal"
    | "forfeit"
    | "void";

  const sb = getServiceRoleSupabase();
  await editResult(sb, {
    matchId,
    homeScore: Number(formData.get("homeScore") ?? 0),
    awayScore: Number(formData.get("awayScore") ?? 0),
    homePossession: formData.get("homePossession")
      ? Number(formData.get("homePossession"))
      : undefined,
    awayPossession: formData.get("awayPossession")
      ? Number(formData.get("awayPossession"))
      : undefined,
    resultType,
    notes: formData.get("notes") ? String(formData.get("notes")) : undefined,
  });
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/standings");
}

export async function confirmResultAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const sb = getServiceRoleSupabase();
  const actor = await currentPublicUserId();
  await confirmResult(sb, { matchId }, actor);
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/standings");
  revalidatePath("/fixtures");
}

export async function backToList() {
  redirect("/admin/match-days");
}
