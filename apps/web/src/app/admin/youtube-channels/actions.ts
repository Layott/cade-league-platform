"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import {
  createChannel,
  deleteChannel,
  promoteToDefault,
} from "@/server/youtube/channels";

async function gate(): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
  publicUserId: string;
}> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(
      sb,
      { userId: pub.id, roles },
      "branding.manage",
    );
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error("Forbidden: missing branding.manage");
    }
    throw e;
  }
  return { sb, publicUserId: pub.id };
}

export async function createChannelAction(formData: FormData) {
  const handleRaw = String(formData.get("handle") ?? "").trim();
  const displayLabel = String(formData.get("displayLabel") ?? "").trim();
  const isDefault = formData.get("isDefault") === "on";

  // Accept either "@foo" or "foo" from the UI — normalize here.
  const handle = handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`;

  const { sb, publicUserId } = await gate();
  await createChannel(sb, {
    handle,
    displayLabel: displayLabel || undefined,
    isDefault,
    userId: publicUserId,
  });
  revalidatePath("/admin/youtube-channels");
}

export async function deleteChannelAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("id required");
  const { sb, publicUserId } = await gate();
  await deleteChannel(sb, id, publicUserId);
  revalidatePath("/admin/youtube-channels");
}

export async function promoteChannelAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("id required");
  const { sb, publicUserId } = await gate();
  await promoteToDefault(sb, id, publicUserId);
  revalidatePath("/admin/youtube-channels");
}
