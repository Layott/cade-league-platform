"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  createMatch,
  editMatch,
  reorderMatches,
  softDeleteMatch,
} from "@/server/matches/matches";
import {
  publishMatchDay,
  unpublishMatchDay,
} from "@/server/matches/match-days";
import { enterResult, editResult, confirmResult } from "@/server/matches/results";
import { requirePermAsync } from "@/lib/perms-db";
import { syncScoreToLiveSessions } from "@/server/broadcast/match_sync";

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
  return requirePermInline("matches.edit");
}

async function requirePermInline(perm: string): Promise<{ userId: string; roles: string[] }> {
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
  await requirePermAsync(svc, { userId: pub.id, roles }, perm);
  return { userId: pub.id, roles };
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

/**
 * Slice 2 of the leaderboard / broadcast linking audit: after the match
 * result is persisted, if the same match is currently pinned to a live
 * stream session slot (primary or secondary), bridge the just-entered
 * absolute score into the on-air score_bug overlay via Supabase Realtime.
 * No-op when the match isn't live. Failures are swallowed so a
 * transient realtime/broadcast issue can't block the core score-entry
 * write. See `apps/web/src/server/broadcast/match_sync.ts`.
 */
async function bridgeScoreToBroadcast(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  matchId: string,
  actorUserId: string,
  resultType: "normal" | "forfeit" | "void",
) {
  if (resultType === "void") {
    // Voided matches shouldn't overwrite the live bug — the match is
    // disqualified, not scored. Broadcast operators decide what to show.
    return;
  }
  try {
    // Read the persisted row so we sync the POST-NORMALIZATION score
    // (forfeit auto-rewrites to 3-0 in results.ts).
    const { data, error } = await sb
      .from("match_results")
      .select("home_score, away_score")
      .eq("match_id", matchId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return;
    const row = data as { home_score: number; away_score: number };
    await syncScoreToLiveSessions(
      sb,
      matchId,
      row.home_score,
      row.away_score,
      actorUserId,
    );
  } catch (err) {
    // Best-effort — never block the score-entry action on broadcast sync.
    console.error("bridgeScoreToBroadcast failed", err);
  }
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
  await bridgeScoreToBroadcast(sb, matchId, actor, resultType);
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
  // editResult doesn't take an actor — currentPublicUserId handles it.
  const actor = await currentPublicUserId();
  await bridgeScoreToBroadcast(sb, matchId, actor, resultType);
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

// Plan 27 — publish a match day to the public /fixtures page.
export async function publishMatchDayAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const { userId, roles } = await requirePermInline("match_days.publish");
  const sb = getServiceRoleSupabase();
  await publishMatchDay(sb, { userId, roles }, matchDayId);
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/admin/match-days");
  revalidatePath("/fixtures");
}

// Plan 27 — withdraw a published match day from the public /fixtures page.
export async function unpublishMatchDayAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const { userId, roles } = await requirePermInline("match_days.publish");
  const sb = getServiceRoleSupabase();
  await unpublishMatchDay(sb, { userId, roles }, matchDayId);
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/admin/match-days");
  revalidatePath("/fixtures");
}

/**
 * Plan 27 — single-step reorder (swap with neighbor) driven from the
 * per-fixture up/down chevrons on the match-day detail page. Form posts
 * `matchId` + `direction` ("up" | "down"); we look up the current order,
 * find the neighbor, and persist a new full ordering via reorderMatches.
 */
export async function reorderMatchAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (direction !== "up" && direction !== "down") {
    throw new Error("reorderMatchAction: direction must be 'up' or 'down'");
  }
  const { userId, roles } = await requirePermInline("matches.edit");
  const sb = getServiceRoleSupabase();
  const { data: rows, error } = await sb
    .from("matches")
    .select("id, match_order")
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .order("match_order", { ascending: true });
  if (error) throw new Error(`reorderMatchAction load failed: ${error.message}`);
  const ids = (rows ?? []).map((r: { id: string }) => r.id);
  const idx = ids.indexOf(matchId);
  if (idx === -1) {
    throw new Error(`reorderMatchAction: match ${matchId} not in day ${matchDayId}`);
  }
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= ids.length) {
    // Already at the boundary — no-op (fail soft so accidental double-clicks
    // don't error the action).
    revalidatePath(`/admin/match-days/${matchDayId}`);
    return;
  }
  const next = ids.slice();
  [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
  await reorderMatches(sb, { userId, roles }, matchDayId, next);
  revalidatePath(`/admin/match-days/${matchDayId}`);
  revalidatePath("/fixtures");
}

export async function backToList() {
  redirect("/admin/match-days");
}
