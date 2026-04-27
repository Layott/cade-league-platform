"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { requestChange } from "@/server/squads";
import { publishSquadStatusChanged } from "@/server/squads/realtime";
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
  try {
    const { data: sub } = await sb
      .from("squad_submissions")
      .select("player_id, week_start_date")
      .eq("id", submissionId)
      .maybeSingle();
    const row = sub as
      | { player_id: string; week_start_date: string }
      | null;
    if (row) {
      await publishSquadStatusChanged(sb, {
        submissionId,
        playerId: row.player_id,
        weekStartDate: row.week_start_date,
        status: "pending",
      });
    }
  } catch {
    // best-effort
  }

  revalidatePath(`/player/squad/change`);
  revalidatePath(`/player/squad`);
  revalidatePath("/admin/squads");
  revalidatePath(`/admin/squads/${submissionId}`);
  redirect("/player/squad/change?ok=1");
}
