"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  createMatch,
  editMatch,
  reorderMatches,
  setMatchSlotLanes,
  softDeleteMatch,
  type SlotLaneAssignment,
} from "@/server/matches/matches";
import {
  publishMatchDay,
  unpublishMatchDay,
  setMatchDayStatus,
} from "@/server/matches/match-days";
import {
  enterResult,
  editResult,
  confirmResult,
  unvoidMatchResult,
} from "@/server/matches/results";
import { requirePermAsync } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { syncScoreToLiveSessions } from "@/server/broadcast/match_sync";
import {
  publishFixturesChanged,
  resolveSeasonIdFromMatchDay,
  type FixturesChangedPayload,
} from "@/server/fixtures/realtime";

/**
 * Bug 1 re-fix (2026-05-02): every fixture mutation MUST bust ALL admin
 * surfaces that read fixture rows or counts — not just /admin/match-days/[id].
 * Page-form revalidatePath only invalidates the EXACT URL; we use the
 * `'layout'` form on parent paths so all child routes (incl. dynamic
 * segments) get invalidated together. This handles the user-reported
 * 2026-05-01 case: delete a fixture from match-day detail → /admin/match-days
 * count + /admin/tournament/{fixtures,results-entry,walkovers} all stayed
 * stale because nested routes share `match-days/layout.tsx` + `tournament/`
 * shells.
 */
function revalidateFixtureSurfaces(matchDayId: string): void {
  revalidatePath(`/admin/match-days/${matchDayId}`);
  // 'layout' form busts the layout AND every page below it (including
  // dynamic segments under /[id]/...). Page form would only hit the exact URL.
  revalidatePath("/admin/match-days", "layout");
  revalidatePath("/admin/tournament", "layout");
  revalidatePath("/fixtures");
  revalidatePath("/admin/players");
  revalidatePath("/players", "layout");
}

/**
 * Live-refresh (2026-04-24) — wake the public `/fixtures` page
 * (mounts `<FixturesLiveRefresh />`) whenever a fixture mutation
 * lands. Resolves seasonId from the matchDayId. Fire-and-forget: a
 * broadcast failure must never bubble up and block the write.
 */
async function pingFixtures(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  matchDayId: string,
  reason: FixturesChangedPayload["reason"],
): Promise<void> {
  try {
    const seasonId = await resolveSeasonIdFromMatchDay(sb, matchDayId);
    if (!seasonId) return;
    await publishFixturesChanged(sb, seasonId, reason);
  } catch {
    // best-effort
  }
}

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
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");
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
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");
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
  await pingFixtures(sb, matchDayId, "match_added");
  revalidateFixtureSurfaces(matchDayId);
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
  await pingFixtures(sb, matchDayId, "match_edited");
  revalidateFixtureSurfaces(matchDayId);
}

export async function removeMatchAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");

  await requireMatchEditPerm();
  const sb = getServiceRoleSupabase();
  await softDeleteMatch(sb, { matchId });
  await pingFixtures(sb, matchDayId, "match_removed");
  revalidateFixtureSurfaces(matchDayId);
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
  await pingFixtures(sb, matchDayId, "result_entered");
  revalidatePath("/standings");
  revalidateFixtureSurfaces(matchDayId);
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
  await pingFixtures(sb, matchDayId, "result_edited");
  revalidatePath("/standings");
  revalidateFixtureSurfaces(matchDayId);
}

export async function confirmResultAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const sb = getServiceRoleSupabase();
  const actor = await currentPublicUserId();
  await confirmResult(sb, { matchId }, actor);
  await pingFixtures(sb, matchDayId, "result_confirmed");
  revalidatePath("/standings");
  revalidateFixtureSurfaces(matchDayId);
}

// Plan 27 — publish a match day to the public /fixtures page.
export async function publishMatchDayAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const { userId, roles } = await requirePermInline("match_days.publish");
  const sb = getServiceRoleSupabase();
  await publishMatchDay(sb, { userId, roles }, matchDayId);
  await pingFixtures(sb, matchDayId, "match_day_published");
  revalidateFixtureSurfaces(matchDayId);
}

// Plan 27 — withdraw a published match day from the public /fixtures page.
export async function unpublishMatchDayAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const { userId, roles } = await requirePermInline("match_days.publish");
  const sb = getServiceRoleSupabase();
  await unpublishMatchDay(sb, { userId, roles }, matchDayId);
  await pingFixtures(sb, matchDayId, "match_day_unpublished");
  revalidateFixtureSurfaces(matchDayId);
}

