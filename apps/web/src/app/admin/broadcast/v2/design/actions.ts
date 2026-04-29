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
import {
  upsertTextElement,
  getTextElement,
  type TextAlignment,
  type TextKind,
} from "@/server/overlays/text/elements";

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

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 2 — text-element editing                              *
 * ------------------------------------------------------------------ */

/**
 * Form payload schema for text-element edits.
 *
 * The admin UI POSTs one element at a time (vs. the batched `tokens`
 * field used by saveTokensAction). Each field is optional — empty
 * strings clear the override and inherit the HTML default. The Zod
 * schema accepts strings (FormData round-trips everything as text), then
 * coerces to the typed shape `upsertTextElement` expects.
 *
 * `content` cap: 1024 chars (also enforced server-side in
 * `validateInput`). `color` regex matches the css-validator allowlist.
 * Position fields accept negative values so admins can pull elements
 * partly off-stage if a design calls for it.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.3, §3.1
 */
const TEXT_KINDS = [
  "heading",
  "subheading",
  "eyebrow",
  "title",
  "subtitle",
  "caption",
  "number",
  "label",
  "body",
  "image",
  "layout",
] as const satisfies readonly TextKind[];

const TEXT_ALIGNMENTS = [
  "left",
  "center",
  "right",
  "justify",
] as const satisfies readonly TextAlignment[];

const TEXT_FONT_FAMILIES = [
  "Agharti",
  "Quedora",
  "Inter",
  "JetBrains Mono",
] as const;

const SetTextElementSchema = z.object({
  overlayKey: OverlayKeyEnum,
  variantId: z.string().min(1).max(64),
  elementId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]{0,63}$/, {
      message: "elementId must be kebab-case (a-z, 0-9, -)",
    }),
  // Optional fields — empty string sentinel means "inherit HTML default".
  visible: z.enum(["true", "false"]).optional(),
  content: z.string().max(1024).optional(),
  fontFamily: z.string().max(40).optional(),
  fontWeight: z.string().max(4).optional(),
  fontSizePx: z.string().max(4).optional(),
  letterSpacing: z.string().max(8).optional(),
  lineHeight: z.string().max(8).optional(),
  color: z.string().max(40).optional(),
  alignment: z.string().max(10).optional(),
  opacityPct: z.string().max(4).optional(),
  positionXPx: z.string().max(6).optional(),
  positionYPx: z.string().max(6).optional(),
  zIndex: z.string().max(3).optional(),
});

