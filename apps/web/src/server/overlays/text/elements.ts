import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import {
  isValidColor,
  isValidElementId,
  isValidFont,
  isValidAlignment,
} from "../_shared/css-validator";
import { OVERLAY_KEYS } from "../design/defaults";

/**
 * Overlay Design Page v2 — text-element CRUD + resolver.
 *
 * Per spec §2.1 + §3.1: each row is either an OVERRIDE of an existing
 * HTML element matched by `data-element-id` (origin='seed') OR a
 * runtime-injected element added by an admin (origin='runtime'). All
 * typography fields are nullable; only populated fields flow into the
 * effective per-element CSS via `resolveTextElements`.
 *
 * Mutations gate on `overlay.design.manage`. Reads are unauthenticated
 * at this layer — the SSR overlay route + Stage 2 admin UI own the
 * outer auth gate.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.1, §3.1
 */

export type TextOrigin = "seed" | "runtime";

/**
 * Kind catalog — drives the admin Text-panel row label + groups elements
 * for editor affordances (e.g. score-number gets a numeric input, image
 * kinds skip the content field, etc.).
 *
 * Two cohorts coexist for back-compat:
 *  - Legacy typographic enum (heading/subheading/eyebrow/title/...) —
 *    the original Stage 1 seed used these.
 *  - Semantic enum (text/score-number/player-name/player-photo/...) —
 *    introduced 2026-04-28 by migration `20260620000010_*` so admins
 *    see a meaningful "what is this element" label rather than a typo
 *    classification.
 *
 * Both groups are accepted by the DB CHECK constraint. Backfill in the
 * same migration moves seed rows over to the semantic enum where the
 * legacy value was less specific.
 */
export type TextKind =
  // Legacy typographic enum (kept for back-compat).
  | "heading"
  | "subheading"
  | "eyebrow"
  | "title"
  | "subtitle"
  | "caption"
  | "number"
  | "label"
  | "body"
  | "image"
  | "layout"
  // Semantic enum (post-2026-04-28 — universal element labels).
  | "text"
  | "score-number"
  | "player-name"
  | "player-photo"
  | "player-box"
  | "sponsor-logo-strip"
  | "sponsor-logo-floating"
  | "partner-strip-container"
  | "bg-image"
  | "bg-vignette"
  | "box";

/**
 * Allowlist mirror of `TextKind` for runtime validation. Matches the DB
 * CHECK constraint introduced in migration `20260620000010_*`.
 */
export const TEXT_KINDS: ReadonlyArray<TextKind> = [
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
  "text",
  "score-number",
  "player-name",
  "player-photo",
  "player-box",
  "sponsor-logo-strip",
  "sponsor-logo-floating",
  "partner-strip-container",
  "bg-image",
  "bg-vignette",
  "box",
];

export function isValidTextKind(value: unknown): value is TextKind {
  return (
    typeof value === "string" &&
    (TEXT_KINDS as readonly string[]).includes(value)
  );
}

export type TextAlignment = "left" | "center" | "right" | "justify";

