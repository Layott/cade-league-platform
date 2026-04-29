"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import {
  setDesignToken,
  clearDesignToken,
} from "@/server/overlays/design/tokens";
import {
  setActiveTemplate,
} from "@/server/overlays/design/templates";
import { revertToSnapshot } from "@/server/overlays/design/history";
import {
  OVERLAY_KEYS,
  TOKEN_CATALOG_BY_KEY,
  supportsBgImage,
} from "@/server/overlays/design/defaults";

/**
 * Phase 3 — overlay design admin server actions.
 *
 * Three actions, all gated on `overlay.design.manage` (admin / design /
 * production per migration 20260601000004). Inputs validated via Zod
 * schemas with strict shape:
 *   - overlay_key from the canonical OVERLAY_KEYS enum;
 *   - token_key from the TOKEN_CATALOG allowlist;
 *   - token_value capped at 200 chars + screened for CSS metacharacters
 *     (the same rule decodePreviewTokens enforces server-side, so
 *     persisted + previewed paths share constraints).
 *
 * On success: revalidate the design page + the affected overlay route.
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-system.md §5.1
 */

const FORBIDDEN_CHARS = /[;{}<>"']/;

const OverlayKeyEnum = z.enum(OVERLAY_KEYS as readonly string[] as [string, ...string[]]);
/**
 * Token value schema. Empty string is a sentinel meaning "clear this
 * token override" — handled by the action layer downstream. Non-empty
 * values cap at 200 chars and are screened for CSS metacharacters.
 */
const TokenValueSchema = z
  .string()
  .max(200)
  .refine((v) => v === "" || !FORBIDDEN_CHARS.test(v), {
    message: "value contains forbidden CSS/HTML metacharacter",
  });

export type GateResult = {
  sb: ReturnType<typeof getServiceRoleSupabase>;
  publicUserId: string;
  roles: readonly string[];
};

/**
 * Authenticate + perm-gate + rate-limit. Mirrors the branding/youtube
 * pattern. Throws "Forbidden: missing overlay.design.manage" on perm
 * miss; "rate_limited" if the per-user write limiter trips.
 */
async function gate(): Promise<GateResult> {
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
  return { sb, publicUserId: pub.id, roles };
}

const SaveTokensSchema = z.object({
  overlayKey: OverlayKeyEnum,
  variantId: z.string().min(1).max(64),
  tokens: z.record(z.string(), TokenValueSchema),
});

/**
 * Persist a batch of token edits. The form payload posts a JSON-encoded
 * `tokens` field (the client editor builds it from local state so we
 * don't have to know the field-set up front). Each entry's `token_key`
 * must exist in TOKEN_CATALOG; unknown keys are dropped silently rather
 * than rejected so a stray legacy field doesn't crash the form.
 *
 * For each token: if value is empty string we clear the override; else
 * we upsert with the catalog-derived `token_type`.
 */
export async function saveTokensAction(formData: FormData) {
  const overlayKey = String(formData.get("overlayKey") ?? "");
  const variantId = String(formData.get("variantId") ?? "default");
  const tokensRaw = String(formData.get("tokens") ?? "{}");

  let tokensParsed: unknown;
  try {
    tokensParsed = JSON.parse(tokensRaw);
  } catch {
    throw new Error("tokens must be valid JSON");
  }

  const parsed = SaveTokensSchema.safeParse({
    overlayKey,
    variantId,
    tokens: tokensParsed,
  });
  if (!parsed.success) {
    throw new Error(
      `invalid token payload: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  const { sb, publicUserId, roles } = await gate();
  const actor = { userId: publicUserId, roles };

  for (const [tokenKey, tokenValue] of Object.entries(parsed.data.tokens)) {
    const catalog = TOKEN_CATALOG_BY_KEY[tokenKey];
    if (!catalog) continue; // unknown key — silently drop
    if (tokenValue === "") {
      await clearDesignToken(
        sb,
        actor,
        parsed.data.overlayKey,
        parsed.data.variantId,
        tokenKey,
      );
    } else {
      await setDesignToken(
        sb,
        actor,
        parsed.data.overlayKey,
        parsed.data.variantId,
        tokenKey,
        tokenValue,
        catalog.tokenType,
      );
    }
  }

  revalidatePath("/admin/broadcast/v2/design");
  revalidatePath(`/overlay/v2/${parsed.data.overlayKey}`, "page");
}

const SetActiveTemplateSchema = z.object({
  overlayKey: OverlayKeyEnum,
  variantId: z.string().min(1).max(64),
});

/**
 * Flip which template variant is `active=true` for the given overlay
 * key. Atomic via the partial-unique-index pivot in
 * `setActiveTemplate`.
 */
export async function setActiveTemplateAction(formData: FormData) {
  const overlayKey = String(formData.get("overlayKey") ?? "");
  const variantId = String(formData.get("variantId") ?? "");
  const parsed = SetActiveTemplateSchema.safeParse({ overlayKey, variantId });
  if (!parsed.success) {
    throw new Error(
      `invalid template payload: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { sb, publicUserId, roles } = await gate();
  await setActiveTemplate(
    sb,
    { userId: publicUserId, roles },
    parsed.data.overlayKey,
    parsed.data.variantId,
  );
  revalidatePath("/admin/broadcast/v2/design");
  revalidatePath(`/overlay/v2/${parsed.data.overlayKey}`, "page");
}

const RevertSchema = z.object({
  snapshotId: z.string().uuid(),
  overlayKey: OverlayKeyEnum,
});

/**
 * Restore tokens to a prior snapshot. The form supplies both the
 * snapshot UUID + the overlay_key so we can revalidate the right route
 * without re-querying the snapshot row.
 */
export async function revertToSnapshotAction(formData: FormData) {
  const snapshotId = String(formData.get("snapshotId") ?? "");
  const overlayKey = String(formData.get("overlayKey") ?? "");
  const parsed = RevertSchema.safeParse({ snapshotId, overlayKey });
  if (!parsed.success) {
    throw new Error(
      `invalid revert payload: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { sb, publicUserId, roles } = await gate();
  await revertToSnapshot(
    sb,
    { userId: publicUserId, roles },
    parsed.data.snapshotId,
  );
  revalidatePath("/admin/broadcast/v2/design");
  revalidatePath(`/overlay/v2/${parsed.data.overlayKey}`, "page");
}

/* ------------------------------------------------------------------ *
 * Phase A — bg-image upload                                          *
 * ------------------------------------------------------------------ */

const BG_IMAGE_BUCKET = "overlay-bgs";
const BG_IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const BG_IMAGE_ALLOWED_MIME = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/**
 * Pick a safe extension from a MIME type. Storage will accept any of
 * the bucket's allowed_mime_types regardless, but we tag the filename
 * so future browsers can content-sniff without a roundtrip header.
 */
function extForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
}

export type UploadBgResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Upload an image file to `overlay-bgs/<overlayKey>-<variantId>-<ts>.<ext>`,
 * persist its public URL as the `bg-image` design token for the given
 * overlay+variant, and return the URL.
 *
 * Form fields:
 *   - overlayKey  — required; must be in BG_IMAGE_SUPPORTED_KEYS (8 keys)
 *   - variantId   — defaults to "default"
 *   - file        — required; image/png|image/jpeg|image/webp ≤ 2 MB
 *
 * Authn / authz / rate-limit handled by the shared `gate()` helper.
 *
 * Returns a discriminated union so the client can render an error
 * message inline without unwrapping a thrown Error (server actions
 * stringify thrown errors awkwardly across the RSC boundary).
 */
export async function uploadOverlayBgAction(
  formData: FormData,
): Promise<UploadBgResult> {
  const overlayKey = String(formData.get("overlayKey") ?? "");
  const variantId = String(formData.get("variantId") ?? "default");
  const file = formData.get("file");

  // 1. Schema gates — overlayKey must be valid + bg-image-capable.
  const overlayKeyParsed = OverlayKeyEnum.safeParse(overlayKey);
  if (!overlayKeyParsed.success) {
    return { ok: false, error: `invalid overlayKey: ${overlayKey}` };
  }
  if (!supportsBgImage(overlayKeyParsed.data)) {
    return {
      ok: false,
      error: `overlay ${overlayKey} does not support a bg-image (floating UI on transparent canvas)`,
    };
  }
  if (!variantId || variantId.length > 64) {
    return { ok: false, error: "invalid variantId" };
  }

  // 2. File gates — presence, MIME, size cap.
  if (!file || typeof file === "string" || !(file instanceof File)) {
    return { ok: false, error: "missing or invalid file field" };
  }
  if (!BG_IMAGE_ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      error: `unsupported MIME type ${file.type} (allowed: png, jpeg, webp)`,
    };
  }
  if (file.size > BG_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: `file too large (${file.size} bytes; max ${BG_IMAGE_MAX_BYTES})`,
    };
  }
  if (file.size === 0) {
    return { ok: false, error: "empty file" };
  }

  // 3. Auth + rate-limit. `gate()` throws on perm miss / rate limit.
  let gateResult: GateResult;
  try {
    gateResult = await gate();
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "auth gate failed",
    };
  }
  const { sb, publicUserId, roles } = gateResult;

  // 4. Upload via service-role client.
  const ext = extForMime(file.type);
  const ts = Date.now();
  const filename = `${overlayKeyParsed.data}-${variantId}-${ts}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await sb.storage
    .from(BG_IMAGE_BUCKET)
    .upload(filename, buffer, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadErr) {
    return { ok: false, error: `storage upload failed: ${uploadErr.message}` };
  }

  // 5. Resolve the public URL — bucket is public so no signed-URL needed.
  const { data: publicUrlData } = sb.storage
    .from(BG_IMAGE_BUCKET)
    .getPublicUrl(filename);
  const publicUrl = publicUrlData?.publicUrl ?? "";
  if (!publicUrl) {
    return { ok: false, error: "could not resolve public URL after upload" };
  }
  // Defence-in-depth: the URL we got back from Supabase should never
  // contain CSS metacharacters (it's `<bucket-base>/<filename>`), but
  // refuse to persist if it somehow does.
  if (/[;{}<>"']/.test(publicUrl)) {
    return { ok: false, error: "rejected public URL contains forbidden characters" };
  }

  // 6. Persist the token. setDesignToken handles the audit-history snapshot.
  try {
    await setDesignToken(
      sb,
      { userId: publicUserId, roles },
      overlayKeyParsed.data,
      variantId,
      "bg-image",
      publicUrl,
      "image",
    );
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "setDesignToken failed",
    };
  }

  revalidatePath("/admin/broadcast/v2/design");
  revalidatePath(`/overlay/v2/${overlayKeyParsed.data}`, "page");
  return { ok: true, url: publicUrl };
}
