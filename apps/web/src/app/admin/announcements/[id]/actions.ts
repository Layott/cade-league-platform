"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { publishNow } from "@/server/announcements";

export async function publishNowFromDetail(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user?.id ?? "")
    .single();
  if (!pub) return;
  await publishNow(sb, id, pub.id);
  revalidatePath(`/admin/announcements/${id}`);
}
