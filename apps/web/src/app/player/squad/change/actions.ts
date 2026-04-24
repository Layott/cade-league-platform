"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { requestChange } from "@/server/squads";
import type { SquadChangeSubmitPayload } from "@/components/squads/SquadChangeEditor";

/**
 * Plan 10 extension — accepts the structured change payload from
 * <SquadChangeEditor />. Supports three coexisting intents in a single
 * request: formation change, slot rearrangement, and at most one swap.
 */
export async function requestChangeAction(
  submissionId: string,
  payload: SquadChangeSubmitPayload,
): Promise<void> {
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

  await requestChange(sb, {
    submissionId,
    newFormation: payload.newFormation,
    newSlotPlan: payload.newSlotPlan,
    playerOutItemId: payload.playerOutItemId,
    playerOutName: payload.playerOutName,
    playerIn: payload.playerIn,
    authorizedByRefUserId: payload.authorizedByRefUserId,
  });

  revalidatePath(`/player/squad/change`);
  revalidatePath(`/player/squad`);
  redirect("/player/squad/change?ok=1");
}