// Mark a match day as completed — drops it from the homepage "Upcoming"
// card and flips the public fixtures badge to "Final". Re-uses the
// match_days.publish permission (admin + loc).
export async function markMatchDayCompleteAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const { userId, roles } = await requirePermInline("match_days.publish");
  const sb = getServiceRoleSupabase();
  await setMatchDayStatus(sb, { userId, roles }, matchDayId, "completed");
  await pingFixtures(sb, matchDayId, "match_day_published");
  revalidatePath("/");
  revalidateFixtureSurfaces(matchDayId);
}

// Reopen a previously-completed match day (back to scheduled). Used when
// admin completed prematurely and still needs to enter or correct results.
export async function reopenMatchDayAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const { userId, roles } = await requirePermInline("match_days.publish");
  const sb = getServiceRoleSupabase();
  await setMatchDayStatus(sb, { userId, roles }, matchDayId, "scheduled");
  await pingFixtures(sb, matchDayId, "match_day_published");
  revalidatePath("/");
  revalidateFixtureSurfaces(matchDayId);
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
  await pingFixtures(sb, matchDayId, "match_reordered");
  revalidateFixtureSurfaces(matchDayId);
}

/**
 * 2026-05-10 — assign slot + lane to every fixture on a match day in one
 * server action. Form data is encoded as repeated triples:
 *   `assignment[<matchId>][slot]` = number-or-empty
 *   `assignment[<matchId>][lane]` = "primary" | "secondary" | "" (cleared)
 *
 * Empty slot AND empty lane = clear assignment (fixture becomes
 * unscheduled). Mixed (one set, one empty) is treated as cleared too —
 * UI prevents this but server defends against direct posts.
 */
export async function setMatchSlotLanesAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  if (!matchDayId) throw new Error("setMatchSlotLanesAction: missing matchDayId");
  const { userId, roles } = await requirePermInline("matches.edit");
  const limited = await enforceAuthedWrite(userId);
  if (limited) throw new Error("rate_limited");

  const ids = new Set<string>();
  for (const key of formData.keys()) {
    const m = key.match(/^assignment\[([0-9a-f-]{36})\]\[(slot|lane)\]$/i);
    if (m) ids.add(m[1]);
  }
  const assignments: SlotLaneAssignment[] = Array.from(ids).map((id) => {
    const slotRaw = String(formData.get(`assignment[${id}][slot]`) ?? "").trim();
    const laneRaw = String(formData.get(`assignment[${id}][lane]`) ?? "").trim();
    const slot = slotRaw ? parseInt(slotRaw, 10) : null;
    const lane =
      laneRaw === "primary" || laneRaw === "secondary" ? laneRaw : null;
    if (slot != null && (!Number.isFinite(slot) || slot < 1)) {
      throw new Error(`setMatchSlotLanesAction: invalid slot for ${id}`);
    }
    // Treat half-set rows as cleared — UI shouldn't allow but server defends.
    if (slot == null || lane == null) {
      return { matchId: id, slot: null, lane: null };
    }
    return { matchId: id, slot, lane };
  });

  const sb = getServiceRoleSupabase();
  await setMatchSlotLanes(sb, { userId, roles }, matchDayId, assignments);
  await pingFixtures(sb, matchDayId, "match_reordered");
  revalidateFixtureSurfaces(matchDayId);
}

/**
 * Plan 50: admin un-void a single auto-voided match without reversing the
 * originating ban. Use case: ban was backdated and this specific fixture
 * had already been played — admin wants to keep the ban but restore this
 * one result for entry. Requires a short reason for the audit log.
 *
 * To un-void ALL matches for a ban, revoke the ban via
 * /admin/punishments/[id] instead; the DB trigger sweeps every row.
 */
export async function unvoidMatchAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!matchDayId || !matchId) return;
  if (!reason) {
    throw new Error("un-void requires a reason");
  }
  const { userId } = await requirePermInline("matches.edit");
  const sb = getServiceRoleSupabase();
  await unvoidMatchResult(sb, { matchId, actorUserId: userId, reason });
  await pingFixtures(sb, matchDayId, "result_edited");
  revalidatePath("/standings");
  revalidateFixtureSurfaces(matchDayId);
}

export async function backToList() {
  redirect("/admin/match-days");
}
