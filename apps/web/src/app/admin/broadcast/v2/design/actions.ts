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
import type {
  PartnerStripAnchor,
  PartnerStripJustification,
  PartnerStripOrientation,
} from "@/server/overlays/partners/strip";
import {
  createPartnerLogo,
  deletePartnerLogo,
} from "@/server/overlays/partners/logos";
import {
  upsertAnimation,
  deleteAnimation,
  type AnimPhase,
  type AnimType,
} from "@/server/overlays/animations/elements";

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

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 3 — partner-strip + logo manager                      *
 * ------------------------------------------------------------------ */

/**
 * Strip-layout enums mirror the DB CHECK constraints (migration
 * `20260620000002_overlay_partner_strip_layout.sql`) and the server
 * module's runtime validator (`partners/strip.ts::validateInput`).
 *
 * The Zod schema accepts FormData strings, then coerces to typed
 * numbers / enums before calling `upsertStripLayout`.
 */
const PARTNER_ANCHOR = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const satisfies readonly PartnerStripAnchor[];
const PARTNER_ORIENTATION = [
  "horizontal",
  "vertical",
] as const satisfies readonly PartnerStripOrientation[];
const PARTNER_JUSTIFICATION = [
  "start",
  "center",
  "end",
  "space-between",
] as const satisfies readonly PartnerStripJustification[];

const SetStripLayoutSchema = z.object({
  overlayKey: OverlayKeyEnum,
  variantId: z.string().min(1).max(64),
  visible: z.enum(["true", "false"]),
  positionXPx: z.coerce.number().int().min(-1920).max(1920),
  positionYPx: z.coerce.number().int().min(-1080).max(1080),
  anchor: z.enum(PARTNER_ANCHOR as readonly string[] as [string, ...string[]]),
  orientation: z.enum(
    PARTNER_ORIENTATION as readonly string[] as [string, ...string[]],
  ),
  scalePct: z.coerce.number().int().min(50).max(200),
  itemSpacingPx: z.coerce.number().int().min(0).max(256),
  justification: z.enum(
    PARTNER_JUSTIFICATION as readonly string[] as [string, ...string[]],
  ),
  zIndex: z.coerce.number().int().min(0).max(40),
});

/**
 * Persist the partner-strip layout for an overlay+variant. Idempotent
 * upsert keyed on (overlay_key, variant_id). The bootstrap script reads
 * the row and applies anchor → top/bottom/left/right computation
 * client-side (see spec §6.2).
 *
 * NOTE on upsert path: `overlay_partner_strip_layout` has a PARTIAL
 * unique index (`WHERE deleted_at IS NULL`). Postgres' `INSERT ... ON
 * CONFLICT (cols) DO UPDATE` requires a non-partial constraint OR an
 * explicit WHERE on the conflict target — Supabase JS client only
 * supports the column-list form, which fails inference against partial
 * indexes ("there is no unique or exclusion constraint matching the
 * ON CONFLICT specification"). We therefore SELECT first and pick
 * INSERT-or-UPDATE manually instead of going through the server
 * module's upsert wrapper.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.4
 */
