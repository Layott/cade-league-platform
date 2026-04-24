"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  buildScreenshotPath,
  createSignedUpload,
  submitPickerSquad,
  weekStartThursday,
} from "@/server/squads";
import { publishSquadSubmitted } from "@/server/squads/realtime";

/**
 * Plan 30 — player-side server actions for the picker flow.
 *
 * `requestUploadUrlAction` is carried over from Plan 10 (same contract).
 * `submitPickerAction` replaces the old text-item `createSubmissionAction`
 * by taking a `{ weekStartDate, futbinScreenshotPath, slots[] }` shape
 * built in the browser.
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

export async function requestUploadUrlAction(input: {
  extension: "png" | "jpg" | "webp";
}): Promise<{ path: string; signedUrl: string; token?: string; weekStartDate: string }> {
  const { playerId, seasonId } = await loadPlayerContext();
  const weekStartDate = weekStartThursday(new Date());
  const filename = `${randomUUID()}.${input.extension}`;
  const path = buildScreenshotPath({ seasonId, playerId, weekStartDate, filename });

  const svc = getServiceRoleSupabase();
  const signed = await createSignedUpload(svc, path);
  return { ...signed, weekStartDate };
}

export type SubmitPickerActionPayload = {
  weekStartDate: string;
  futbinScreenshotPath: string;
  slots: Array<{
    slotIndex: number;
    fcdbPlayerId: string;
    positionInLineup: string;
  }>;
};

export async function submitPickerAction(
  payload: SubmitPickerActionPayload,
): Promise<void> {
  const { sb, playerId, seasonId } = await loadPlayerContext();

  if (!payload.futbinScreenshotPath || !payload.weekStartDate) {
    throw new Error("missing screenshot path or week");
  }
  if (!Array.isArray(payload.slots) || payload.slots.length < 11) {
    throw new Error("at least 11 starting slots required");
  }

  const submission = await submitPickerSquad(sb, {
    seasonId,
    playerId,
    weekStartDate: payload.weekStartDate,
    futbinScreenshotPath: payload.futbinScreenshotPath,
    slots: payload.slots,
  });

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

  revalidatePath("/player/squad");
  revalidatePath("/admin/squads");
  redirect("/player/squad");
}
