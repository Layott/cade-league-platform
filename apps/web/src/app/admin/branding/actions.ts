"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import {
  upsertBrandSettings,
  upsertBrandAsset,
  setBrandAssetVisible,
  deleteBrandAsset,
} from "@/server/branding/write";

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

async function resolveAuthed(): Promise<{
  publicUserId: string;
  roles: readonly string[];
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
  return { publicUserId: pub.id, roles };
}

async function gate(): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
  publicUserId: string;
}> {
  const { publicUserId, roles } = await resolveAuthed();
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(
      sb,
      { userId: publicUserId, roles },
      "branding.manage",
    );
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error("Forbidden: missing branding.manage");
    }
    throw e;
  }
  const limited = await enforceAuthedWrite(publicUserId);
  if (limited) throw new Error("rate_limited");
  return { sb, publicUserId };
}

export async function saveBrandColorsAction(formData: FormData) {
  const primary = String(formData.get("primaryColor") ?? "").trim();
  const secondary = String(formData.get("secondaryColor") ?? "").trim();
  // Plan 39 sanitize — both fields land in CSS via the brand-settings
  // overlay/page injection, so anything other than a strict #RRGGBB
  // hex is rejected. Empty string => "no change", which falls through
  // as undefined to the server upsert.
  if (primary && !HEX6_RE.test(primary)) {
    throw new Error("primaryColor must be #RRGGBB hex");
  }
  if (secondary && !HEX6_RE.test(secondary)) {
    throw new Error("secondaryColor must be #RRGGBB hex");
  }
  const { sb, publicUserId } = await gate();
  await upsertBrandSettings(sb, {
    primaryColor: primary || undefined,
    secondaryColor: secondary || undefined,
    userId: publicUserId,
  });
  revalidatePath("/admin/branding");
}

export async function saveBrandAssetAction(formData: FormData) {
  const slot = String(formData.get("slot") ?? "").trim();
  const storagePath = String(formData.get("storagePath") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || null;
  const displayOrderRaw = String(formData.get("displayOrder") ?? "0");
  const visible = formData.get("visible") !== "off";
  if (!slot) throw new Error("slot required");
  if (!storagePath) throw new Error("storagePath required");
  // Plan 39 sanitize — `..` traversal in a storage path lets a poisoned
  // upload escape the bucket sub-tree. Reject any segment containing the
  // parent-path token. Forward + back slash both checked.
  if (storagePath.includes("..") || storagePath.includes("\\")) {
    throw new Error("storagePath must not contain '..' or backslashes");
  }

  const displayOrderParsed = z.coerce.number().int().min(0).max(9999).parse(displayOrderRaw);
  const { sb, publicUserId } = await gate();
  await upsertBrandAsset(sb, {
    slot,
    storagePath,
    label,
    displayOrder: displayOrderParsed,
    visible,
    userId: publicUserId,
  });
  revalidatePath("/admin/branding");
}

export async function toggleBrandAssetVisibleAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const next = formData.get("visible") === "on";
  if (!id) throw new Error("id required");
  const { sb, publicUserId } = await gate();
  await setBrandAssetVisible(sb, id, next, publicUserId);
  revalidatePath("/admin/branding");
}

export async function deleteBrandAssetAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("id required");
  const { sb, publicUserId } = await gate();
  await deleteBrandAsset(sb, id, publicUserId);
  revalidatePath("/admin/branding");
}