function parseOptInt(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseOptFloat(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseOptStr<T extends string>(
  s: string | undefined,
  allowed: readonly T[],
): T | null {
  if (s == null || s === "") return null;
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

/**
 * Persist a text-element override. The action upserts a row in
 * `overlay_text_elements`. Empty-string field values map to NULL so the
 * row stays a "partial override" — only the populated fields flow into
 * the resolver's effective styles map.
 *
 * Seed-catalog rows are pre-inserted with `origin='seed'` and all-NULL
 * typography fields (see migration `20260620000007`). We re-fetch the
 * row first to preserve `kind` + `origin`; if the row doesn't exist yet
 * (admin-created runtime element), we accept a `kind` from the form and
 * default origin to 'runtime'.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.3
 */
export async function setTextElementAction(formData: FormData) {
  const raw = {
    overlayKey: String(formData.get("overlayKey") ?? ""),
    variantId: String(formData.get("variantId") ?? "default"),
    elementId: String(formData.get("elementId") ?? ""),
    visible: (formData.get("visible") as string | null) ?? undefined,
    content: (formData.get("content") as string | null) ?? undefined,
    fontFamily: (formData.get("fontFamily") as string | null) ?? undefined,
    fontWeight: (formData.get("fontWeight") as string | null) ?? undefined,
    fontSizePx: (formData.get("fontSizePx") as string | null) ?? undefined,
    letterSpacing:
      (formData.get("letterSpacing") as string | null) ?? undefined,
    lineHeight: (formData.get("lineHeight") as string | null) ?? undefined,
    color: (formData.get("color") as string | null) ?? undefined,
    alignment: (formData.get("alignment") as string | null) ?? undefined,
    opacityPct: (formData.get("opacityPct") as string | null) ?? undefined,
    positionXPx: (formData.get("positionXPx") as string | null) ?? undefined,
    positionYPx: (formData.get("positionYPx") as string | null) ?? undefined,
    zIndex: (formData.get("zIndex") as string | null) ?? undefined,
  };

  const parsed = SetTextElementSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid text element payload: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const { sb, publicUserId, roles } = await gate();
  const actor = { userId: publicUserId, roles };

  // Look up the existing row so we keep `kind` + `origin` stable. If no
  // row exists (admin is creating a runtime element from scratch), we
  // require `kind` from FormData and default origin='runtime'. Seed rows
  // are pre-populated by migration `20260620000007` — admins editing seed
  // overlays will always hit this branch.
  const existing = await getTextElement(
    sb,
    parsed.data.overlayKey,
    parsed.data.variantId,
    parsed.data.elementId,
  );

  const kindFromForm = String(formData.get("kind") ?? "");
  const kind = existing
    ? existing.kind
    : ((TEXT_KINDS as readonly string[]).includes(kindFromForm)
        ? (kindFromForm as TextKind)
        : ("body" as TextKind));
  const origin = existing ? existing.origin : "runtime";
  const sortOrder = existing ? existing.sortOrder : 0;

  const visibleParsed =
    parsed.data.visible === "false"
      ? false
      : parsed.data.visible === "true"
        ? true
        : (existing?.visible ?? true);

  await upsertTextElement(sb, actor, {
    overlayKey: parsed.data.overlayKey,
    variantId: parsed.data.variantId,
    elementId: parsed.data.elementId,
    origin,
    kind,
    visible: visibleParsed,
    content: parsed.data.content ?? "",
    fontFamily: parseOptStr(parsed.data.fontFamily, TEXT_FONT_FAMILIES),
    fontWeight: parseOptInt(parsed.data.fontWeight),
    fontSizePx: parseOptInt(parsed.data.fontSizePx),
    letterSpacing: parseOptFloat(parsed.data.letterSpacing),
    lineHeight: parseOptFloat(parsed.data.lineHeight),
    color: parsed.data.color && parsed.data.color !== "" ? parsed.data.color : null,
    alignment: parseOptStr(parsed.data.alignment, TEXT_ALIGNMENTS),
    opacityPct: parseOptInt(parsed.data.opacityPct),
    positionXPx: parseOptInt(parsed.data.positionXPx),
    positionYPx: parseOptInt(parsed.data.positionYPx),
    zIndex: parseOptInt(parsed.data.zIndex),
    sortOrder,
  });

  revalidatePath("/admin/broadcast/v2/design");
  revalidatePath(`/overlay/v2/${parsed.data.overlayKey}`, "page");
}

const ClearTextElementSchema = z.object({
  overlayKey: OverlayKeyEnum,
  variantId: z.string().min(1).max(64),
  elementId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]{0,63}$/),
});

/**
 * Reset a text-element row to "no override" — every typography field
 * goes NULL, content goes empty string. For seed rows this returns the
 * overlay to its HTML default render (the resolver skips no-op rows).
 *
 * For runtime rows the row stays soft-alive (visible toggleable) but
 * with no styling overrides. To fully remove a runtime row, the admin
 * uses a separate delete action (not in scope for Stage 2 — runtime
 * element addition is Stage 3).
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.3
 */
export async function clearTextElementAction(formData: FormData) {
  const raw = {
    overlayKey: String(formData.get("overlayKey") ?? ""),
    variantId: String(formData.get("variantId") ?? "default"),
    elementId: String(formData.get("elementId") ?? ""),
  };
  const parsed = ClearTextElementSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid clear payload: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }

  const { sb, publicUserId, roles } = await gate();
  const actor = { userId: publicUserId, roles };

  const existing = await getTextElement(
    sb,
    parsed.data.overlayKey,
    parsed.data.variantId,
    parsed.data.elementId,
  );
  if (!existing) {
    // Nothing to clear — no-op (still revalidate so the UI re-fetches).
    revalidatePath("/admin/broadcast/v2/design");
    revalidatePath(`/overlay/v2/${parsed.data.overlayKey}`, "page");
    return;
  }

  await upsertTextElement(sb, actor, {
    overlayKey: parsed.data.overlayKey,
    variantId: parsed.data.variantId,
    elementId: parsed.data.elementId,
    origin: existing.origin,
    kind: existing.kind,
    visible: true,
    content: "",
    fontFamily: null,
    fontWeight: null,
    fontSizePx: null,
    letterSpacing: null,
    lineHeight: null,
    color: null,
    alignment: null,
    opacityPct: null,
    positionXPx: null,
    positionYPx: null,
    zIndex: null,
    sortOrder: existing.sortOrder,
  });

  revalidatePath("/admin/broadcast/v2/design");
  revalidatePath(`/overlay/v2/${parsed.data.overlayKey}`, "page");
}
