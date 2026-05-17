"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { uploadFont, softDeleteFont } from "@/server/overlays/builder/fonts";
import { UploadFontInputSchema } from "./schemas";

/**
 * Overlay Builder — font upload server actions.
 *
 * Per CLAUDE.md §10: this file exports ONLY async functions.
 * Schemas + types live in sibling `schemas.ts`.
 *
 * Both actions gate on `overlay.design.manage` + enforceAuthedWrite,
 * mirroring the gate() pattern in the sibling builder `actions.ts`.
 */

async function gate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth?.user) redirect("/login");
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
  const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, "overlay.design.manage");
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error("Forbidden: missing overlay.design.manage");
    }
    throw e;
  }
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");
  return { sb, actor: { userId: pub.id, roles } };
}

export async function uploadFontAction(input: unknown) {
  const { sb, actor } = await gate();

  const parsed = UploadFontInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Invalid font upload: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const fileBuffer = Buffer.from(parsed.data.base64, "base64");
  const result = await uploadFont(sb, actor.userId, {
    fileBuffer,
    filename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
  });
  revalidatePath("/admin/broadcast/v2/builder/fonts");
  return result;
}

export async function deleteFontAction(fontId: string) {
  const { sb, actor } = await gate();
  await softDeleteFont(sb, actor.userId, fontId);
  revalidatePath("/admin/broadcast/v2/builder/fonts");
}
