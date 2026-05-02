"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { requestChange } from "@/server/squads";
import {
  publishSquadStatusChanged,
  publishSquadChanged,
} from "@/server/squads/realtime";
import { revalidateSquadSurfaces } from "@/server/squads/revalidate";
import type { SquadChangeSubmitPayload } from "@/components/squads/SquadChangeEditor";

const submissionIdSchema = z.string().uuid();

/**
 * Plan 10 extension — accepts the structured change payload from
 * <SquadChangeEditor />. Supports three coexisting intents in a single
 * request: formation change, slot rearrangement, and at most one swap.
 */
export async function requestChangeAction(
  submissionId: string,
  payload: SquadChangeSubmitPayload,
): Promise<void> {
  const safeSubmissionId = submissionIdSchema.parse(submissionId);
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

  // requestChange() invokes changeSchema.safeParse(input) at server fn
  // boundary (apps/web/src/server/squads/change.ts:32), so payload is
  // fully validated downstream. We only enforce UUID at the action
  // entrypoint as defense-in-depth.
  await requestChange(sb, {
    submissionId: safeSubmissionId,
    newFormation: payload.newFormation,
    newSlotPlan: payload.newSlotPlan,
    playerOutItemId: payload.playerOutItemId,
    playerOutName: payload.playerOutName,
    playerIn: payload.playerIn,
    authorizedByRefUserId: payload.authorizedByRefUserId,
  });

  // Live-refresh (2026-04-24) — Friday change touches an approved
  // submission; notify admin queue + the player's scoped channel.
  type SubmissionRow = {
    player_id: string;
    week_start_date: string;
    match_day_id: string | null;
    season_id: string | null;
  };
  let subRow: SubmissionRow | null = null;
  try {
    const { data: sub } = await sb
      .from("squad_submissions")
      .select("player_id, week_start_date, match_day_id, season_id")
      .eq("id", submissionId)
      .maybeSingle();
    subRow = sub as SubmissionRow | null;
    if (subRow) {
      await publishSquadStatusChanged(sb, {
        submissionId,
        playerId: subRow.player_id,
        weekStartDate: subRow.week_start_date,
        status: "pending",
      });
      // 2026-05-02 — fire `squad.updated` on the standings channel for
      // overlay subscribers.
      if (subRow.season_id) {
        try {
          await publishSquadChanged(sb, {
            seasonId: subRow.season_id,
            playerId: subRow.player_id,
            matchDayId: subRow.match_day_id,
            weekStartDate: subRow.week_start_date,
            submissionId,
          });
        } catch {
          // best-effort
        }
      }
    }
  } catch {
    // best-effort
  }

  // 2026-05-02 — central revalidation. Friday-change touches the same
  // surfaces as a fresh submission (admin queue, design preview, public
  // profile, etc.) so we use the shared helper rather than duplicating
  // the path list.
  if (subRow) {
    revalidateSquadSurfaces({
      playerId: subRow.player_id,
      matchDayId: subRow.match_day_id,
      submissionId,
    });
  }
  redirect("/player/squad/change?ok=1");
}