export async function setStripLayoutAction(formData: FormData) {
  const raw = {
    overlayKey: String(formData.get("overlayKey") ?? ""),
    variantId: String(formData.get("variantId") ?? "default"),
    visible: String(formData.get("visible") ?? "true"),
    positionXPx: String(formData.get("positionXPx") ?? "0"),
    positionYPx: String(formData.get("positionYPx") ?? "1020"),
    anchor: String(formData.get("anchor") ?? "bottom-center"),
    orientation: String(formData.get("orientation") ?? "horizontal"),
    scalePct: String(formData.get("scalePct") ?? "100"),
    itemSpacingPx: String(formData.get("itemSpacingPx") ?? "64"),
    justification: String(formData.get("justification") ?? "center"),
    zIndex: String(formData.get("zIndex") ?? "12"),
  };
  const parsed = SetStripLayoutSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid strip layout payload: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const { sb, publicUserId } = await gate();

  // Range checks mirror the server-module validator so we still throw on
  // bad input even though we're side-stepping the upsert wrapper.
  if (parsed.data.scalePct < 50 || parsed.data.scalePct > 200) {
    throw new Error("scalePct out of range (50..200)");
  }
  if (parsed.data.itemSpacingPx < 0 || parsed.data.itemSpacingPx > 256) {
    throw new Error("itemSpacingPx out of range (0..256)");
  }
  if (parsed.data.zIndex < 0 || parsed.data.zIndex > 40) {
    throw new Error("zIndex out of range (0..40)");
  }

  const nowIso = new Date().toISOString();
  const row = {
    overlay_key: parsed.data.overlayKey,
    variant_id: parsed.data.variantId,
    visible: parsed.data.visible === "true",
    position_x_px: parsed.data.positionXPx,
    position_y_px: parsed.data.positionYPx,
    anchor: parsed.data.anchor,
    orientation: parsed.data.orientation,
    scale_pct: parsed.data.scalePct,
    item_spacing_px: parsed.data.itemSpacingPx,
    justification: parsed.data.justification,
    z_index: parsed.data.zIndex,
    set_by: publicUserId,
    updated_at: nowIso,
    deleted_at: null,
  };

  // SELECT-then-INSERT-or-UPDATE.
  const { data: existing } = await sb
    .from("overlay_partner_strip_layout")
    .select("id")
    .eq("overlay_key", parsed.data.overlayKey)
    .eq("variant_id", parsed.data.variantId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    const { error } = await sb
      .from("overlay_partner_strip_layout")
      .update(row)
      .eq("id", (existing as { id: string }).id);
    if (error) throw new Error(`setStripLayoutAction (update): ${error.message}`);
  } else {
    const { error } = await sb
      .from("overlay_partner_strip_layout")
      .insert(row);
    if (error) throw new Error(`setStripLayoutAction (insert): ${error.message}`);
  }

  revalidatePath("/admin/broadcast/v2/design");
  revalidatePath(`/overlay/v2/${parsed.data.overlayKey}`, "page");
}

/* ----- Logo upload ----- */

const PARTNER_LOGO_BUCKET = "partner-logos";
const PARTNER_LOGO_MAX_BYTES = 500 * 1024; // 500 KB per spec §7
const PARTNER_LOGO_ALLOWED_MIME = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

/**
 * Spec §7 dimension contract: 600 × 300 ±10% (i.e. 540..660 wide,
 * 270..330 tall). SVG bypasses the check (vector — sized via
 * `scalePct`).
 */
const PARTNER_LOGO_MIN_W = 540;
const PARTNER_LOGO_MAX_W = 660;
const PARTNER_LOGO_MIN_H = 270;
const PARTNER_LOGO_MAX_H = 330;

const PARTNER_KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;

function partnerLogoExtForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

export type UploadPartnerLogoResult =
  | { ok: true; partnerKey: string; fileUrl: string }
  | {
      ok: false;
      error: string;
      actualDimensions?: { w: number; h: number };
    };

/**
 * Upload a partner logo to the `partner-logos` bucket and create a row
 * in `overlay_partner_logos`. Validates MIME / size / dimensions
 * (≈600×300 ±10%, SVG bypasses dimension check). Returns a
 * discriminated union so the modal can surface the actual measured
 * dimensions on rejection.
 *
 * Form fields:
 *   - file        — required; PNG/JPG/WebP/SVG ≤ 500 KB
 *   - partnerKey  — required; kebab-case, unique
 *   - label       — required; ≤ 200 chars
 *   - alt         — required; ≤ 200 chars
 *   - sortOrder   — optional; integer 0..999, default 0
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.4, §7
 */
