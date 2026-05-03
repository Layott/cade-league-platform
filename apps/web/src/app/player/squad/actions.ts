"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import {
  submitPickerSquad,
  weekStartThursday,
  getSubmissionForPlayerAndMatchDay,
  resolveSquadWindowForMatchDay,
  FORMATION_LABEL_TO_KEY,
} from "@/server/squads";
import { ValidationError, ConflictError } from "@/server/squads/errors";
import {
  publishSquadSubmitted,
  publishSquadChanged,
} from "@/server/squads/realtime";
import { revalidateSquadSurfaces } from "@/server/squads/revalidate";

/**
 * Plan 30 — player-side server actions for the picker flow.
 *
 * 2026-05-04 — screenshot upload removed from picker. The legacy
 * `requestUploadUrlAction` was deleted (no consumer). `submitPickerAction`
 * still accepts `futbinScreenshotPath` as an optional / nullable field so
 * legacy admin tooling that pre-uploads a screenshot keeps working.
 */

async function loadPlayerContext() {
  const sb = await getServerSupabase();
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

  const { data: player } = await sb
    .from("players")
    .select("id, user_id")
    .eq("user_id", pub.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!player) throw new Error("no player row linked to user");

  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();
  if (!season) throw new Error("no active season");

  return { sb, userId: pub.id, playerId: player.id, seasonId: season.id };
}

export type SubmitPickerActionPayload = {
  weekStartDate: string;
  // Optional admin-controlled per-match-day window. When supplied, the
  // submission is stamped with this match_day_id and the window check
  // uses the per-match-day resolver. Accepts null so the picker can pass
  // through the explicit "no match day" signal without callers having to
  // strip the key.
  matchDayId?: string | null;
  // 2026-05-04 — screenshot upload removed from picker. Field optional
  // so the picker can simply omit it; legacy admin tools may still set it.
  futbinScreenshotPath?: string | null;
  // Bug 10 (2026-05-01) — picker FormationKey.
  formation?: string;
  slots: Array<{
    slotIndex: number;
    fcdbPlayerId: string;
    positionInLineup: string;
  }>;
};

export async function submitPickerAction(
  payload: SubmitPickerActionPayload,
): Promise<void> {
  const { sb, userId, playerId, seasonId } = await loadPlayerContext();
  const limited = await enforceAuthedWrite(userId);
  if (limited) throw new Error("rate_limited");

  if (!payload.weekStartDate) {
    throw new Error("missing week start date");
  }
  if (!Array.isArray(payload.slots) || payload.slots.length < 11) {
    throw new Error("at least 11 starting slots required");
  }

  // Bug fix 2026-05-02: catch business-rule rejections (duplicate card,
  // budget, validation) and redirect with a user-readable error param so
  // the picker page renders an inline banner instead of bubbling a
  // ValidationError up to a Server Components render crash.
  let submission: { id: string };
  try {
    submission = await submitPickerSquad(sb, {
      seasonId,
      playerId,
      weekStartDate: payload.weekStartDate,
      matchDayId: payload.matchDayId ?? null,
      futbinScreenshotPath: payload.futbinScreenshotPath ?? null,
      // Bug 10 (2026-05-01) — pass picker formation key through.
      formation: payload.formation as
        | "433" | "442" | "4231" | "4141" | "41212" | "4222"
        | "424" | "4312" | "4321" | "4411" | "451"
        | "352" | "343" | "3412" | "3511" | "3421" | "3142"
        | "532" | "5212" | "541" | "523"
        | undefined,
      slots: payload.slots,
    });
  } catch (err) {
    if (err instanceof ValidationError || err instanceof ConflictError) {
      const target = payload.matchDayId
        ? `/player/squad?matchDay=${encodeURIComponent(payload.matchDayId)}&edit=1&error=${encodeURIComponent(err.message)}`
        : `/player/squad?error=${encodeURIComponent(err.message)}`;
      redirect(target);
    }
    throw err;
  }

  // Live-refresh (2026-04-24) — ping the admin queue so a new
  // submission row appears without reload. Fire-and-forget.
  try {
    await publishSquadSubmitted(sb, {
      weekStartDate: payload.weekStartDate,
      playerId,
      submissionId: submission.id,
    });
  } catch {
    // best-effort; DB row is the durable record
  }

  // 2026-05-02 — fire `squad.updated` on the season's standings channel
  // so broadcast overlays subscribed via `OverlayDataInjector` repaint
  // mid-stream. Channel matches `standings.changed` so a single
  // subscription drives both events.
  try {
    await publishSquadChanged(sb, {
      seasonId,
      playerId,
      matchDayId: payload.matchDayId ?? null,
      weekStartDate: payload.weekStartDate,
      submissionId: submission.id,
    });
  } catch {
    // best-effort
  }

  // 2026-05-02 — bust every surface that consumes squad data: player's
  // own page, admin queue + detail, admin broadcast hub + design preview,
  // public player profile.
  revalidateSquadSurfaces({
    playerId,
    matchDayId: payload.matchDayId ?? null,
    submissionId: submission.id,
  });
  // 2026-05-02 — pass the just-submitted matchDayId through the redirect
  // so /player/squad can render the WeekendApplyPrompt banner asking
  // whether to apply the same roster to the sibling weekend MD. The page
  // resolves the sibling itself; we only need the source id here.
  if (payload.matchDayId) {
    redirect(
      `/player/squad?submitted=${encodeURIComponent(payload.matchDayId)}`,
    );
  }
  redirect("/player/squad");
}

