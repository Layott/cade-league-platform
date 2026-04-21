"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  requestChange,
  weekStartThursday,
} from "@/server/squads";

export async function requestChangeAction(formData: FormData): Promise<void> {
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

  const submissionId = String(formData.get("submissionId") ?? "");
  const playerOutItemId =
    String(formData.get("playerOutItemId") ?? "") || null;
  const playerOutName = String(formData.get("playerOutName") ?? "");
  const playerIn = {
    name: String(formData.get("playerIn.name") ?? ""),
    itemType: String(formData.get("playerIn.itemType") ?? "gold") as
      | "gold"
      | "silver"
      | "bronze"
      | "hero"
      | "icon"
      | "legend"
      | "special"
      | "other",
    rating: Number(formData.get("playerIn.rating") ?? 0),
    value: Number(formData.get("playerIn.value") ?? 0),
    nationalityFlag:
      String(formData.get("playerIn.nationalityFlag") ?? "") || null,
  };
  const authorizedByRefUserId = String(
    formData.get("authorizedByRefUserId") ?? "",
  );

  await requestChange(sb, {
    submissionId,
    playerOutItemId,
    playerOutName,
    playerIn,
    authorizedByRefUserId,
  });

  const weekStart = weekStartThursday(new Date());
  revalidatePath(`/player/squad/change`);
  revalidatePath(`/player/squad`);
  // Suppress unused var warning while keeping the value available for
  // future redirect targeting by week.
  void weekStart;
  redirect("/player/squad/change?ok=1");
}