export type TextElement = {
  id: string;
  overlayKey: string;
  variantId: string;
  elementId: string;
  origin: TextOrigin;
  kind: TextKind;
  /**
   * Human-readable name shown in the admin UI (e.g. "BRB Title",
   * "Player A Photo"). NULL falls back to `prettyId(elementId)` in the
   * editor so a missing label never produces a blank row header.
   */
  displayLabel: string | null;
  visible: boolean;
  content: string;
  fontFamily: string | null;
  fontWeight: number | null;
  fontSizePx: number | null;
  letterSpacing: number | null;
  lineHeight: number | null;
  color: string | null;
  alignment: TextAlignment | null;
  opacityPct: number | null;
  positionXPx: number | null;
  positionYPx: number | null;
  zIndex: number | null;
  sortOrder: number;
  setBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TextElementInput = Omit<
  TextElement,
  "id" | "setBy" | "createdAt" | "updatedAt"
>;

export type ResolvedTextElement = {
  origin: TextOrigin;
  visible: boolean;
  content: string | null;
  styles: Partial<{
    fontFamily: string;
    fontWeight: number;
    fontSize: string;
    letterSpacing: string;
    lineHeight: number;
    color: string;
    textAlign: TextAlignment;
    opacity: number;
    left: string;
    top: string;
    zIndex: number;
  }>;
};

type Row = {
  id: string;
  overlay_key: string;
  variant_id: string;
  element_id: string;
  origin: TextOrigin;
  kind: TextKind;
  display_label: string | null;
  visible: boolean;
  content: string;
  font_family: string | null;
  font_weight: number | null;
  font_size_px: number | null;
  letter_spacing: number | string | null;
  line_height: number | string | null;
  color: string | null;
  alignment: TextAlignment | null;
  opacity_pct: number | null;
  position_x_px: number | null;
  position_y_px: number | null;
  z_index: number | null;
  sort_order: number;
  set_by: string;
  created_at: string;
  updated_at: string;
};

const SELECT_COLS =
  "id, overlay_key, variant_id, element_id, origin, kind, display_label, visible, content, font_family, font_weight, font_size_px, letter_spacing, line_height, color, alignment, opacity_pct, position_x_px, position_y_px, z_index, sort_order, set_by, created_at, updated_at";

function toElement(r: Row): TextElement {
  const ls = r.letter_spacing == null ? null : Number(r.letter_spacing);
  const lh = r.line_height == null ? null : Number(r.line_height);
  return {
    id: r.id,
    overlayKey: r.overlay_key,
    variantId: r.variant_id,
    elementId: r.element_id,
    origin: r.origin,
    kind: r.kind,
    displayLabel: r.display_label ?? null,
    visible: r.visible,
    content: r.content,
    fontFamily: r.font_family,
    fontWeight: r.font_weight,
    fontSizePx: r.font_size_px,
    letterSpacing: ls,
    lineHeight: lh,
    color: r.color,
    alignment: r.alignment,
    opacityPct: r.opacity_pct,
    positionXPx: r.position_x_px,
    positionYPx: r.position_y_px,
    zIndex: r.z_index,
    sortOrder: r.sort_order,
    setBy: r.set_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function validateInput(input: TextElementInput): void {
  if (!(OVERLAY_KEYS as readonly string[]).includes(input.overlayKey)) {
    throw new Error(`upsertTextElement: unknown overlay key ${input.overlayKey}`);
  }
  if (!isValidElementId(input.elementId)) {
    throw new Error(`upsertTextElement: invalid element_id ${input.elementId}`);
  }
  if (!isValidTextKind(input.kind)) {
    throw new Error(
      `upsertTextElement: invalid kind ${String(input.kind)} (allowlist: ${TEXT_KINDS.join(", ")})`,
    );
  }
  if (
    input.displayLabel != null &&
    (input.displayLabel.length === 0 || input.displayLabel.length > 200)
  ) {
    throw new Error(
      `upsertTextElement: displayLabel must be 1..200 chars (got ${input.displayLabel.length})`,
    );
  }
  if (input.origin === "runtime") {
    if (!input.content || input.content.length === 0) {
      throw new Error(
        `upsertTextElement: runtime elements must have non-empty content`,
      );
    }
    if (input.positionXPx == null || input.positionYPx == null) {
      throw new Error(
        `upsertTextElement: runtime elements require positionXPx + positionYPx`,
      );
    }
  }
  if (input.fontFamily != null && !isValidFont(input.fontFamily)) {
    throw new Error(
      `upsertTextElement: font_family ${input.fontFamily} not in brand allowlist`,
    );
  }
  if (input.color != null && !isValidColor(input.color)) {
    throw new Error(`upsertTextElement: invalid color ${input.color}`);
  }
  if (input.alignment != null && !isValidAlignment(input.alignment)) {
    throw new Error(`upsertTextElement: invalid alignment ${input.alignment}`);
  }
  if (input.content != null && input.content.length > 1024) {
    throw new Error(
      `upsertTextElement: content too long (${input.content.length} > 1024 chars)`,
    );
  }
}

export async function listTextElements(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string = "default",
): Promise<TextElement[]> {
  const { data, error } = await sb
    .from("overlay_text_elements")
    .select(SELECT_COLS)
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`listTextElements: ${error.message}`);
  return ((data ?? []) as Row[]).map(toElement);
}

export async function getTextElement(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string,
  elementId: string,
): Promise<TextElement | null> {
  const { data, error } = await sb
    .from("overlay_text_elements")
    .select(SELECT_COLS)
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .eq("element_id", elementId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getTextElement: ${error.message}`);
  return data ? toElement(data as Row) : null;
}

export async function upsertTextElement(
  sb: SupabaseClient,
  actor: Actor,
  input: TextElementInput,
): Promise<TextElement> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("upsertTextElement: no actor.userId");
  validateInput(input);

  const nowIso = new Date().toISOString();

  const { data, error } = await sb
    .from("overlay_text_elements")
    .upsert(
      {
        overlay_key: input.overlayKey,
        variant_id: input.variantId,
        element_id: input.elementId,
        origin: input.origin,
        kind: input.kind,
        display_label: input.displayLabel,
        visible: input.visible,
        content: input.content,
        font_family: input.fontFamily,
        font_weight: input.fontWeight,
        font_size_px: input.fontSizePx,
        letter_spacing: input.letterSpacing,
        line_height: input.lineHeight,
        color: input.color,
        alignment: input.alignment,
        opacity_pct: input.opacityPct,
        position_x_px: input.positionXPx,
        position_y_px: input.positionYPx,
        z_index: input.zIndex,
        sort_order: input.sortOrder,
        set_by: actor.userId,
        updated_at: nowIso,
        deleted_at: null,
      },
      { onConflict: "overlay_key,variant_id,element_id" },
    )
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(`upsertTextElement: ${error.message}`);
  return toElement(data as Row);
}

/**
 * Soft-delete the row. Seed rows MUST use `upsertTextElement(visible=false)`
 * — this fn rejects deletions of seed rows so the catalog stays
 * complete (the resolver needs the seed-id contract intact).
 */
export async function deleteTextElement(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
  elementId: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("deleteTextElement: no actor.userId");

  // Refuse to delete seed rows.
  const existing = await getTextElement(sb, overlayKey, variantId, elementId);
  if (!existing) {
    throw new Error(
      `deleteTextElement: row not found ${overlayKey}/${variantId}/${elementId}`,
    );
  }
  if (existing.origin === "seed") {
    throw new Error(
      `deleteTextElement: seed rows cannot be deleted; use upsertTextElement(visible=false) instead`,
    );
  }

  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("overlay_text_elements")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .eq("element_id", elementId)
    .is("deleted_at", null);
  if (error) throw new Error(`deleteTextElement: ${error.message}`);
}

export async function restoreTextElement(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
  elementId: string,
): Promise<TextElement> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("restoreTextElement: no actor.userId");

  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("overlay_text_elements")
    .update({ deleted_at: null, updated_at: nowIso })
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .eq("element_id", elementId)
    .not("deleted_at", "is", null)
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(`restoreTextElement: ${error.message}`);
  return toElement(data as Row);
}

/**
 * Resolve EFFECTIVE text overrides for SSR injection. Skips no-op rows
 * (seed rows with all-null typography + visible=true + content=='').
 */
export async function resolveTextElements(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string = "default",
): Promise<Record<string, ResolvedTextElement>> {
  const rows = await listTextElements(sb, overlayKey, variantId);
  const out: Record<string, ResolvedTextElement> = {};
  for (const r of rows) {
    const styles: ResolvedTextElement["styles"] = {};
    if (r.fontFamily) styles.fontFamily = r.fontFamily;
    if (r.fontWeight != null) styles.fontWeight = r.fontWeight;
    if (r.fontSizePx != null) styles.fontSize = `${r.fontSizePx}px`;
    if (r.letterSpacing != null) styles.letterSpacing = `${r.letterSpacing}em`;
    if (r.lineHeight != null) styles.lineHeight = r.lineHeight;
    if (r.color) styles.color = r.color;
    if (r.alignment) styles.textAlign = r.alignment;
    if (r.opacityPct != null) styles.opacity = r.opacityPct / 100;
    if (r.positionXPx != null) styles.left = `${r.positionXPx}px`;
    if (r.positionYPx != null) styles.top = `${r.positionYPx}px`;
    if (r.zIndex != null) styles.zIndex = r.zIndex;

    const hasStyles = Object.keys(styles).length > 0;
    const hasContent = r.content && r.content.length > 0;
    const isHidden = r.visible === false;
    const isRuntime = r.origin === "runtime";

    // Seed row that's a complete no-op → skip.
    if (!isHidden && !hasContent && !hasStyles && !isRuntime) continue;

    out[r.elementId] = {
      origin: r.origin,
      visible: r.visible,
      content: hasContent ? r.content : null,
      styles,
    };
  }
  return out;
}