/**
 * 2026-05-01 — bug 5. Apply a single submitted squad to multiple other
 * match days. Players use this to clone a Saturday's picks across the
 * upcoming weekends without rebuilding the XI from scratch each time.
 *
 * Flow per target match day:
 *   1. Resolve window state — skip if closed.
 *   2. Look up any existing submission for (player, target).
 *      - If status='approved' or 'rejected' → skip ("already_finalised").
 *      - If status='pending' AND window open → soft-delete + re-insert via
 *        submitPickerSquad with the source items + formation.
 *      - If no submission AND window open → create new via the same path.
 *   3. Collect applied[] + skipped[] with reasons for the UI summary.
 *
 * The source submission's items + formation + screenshot path are reused
 * verbatim. Slot indexes are preserved so the target row mirrors the
 * source. The screenshot path is shared across all target rows — reusing
 * the same Storage object is intentional (it's the same picture of the
 * same team).
 */
export type ApplySquadResult = {
  applied: string[];
  skipped: Array<{ matchDayId: string; reason: string }>;
};

export async function applySquadToMultipleMatchDaysAction(input: {
  sourceMatchDayId: string;
  targetMatchDayIds: string[];
}): Promise<ApplySquadResult> {
  const { sb, userId, playerId, seasonId } = await loadPlayerContext();
  const limited = await enforceAuthedWrite(userId);
  if (limited) throw new Error("rate_limited");

  if (!input.sourceMatchDayId || typeof input.sourceMatchDayId !== "string") {
    throw new Error("missing sourceMatchDayId");
  }
  if (!Array.isArray(input.targetMatchDayIds) || input.targetMatchDayIds.length === 0) {
    throw new Error("targetMatchDayIds is empty");
  }
  if (input.targetMatchDayIds.length > 26) {
    // Defensive cap: a season has 13 match days × Sat+Sun pairs at most.
    throw new Error("too many target match days (>26)");
  }

  const svc = getServiceRoleSupabase();

  // Load the source match day's date so we can derive the source week
  // anchor for the existing-submission lookup.
  const { data: sourceMd, error: sourceMdErr } = await svc
    .from("match_days")
    .select("id, match_date, season_id")
    .eq("id", input.sourceMatchDayId)
    .is("deleted_at", null)
    .maybeSingle();
  if (sourceMdErr || !sourceMd) {
    throw new Error(
      `apply: source match day not found (${sourceMdErr?.message ?? "no row"})`,
    );
  }
  if ((sourceMd as { season_id: string }).season_id !== seasonId) {
    throw new Error("apply: source match day not in active season");
  }

  // Hydrate the source submission. Players can only clone their OWN
  // squads, so we look up by playerId.
  const sourceWeek = weekStartThursday(
    (sourceMd as { match_date: string }).match_date,
  );
  const source = await getSubmissionForPlayerAndMatchDay(
    svc,
    playerId,
    input.sourceMatchDayId,
    sourceWeek,
  );
  if (!source) {
    throw new Error("apply: no source submission to clone");
  }

  // Build the picker payload from the source items. Each item carries
  // resolved_fc_player_id (the FCDB link) when the source was filed via
  // the Plan 30 picker; we fall back to id when the join is missing
  // (legacy) so the downstream submitPickerSquad raises a clean
  // ConflictError instead of silently dropping the slot.
  type Slot = {
    slotIndex: number;
    fcdbPlayerId: string;
    positionInLineup: string;
  };
  const slots: Slot[] = source.items
    .filter((it) => it.resolved_fc_player_id)
    .map((it) => ({
      slotIndex: it.slot_index,
      fcdbPlayerId: it.resolved_fc_player_id!,
      positionInLineup: it.position,
    }));
  if (slots.length < 11) {
    throw new Error(
      `apply: source submission has only ${slots.length} resolvable items (need >=11)`,
    );
  }

  // Fetch the formation column separately — `getSubmissionForPlayerAndMatchDay`
  // doesn't include it in its select today (Bug 10 only added the column to
  // the WRITE path). Cast to picker FormationKey at the call site below; if
  // the column is null (legacy submission filed pre-formation-persistence)
  // the picker just defaults the new clones to the row's saved-but-null
  // formation, which is identical to omitting it.
  const { data: srcFormationRow } = await svc
    .from("squad_submissions")
    .select("formation")
    .eq("id", source.submission.id)
    .maybeSingle();
  const formation = (srcFormationRow as { formation: string | null } | null)
    ?.formation ?? null;
  const futbinScreenshotPath = source.submission.futbin_screenshot_path;

  const applied: string[] = [];
  const skipped: Array<{ matchDayId: string; reason: string }> = [];

  for (const targetId of input.targetMatchDayIds) {
    if (targetId === input.sourceMatchDayId) {
      // No-op: applying the source onto itself is meaningless.
      skipped.push({ matchDayId: targetId, reason: "same_as_source" });
      continue;
    }
    try {
      // Resolve target match day's date + window state.
      const { data: targetMd } = await svc
        .from("match_days")
        .select("id, match_date, season_id")
        .eq("id", targetId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!targetMd) {
        skipped.push({ matchDayId: targetId, reason: "not_found" });
        continue;
      }
      if ((targetMd as { season_id: string }).season_id !== seasonId) {
        skipped.push({ matchDayId: targetId, reason: "wrong_season" });
        continue;
      }
      const targetMatchDate = (targetMd as { match_date: string }).match_date;
      const targetWeek = weekStartThursday(targetMatchDate);

      // Window resolution — skip closed windows. Player force_open lifts
      // the deny via submit_picker, but apply skips conservatively to
      // avoid surprising the player when a referee force-closed an
      // upcoming match day.
      const resolution = await resolveSquadWindowForMatchDay(svc, targetId);
      if (!resolution.open) {
        skipped.push({ matchDayId: targetId, reason: `closed:${resolution.reason}` });
        continue;
      }

      // Existing-submission gate — only re-insert when pending. Approved
      // / rejected go through the admin reopen path (Plan 41); we don't
      // silently overwrite a finalised review.
      const existing = await getSubmissionForPlayerAndMatchDay(
        svc,
        playerId,
        targetId,
        targetWeek,
      );
      if (existing && existing.submission.validation_status !== "pending") {
        skipped.push({
          matchDayId: targetId,
          reason: `already_${existing.submission.validation_status}`,
        });
        continue;
      }

      // submitPickerSquad handles the re-submit case (soft-delete +
      // re-insert) when a pending row already exists. Same call covers
      // both new and replace flows. The DB column persists the LABEL form
      // ("4-3-3"); reverse-map back to the picker KEY ("433") so the
      // submit_picker schema accepts it.
      const formationKey = formation
        ? FORMATION_LABEL_TO_KEY[formation as keyof typeof FORMATION_LABEL_TO_KEY]
        : undefined;
      const result = await submitPickerSquad(sb, {
        seasonId,
        playerId,
        weekStartDate: targetWeek,
        matchDayId: targetId,
        futbinScreenshotPath,
        formation: formationKey,
        slots,
      });

      // Best-effort realtime ping per applied target.
      try {
        await publishSquadSubmitted(sb, {
          weekStartDate: targetWeek,
          playerId,
          submissionId: result.id,
        });
      } catch {
        // best-effort
      }
      // 2026-05-02 — overlay subscribers repaint via the standings
      // channel. Per applied target so admins watching mid-broadcast
      // see each clone land in sequence.
      try {
        await publishSquadChanged(sb, {
          seasonId,
          playerId,
          matchDayId: targetId,
          weekStartDate: targetWeek,
          submissionId: result.id,
        });
      } catch {
        // best-effort
      }
      // 2026-05-02 — bust caches per applied target so the per-detail
      // admin route + design preview pick up the new submission row.
      revalidateSquadSurfaces({
        playerId,
        matchDayId: targetId,
        submissionId: result.id,
      });

      applied.push(targetId);
    } catch (err) {
      skipped.push({
        matchDayId: targetId,
        reason: `error:${(err as Error).message ?? "unknown"}`,
      });
    }
  }

  // Final umbrella revalidate so the player + admin LIST surfaces are
  // fresh even when zero targets applied (e.g. all skipped due to
  // closed windows).
  revalidateSquadSurfaces({ playerId, matchDayId: null });
  return { applied, skipped };
}