export async function uploadPartnerLogoAction(
  formData: FormData,
): Promise<UploadPartnerLogoResult> {
  const partnerKey = String(formData.get("partnerKey") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const alt = String(formData.get("alt") ?? "").trim();
  const sortOrderRaw = String(formData.get("sortOrder") ?? "0");
  const file = formData.get("file");

  // 1. Field gates.
  if (!PARTNER_KEY_RE.test(partnerKey)) {
    return {
      ok: false,
      error:
        "partnerKey must be kebab-case (lowercase letter then a-z, 0-9, -)",
    };
  }
  if (!label || label.length > 200) {
    return { ok: false, error: "label required (1..200 chars)" };
  }
  if (!alt || alt.length > 200) {
    return { ok: false, error: "alt required (1..200 chars)" };
  }
  const sortOrder = Number(sortOrderRaw);
  if (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > 999) {
    return { ok: false, error: "sortOrder must be integer 0..999" };
  }

  // 2. File gates.
  if (!file || typeof file === "string" || !(file instanceof File)) {
    return { ok: false, error: "missing or invalid file field" };
  }
  if (!PARTNER_LOGO_ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      error: `unsupported MIME type ${file.type} (allowed: png, jpeg, webp, svg+xml)`,
    };
  }
  if (file.size === 0) {
    return { ok: false, error: "empty file" };
  }
  if (file.size > PARTNER_LOGO_MAX_BYTES) {
    return {
      ok: false,
      error: `file too large (${file.size} bytes; max ${PARTNER_LOGO_MAX_BYTES})`,
    };
  }

  // 3. Probe dimensions via `sharp` (skip for SVG — vector).
  const buffer = Buffer.from(await file.arrayBuffer());
  const isVector = file.type === "image/svg+xml";
  let dimensionWPx = 600;
  let dimensionHPx = 300;
  if (!isVector) {
    try {
      // dynamic import keeps `sharp` out of the cold-start path for actions
      // that never touch image bytes.
      const sharp = (await import("sharp")).default;
      const meta = await sharp(buffer).metadata();
      if (!meta.width || !meta.height) {
        return { ok: false, error: "could not read image dimensions" };
      }
      dimensionWPx = meta.width;
      dimensionHPx = meta.height;
    } catch (e) {
      return {
        ok: false,
        error: `image probe failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (
      dimensionWPx < PARTNER_LOGO_MIN_W ||
      dimensionWPx > PARTNER_LOGO_MAX_W ||
      dimensionHPx < PARTNER_LOGO_MIN_H ||
      dimensionHPx > PARTNER_LOGO_MAX_H
    ) {
      return {
        ok: false,
        error: `Got ${dimensionWPx}×${dimensionHPx}, expected 600×300 ±10% (${PARTNER_LOGO_MIN_W}..${PARTNER_LOGO_MAX_W} × ${PARTNER_LOGO_MIN_H}..${PARTNER_LOGO_MAX_H})`,
        actualDimensions: { w: dimensionWPx, h: dimensionHPx },
      };
    }
  }

  // 4. Auth + rate-limit.
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

  // 5. Upload to Storage. `<partnerKey>-<ts>.<ext>` filename ensures a
  // re-upload of the same key replaces the previous file conceptually
  // (the DB row carries the file_url so we don't need to delete the old
  // blob — Storage retains it for forensics + as a fallback).
  const ext = partnerLogoExtForMime(file.type);
  const ts = Date.now();
  const filename = `${partnerKey}-${ts}.${ext}`;
  const { error: uploadErr } = await sb.storage
    .from(PARTNER_LOGO_BUCKET)
    .upload(filename, buffer, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadErr) {
    return {
      ok: false,
      error: `storage upload failed: ${uploadErr.message}`,
    };
  }

  const { data: publicUrlData } = sb.storage
    .from(PARTNER_LOGO_BUCKET)
    .getPublicUrl(filename);
  const publicUrl = publicUrlData?.publicUrl ?? "";
  if (!publicUrl) {
    return { ok: false, error: "could not resolve public URL after upload" };
  }
  if (/[;{}<>"']/.test(publicUrl)) {
    return {
      ok: false,
      error: "rejected public URL contains forbidden characters",
    };
  }

  // 6. Persist the row.
  try {
    await createPartnerLogo(
      sb,
      { userId: publicUserId, roles },
      {
        partnerKey,
        label,
        alt,
        fileUrl: publicUrl,
        fileSizeBytes: file.size,
        dimensionWPx,
        dimensionHPx,
        sortOrder,
      },
    );
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "createPartnerLogo failed",
    };
  }

  revalidatePath("/admin/broadcast/v2/design");
  return { ok: true, partnerKey, fileUrl: publicUrl };
}

/* ----- Logo soft-delete ----- */

const RemovePartnerLogoSchema = z.object({
  partnerKey: z.string().regex(PARTNER_KEY_RE, {
    message: "partnerKey must be kebab-case",
  }),
});

/**
 * Soft-delete a partner logo (`overlay_partner_logos.deleted_at`). The
 * partial unique index allows the same `partner_key` to be re-uploaded
 * after a soft delete because it filters on `deleted_at IS NULL`.
 */
export async function removePartnerLogoAction(formData: FormData) {
  const raw = {
    partnerKey: String(formData.get("partnerKey") ?? ""),
  };
  const parsed = RemovePartnerLogoSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid remove payload: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }

  const { sb, publicUserId, roles } = await gate();
  await deletePartnerLogo(
    sb,
    { userId: publicUserId, roles },
    parsed.data.partnerKey,
  );

  revalidatePath("/admin/broadcast/v2/design");
}

/* ----- Per-overlay logo override ----- */

const SetLogoOverrideSchema = z.object({
  overlayKey: OverlayKeyEnum,
  variantId: z.string().min(1).max(64),
  partnerKey: z.string().regex(PARTNER_KEY_RE),
  visible: z.enum(["true", "false"]),
  // Empty string = no sort override; falls back to global sort_order.
  sortOverride: z.string().optional(),
});

/**
 * Per-overlay-per-variant override row in
 * `overlay_partner_logo_overrides`. Toggle visibility + optionally
 * pin a sort position. Empty `sortOverride` field clears the override
 * (sets DB column to NULL via the server module).
 *
 * Same partial-unique-index workaround as `setStripLayoutAction`:
 * SELECT first, then INSERT-or-UPDATE manually because Supabase JS
 * `.upsert(...)` cannot infer against a partial unique index.
 */
export async function setLogoOverrideAction(formData: FormData) {
  const raw = {
    overlayKey: String(formData.get("overlayKey") ?? ""),
    variantId: String(formData.get("variantId") ?? "default"),
    partnerKey: String(formData.get("partnerKey") ?? ""),
    visible: String(formData.get("visible") ?? "true"),
    sortOverride: (formData.get("sortOverride") as string | null) ?? "",
  };
  const parsed = SetLogoOverrideSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid override payload: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }

  let sortOverride: number | null = null;
  if (parsed.data.sortOverride && parsed.data.sortOverride !== "") {
    const n = Number(parsed.data.sortOverride);
    if (!Number.isFinite(n) || n < 0 || n > 999) {
      throw new Error("sortOverride must be integer 0..999");
    }
    sortOverride = Math.trunc(n);
  }

  const { sb, publicUserId } = await gate();
  const nowIso = new Date().toISOString();
  const row = {
    overlay_key: parsed.data.overlayKey,
    variant_id: parsed.data.variantId,
    partner_key: parsed.data.partnerKey,
    visible: parsed.data.visible === "true",
    sort_override: sortOverride,
    set_by: publicUserId,
    updated_at: nowIso,
    deleted_at: null,
  };

  const { data: existing } = await sb
    .from("overlay_partner_logo_overrides")
    .select("id")
    .eq("overlay_key", parsed.data.overlayKey)
    .eq("variant_id", parsed.data.variantId)
    .eq("partner_key", parsed.data.partnerKey)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    const { error } = await sb
      .from("overlay_partner_logo_overrides")
      .update(row)
      .eq("id", (existing as { id: string }).id);
    if (error) {
      throw new Error(`setLogoOverrideAction (update): ${error.message}`);
    }
  } else {
    const { error } = await sb
      .from("overlay_partner_logo_overrides")
      .insert(row);
    if (error) {
      throw new Error(`setLogoOverrideAction (insert): ${error.message}`);
    }
  }

  revalidatePath("/admin/broadcast/v2/design");
  revalidatePath(`/overlay/v2/${parsed.data.overlayKey}`, "page");
}

/* ------------------------------------------------------------------ *
 * Wave 2 Stage 4 — element animations                                *
 * ------------------------------------------------------------------ */

/**
 * Animation enums mirror the DB CHECK constraints
 * (`overlay_element_animations.anim_phase`,
 *  `overlay_element_animations.anim_type`) and the server module's
 * runtime validator (`animations/elements.ts::validateInput`).
 */
const ANIM_PHASE_ENUM = ["entry", "exit", "continuous"] as const satisfies readonly AnimPhase[];
const ANIM_TYPE_ENUM = [
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
  "fade",
  "scale",
  "rotate",
  "bounce",
  "pulse",
  "glow",
  "shake",
  "flip",
  "custom-css",
  "none",
] as const satisfies readonly AnimType[];

const SetAnimationSchema = z.object({
  overlayKey: OverlayKeyEnum,
  variantId: z.string().min(1).max(64),
  elementId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]{0,63}$/, {
      message: "elementId must be kebab-case (a-z, 0-9, -)",
    }),
  animPhase: z.enum(
    ANIM_PHASE_ENUM as readonly string[] as [string, ...string[]],
  ),
  enabled: z.enum(["true", "false"]),
  animType: z.enum(
    ANIM_TYPE_ENUM as readonly string[] as [string, ...string[]],
  ),
  durationMs: z.coerce.number().int().min(50).max(5000),
  delayMs: z.coerce.number().int().min(0).max(5000),
  easing: z.string().min(1).max(80),
  iterationCount: z.string().min(1).max(10),
  customCssKeyframes: z.string().max(4096).optional(),
});

/**
 * Persist an element-animation override. The action upserts a row in
 * `overlay_element_animations` keyed on (overlay_key, variant_id,
 * element_id, anim_phase). Stage 1's `upsertAnimation` does the
 * `validateInput()` pass + the `sanitizeKeyframes` call when
 * `animType === 'custom-css'`. The action layer's responsibility is
 * the perm gate, FormData → typed input coercion, and the revalidate
 * cycle.
 *
 * `customCssKeyframes` is dropped entirely when `animType !== 'custom-
 * css'` — the server module rejects non-null payloads on non-custom
 * types as a defence-in-depth pass.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.5, §3.4
 */
export async function setAnimationAction(formData: FormData) {
  const raw = {
    overlayKey: String(formData.get("overlayKey") ?? ""),
    variantId: String(formData.get("variantId") ?? "default"),
    elementId: String(formData.get("elementId") ?? ""),
    animPhase: String(formData.get("animPhase") ?? ""),
    enabled: String(formData.get("enabled") ?? "true"),
    animType: String(formData.get("animType") ?? "fade"),
    durationMs: String(formData.get("durationMs") ?? "360"),
    delayMs: String(formData.get("delayMs") ?? "0"),
    easing: String(formData.get("easing") ?? "ease-out"),
    iterationCount: String(formData.get("iterationCount") ?? "1"),
    customCssKeyframes:
      (formData.get("customCssKeyframes") as string | null) ?? undefined,
  };
  const parsed = SetAnimationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid animation payload: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const { sb, publicUserId, roles } = await gate();
  const customKeyframes =
    parsed.data.animType === "custom-css"
      ? parsed.data.customCssKeyframes ?? null
      : null;

  await upsertAnimation(
    sb,
    { userId: publicUserId, roles },
    {
      overlayKey: parsed.data.overlayKey,
      variantId: parsed.data.variantId,
      elementId: parsed.data.elementId,
      animPhase: parsed.data.animPhase as AnimPhase,
      enabled: parsed.data.enabled === "true",
      animType: parsed.data.animType as AnimType,
      durationMs: parsed.data.durationMs,
      delayMs: parsed.data.delayMs,
      easing: parsed.data.easing,
      iterationCount: parsed.data.iterationCount,
      customCssKeyframes: customKeyframes,
    },
  );

  revalidatePath("/admin/broadcast/v2/design");
  revalidatePath(`/overlay/v2/${parsed.data.overlayKey}`, "page");
}

const ClearAnimationSchema = z.object({
  overlayKey: OverlayKeyEnum,
  variantId: z.string().min(1).max(64),
  elementId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]{0,63}$/),
  animPhase: z.enum(
    ANIM_PHASE_ENUM as readonly string[] as [string, ...string[]],
  ),
});

/**
 * Soft-delete an element-animation row for (element_id, anim_phase).
 * Sets `deleted_at` so the resolver skips it; subsequent
 * `setAnimationAction` calls on the same row re-create / re-enable.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §5.5, §3.4
 */
export async function clearAnimationAction(formData: FormData) {
  const raw = {
    overlayKey: String(formData.get("overlayKey") ?? ""),
    variantId: String(formData.get("variantId") ?? "default"),
    elementId: String(formData.get("elementId") ?? ""),
    animPhase: String(formData.get("animPhase") ?? ""),
  };
  const parsed = ClearAnimationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid clear animation payload: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }

  const { sb, publicUserId, roles } = await gate();
  await deleteAnimation(
    sb,
    { userId: publicUserId, roles },
    parsed.data.overlayKey,
    parsed.data.variantId,
    parsed.data.elementId,
    parsed.data.animPhase as AnimPhase,
  );

  revalidatePath("/admin/broadcast/v2/design");
  revalidatePath(`/overlay/v2/${parsed.data.overlayKey}`, "page");
}
