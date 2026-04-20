"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { createMatch } from "@/server/matches/matches";
import { enterResult, editResult, confirmResult } from "@/server/matches/results";

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

export async function addFixtureAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const homePlayerId = String(formData.get("homePlayerId") ?? "");
  const awayPlayerId = String(formData.get("awayPlayerId") ?? "");
  const scheduledTime = formData.get("scheduledTime")
    ? String(formData.get("scheduledTime"))
    : undefined;

  const sb = getServiceRoleSupabase();
  await createMatch(sb, { matchDayId, homePlayerId, awayPlayerId, scheduledTime });
  revalidatePath(`/admin/match-days/${matchDayId}`);
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
