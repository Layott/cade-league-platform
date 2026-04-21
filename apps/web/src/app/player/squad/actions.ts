"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  createSubmission,
  buildScreenshotPath,
  createSignedUpload,
  weekStartThursday,
  type SquadItemInput,
} from "@/server/squads";

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

/**
 * Issue a signed upload URL for a new screenshot. Called by the client
 * before submitting the form so the file transit happens browser→Supabase
 * (no large payload through our server).
 */
export async function requestUploadUrlAction(input: {
  extension: "png" | "jpg" | "webp";
}): Promise<{ path: string; signedUrl: string; token?: string; weekStartDate: string }> {
  const { playerId, seasonId } = await loadPlayerContext();
  const weekStartDate = weekStartThursday(new Date());
  const filename = `${randomUUID()}.${input.extension}`;
  const path = buildScreenshotPath({ seasonId, playerId, weekStartDate, filename });

  // Service-role client so the server can mint the upload URL regardless of
  // the user's RLS stance on storage.
  const svc = getServiceRoleSupabase();
  const signed = await createSignedUpload(svc, path);
  return { ...signed, weekStartDate };
}

type ItemForm = {
  name: string;
  rating: number;
  position: string;
  value: number;
  itemType: SquadItemInput["itemType"];
  nationalityFlag: string | null;
  slotIndex: number;
};

function collectItems(formData: FormData): ItemForm[] {
  const out: ItemForm[] = [];
  for (let i = 0; i < 23; i++) {
    const name = String(formData.get(`items.${i}.name`) ?? "").trim();
    const rating = Number(formData.get(`items.${i}.rating`) ?? 0);
    const position = String(formData.get(`items.${i}.position`) ?? "").trim();
    const value = Number(formData.get(`items.${i}.value`) ?? 0);
    const itemTypeRaw = String(formData.get(`items.${i}.itemType`) ?? "gold");
    const nationalityFlag =
      String(formData.get(`items.${i}.nationalityFlag`) ?? "").trim() || null;
    const slotIndex = Number(formData.get(`items.${i}.slotIndex`) ?? i);
    if (!name) continue;
    out.push({
      name,
      rating,
      position: position || "ST",
      value,
      itemType: itemTypeRaw as SquadItemInput["itemType"],
      nationalityFlag,
      slotIndex,
    });
  }
  return out;
}

export async function createSubmissionAction(formData: FormData): Promise<void> {
  const { sb, playerId, seasonId } = await loadPlayerContext();
  const futbinScreenshotPath = String(formData.get("futbinScreenshotPath") ?? "");
  const weekStartDate = String(formData.get("weekStartDate") ?? "");
  if (!futbinScreenshotPath || !weekStartDate) {
    throw new Error("missing screenshot path or week");
  }
  const items = collectItems(formData);

  await createSubmission(sb, {
    seasonId,
    playerId,
    weekStartDate,
    futbinScreenshotPath,
    items,
  });
  revalidatePath("/player/squad");
  redirect("/player/squad");
}
