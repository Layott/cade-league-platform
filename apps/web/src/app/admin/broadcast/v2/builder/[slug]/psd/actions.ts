"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { savePsdBytes } from "@/server/overlays/builder/photopea-bridge";
import { parsePsdAndStoreSprites } from "@/server/overlays/builder/psd-parser";
import type { SavePsdResult } from "@/server/overlays/builder/photopea-bridge.types";
import { SavePsdFormSchema, RevertSnapshotFormSchema } from "./schemas";

/**
 * Wave 2B — server actions for the Photopea iframe page.
 *
 * Per CLAUDE.md §10 this file exports ONLY async functions; schemas
 * live in the sibling `schemas.ts`.
 *
 * All actions gate on `overlay.design.manage` and rate-limit via
 * `enforceAuthedWrite`. Mirrors the gate() pattern in
 * `app/admin/broadcast/v2/builder/actions.ts` from Wave 1A.
 */

type Actor = { userId: string; roles: readonly string[] };

async function gate(): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
  actor: Actor;
}> {
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
    await requirePermAsync(
      sb,
      { userId: pub.id, roles },
      "overlay.design.manage",
    );
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

/**
 * Save PSD bytes that round-tripped through the Photopea iframe.
 *
 * FormData fields:
 *   - assetId — uuid of the parent PSD row in overlay_user_assets.
 *   - psd      — File containing the new PSD bytes (must start with
 *                the 8BPS magic; size ≤100MB).
 *   - note     — optional ≤200-char admin label for the history row.
 */
export async function savePsdFromPhotopeaAction(
  formData: FormData,
): Promise<SavePsdResult> {
  const parsed = SavePsdFormSchema.safeParse({
    assetId: String(formData.get("assetId") ?? ""),
    note: formData.get("note") ? String(formData.get("note")) : undefined,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  }

  const file = formData.get("psd");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("psd file missing or empty");
  }
  const buf = await file.arrayBuffer();
  const psdBytes = new Uint8Array(buf);

  // Magic-byte check at the boundary; SavePsdInputSchema inside
  // savePsdBytes will re-validate.
  if (
    psdBytes.byteLength < 4 ||
    psdBytes[0] !== 0x38 ||
    psdBytes[1] !== 0x42 ||
    psdBytes[2] !== 0x50 ||
    psdBytes[3] !== 0x53
  ) {
    throw new Error("psdBytes missing 8BPS magic");
  }

  const { sb, actor } = await gate();

  const result = await savePsdBytes(sb, actor, {
    input: {
      assetId: parsed.data.assetId,
      psdBytes,
      note: parsed.data.note,
    },
    parsePsd: parsePsdAndStoreSprites,
  });

  revalidatePath("/admin/broadcast/v2/builder");
  return result;
}

/**
 * Revert the live PSD object back to an earlier snapshot.
 *
 * FormData fields:
 *   - assetId    — uuid of the asset row.
 *   - snapshotId — uuid of the overlay_user_asset_history row.
 *
 * Implementation: copy the historical storage object back to the
 * live path (creating ANOTHER history row pointing at the now-
 * displaced "current" version), then re-run the parser.
 */
export async function revertToAssetSnapshotAction(
  formData: FormData,
): Promise<SavePsdResult> {
  const parsed = RevertSnapshotFormSchema.safeParse({
    assetId: String(formData.get("assetId") ?? ""),
    snapshotId: String(formData.get("snapshotId") ?? ""),
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  }

  const { sb, actor } = await gate();

  // Fetch the historical row to find its storage_path.
  const { data: histRow, error: histErr } = await sb
    .from("overlay_user_asset_history")
    .select("id, asset_id, storage_path, size_bytes")
    .eq("id", parsed.data.snapshotId)
    .eq("asset_id", parsed.data.assetId)
    .is("deleted_at", null)
    .maybeSingle();
  if (histErr || !histRow) {
    throw new Error(
      `snapshot not found: ${parsed.data.snapshotId}${histErr ? ` (${histErr.message})` : ""}`,
    );
  }

  // Download the historical bytes and re-feed through savePsdBytes.
  // This triggers the canonical snapshot+upload+parse sequence so
  // the revert ALSO produces a new history row pointing at the
  // now-displaced "current" version (lossless round-trip).
  const { data: blob, error: dlErr } = await sb.storage
    .from("overlay-user-assets")
    .download((histRow as { storage_path: string }).storage_path);
  if (dlErr || !blob) {
    throw new Error(
      `snapshot download failed: ${dlErr?.message ?? "no blob"}`,
    );
  }
  const psdBytes = new Uint8Array(await blob.arrayBuffer());

  const result = await savePsdBytes(sb, actor, {
    input: {
      assetId: parsed.data.assetId,
      psdBytes,
      note: `revert to snapshot ${parsed.data.snapshotId}`,
    },
    parsePsd: parsePsdAndStoreSprites,
  });

  revalidatePath("/admin/broadcast/v2/builder");
  return result;
}
