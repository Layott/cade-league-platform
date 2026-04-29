import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import { isValidElementId, isValidEasing } from "../_shared/css-validator";
import { OVERLAY_KEYS } from "../design/defaults";
import { sanitizeKeyframes } from "./sanitize_keyframes";

/**
 * Overlay Design Page v2 — element-animation CRUD + resolver.
 *
 * One row per (overlay_key, variant_id, element_id, anim_phase).
 * Multiple phases per element are supported (entry + continuous +
 * exit). Bootstrap script generates `@keyframes` + chained
 * `animation:` rules.
 *
 * `custom_css_keyframes` is sanitized server-side via
 * `./sanitize_keyframes::sanitizeKeyframes` — reject on first
 * forbidden construct (url(), @-rules, non-allowlisted properties,
 * tag injection).
 *
 * Mutations gate on `overlay.design.manage`.
 *
 * Spec: docs/superpowers/specs/2026-04-29-overlay-design-page-v2.md §2.5, §3.4
 */

export type AnimPhase = "entry" | "exit" | "continuous";

export type AnimType =
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "fade"
  | "scale"
  | "rotate"
  | "bounce"
  | "pulse"
  | "glow"
  | "shake"
  | "flip"
  | "custom-css"
  | "none";

export type ElementAnimation = {
  id: string;
  overlayKey: string;
  variantId: string;
  elementId: string;
  animPhase: AnimPhase;
  enabled: boolean;
  animType: AnimType;
  durationMs: number;
  delayMs: number;
  easing: string;
  iterationCount: string;
  customCssKeyframes: string | null;
  setBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ElementAnimationInput = Omit<
  ElementAnimation,
  "id" | "setBy" | "createdAt" | "updatedAt"
>;

export type ResolvedAnimation = {
  animType: AnimType;
  durationMs: number;
  delayMs: number;
  easing: string;
  iterationCount: string;
  /** Pre-built `@keyframes` body. Bootstrap embeds these in <style>. */
  keyframesCss: string;
  /** The `animation:` rule attached to the element selector. */
  animationRule: string;
};

type Row = {
  id: string;
  overlay_key: string;
  variant_id: string;
  element_id: string;
  anim_phase: AnimPhase;
  enabled: boolean;
  anim_type: AnimType;
  duration_ms: number;
  delay_ms: number;
  easing: string;
  iteration_count: string;
  custom_css_keyframes: string | null;
  set_by: string;
  created_at: string;
  updated_at: string;
};

const SELECT_COLS =
  "id, overlay_key, variant_id, element_id, anim_phase, enabled, anim_type, duration_ms, delay_ms, easing, iteration_count, custom_css_keyframes, set_by, created_at, updated_at";

const ANIM_PHASES: AnimPhase[] = ["entry", "exit", "continuous"];
const ANIM_TYPES: AnimType[] = [
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
];

function toAnimation(r: Row): ElementAnimation {
  return {
    id: r.id,
    overlayKey: r.overlay_key,
    variantId: r.variant_id,
    elementId: r.element_id,
    animPhase: r.anim_phase,
    enabled: r.enabled,
    animType: r.anim_type,
    durationMs: r.duration_ms,
    delayMs: r.delay_ms,
    easing: r.easing,
    iterationCount: r.iteration_count,
    customCssKeyframes: r.custom_css_keyframes,
    setBy: r.set_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function validateInput(input: ElementAnimationInput): {
  sanitizedKeyframes: string | null;
} {
  if (!(OVERLAY_KEYS as readonly string[]).includes(input.overlayKey)) {
    throw new Error(`upsertAnimation: unknown overlay key ${input.overlayKey}`);
  }
  if (!isValidElementId(input.elementId)) {
    throw new Error(`upsertAnimation: invalid element_id ${input.elementId}`);
  }
  if (!ANIM_PHASES.includes(input.animPhase)) {
    throw new Error(`upsertAnimation: invalid anim_phase ${input.animPhase}`);
  }
  if (!ANIM_TYPES.includes(input.animType)) {
    throw new Error(`upsertAnimation: invalid anim_type ${input.animType}`);
  }
  if (input.durationMs < 50 || input.durationMs > 5000) {
    throw new Error(`upsertAnimation: duration_ms out of range (50..5000)`);
  }
  if (input.delayMs < 0 || input.delayMs > 5000) {
    throw new Error(`upsertAnimation: delay_ms out of range (0..5000)`);
  }
  if (!isValidEasing(input.easing)) {
    throw new Error(`upsertAnimation: invalid easing ${input.easing}`);
  }
  if (
    input.iterationCount !== "infinite" &&
    !/^\d{1,3}$/.test(input.iterationCount)
  ) {
    throw new Error(
      `upsertAnimation: iteration_count must be 'infinite' or a 1-3 digit integer`,
    );
  }
  if (input.iterationCount !== "infinite") {
    const n = parseInt(input.iterationCount, 10);
    if (n < 1 || n > 100) {
      throw new Error(
        `upsertAnimation: iteration_count integer must be 1..100`,
      );
    }
  }
  let sanitizedKeyframes: string | null = null;
  if (input.animType === "custom-css") {
    if (!input.customCssKeyframes) {
      throw new Error(
        `upsertAnimation: custom-css anim type requires customCssKeyframes`,
      );
    }
    const r = sanitizeKeyframes(input.customCssKeyframes);
    if (!r.ok) {
      throw new Error(`upsertAnimation: keyframes sanitize failed: ${r.error}`);
    }
    sanitizedKeyframes = r.normalized;
  } else if (input.customCssKeyframes != null) {
    // Non-custom anim types must not carry a custom keyframes payload.
    throw new Error(
      `upsertAnimation: customCssKeyframes only allowed when animType='custom-css'`,
    );
  }
  return { sanitizedKeyframes };
}

export async function listAnimations(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string = "default",
): Promise<ElementAnimation[]> {
  const { data, error } = await sb
    .from("overlay_element_animations")
    .select(SELECT_COLS)
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .is("deleted_at", null);
  if (error) throw new Error(`listAnimations: ${error.message}`);
  return ((data ?? []) as Row[]).map(toAnimation);
}

export async function getAnimation(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string,
  elementId: string,
  phase: AnimPhase,
): Promise<ElementAnimation | null> {
  const { data, error } = await sb
    .from("overlay_element_animations")
    .select(SELECT_COLS)
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .eq("element_id", elementId)
    .eq("anim_phase", phase)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getAnimation: ${error.message}`);
  return data ? toAnimation(data as Row) : null;
}

export async function upsertAnimation(
  sb: SupabaseClient,
  actor: Actor,
  input: ElementAnimationInput,
): Promise<ElementAnimation> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("upsertAnimation: no actor.userId");
  const { sanitizedKeyframes } = validateInput(input);

  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("overlay_element_animations")
    .upsert(
      {
        overlay_key: input.overlayKey,
        variant_id: input.variantId,
        element_id: input.elementId,
        anim_phase: input.animPhase,
        enabled: input.enabled,
        anim_type: input.animType,
        duration_ms: input.durationMs,
        delay_ms: input.delayMs,
        easing: input.easing,
        iteration_count: input.iterationCount,
        custom_css_keyframes: sanitizedKeyframes,
        set_by: actor.userId,
        updated_at: nowIso,
        deleted_at: null,
      },
      { onConflict: "overlay_key,variant_id,element_id,anim_phase" },
    )
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(`upsertAnimation: ${error.message}`);
  return toAnimation(data as Row);
}

export async function deleteAnimation(
  sb: SupabaseClient,
  actor: Actor,
  overlayKey: string,
  variantId: string,
  elementId: string,
  phase: AnimPhase,
): Promise<void> {
  await requirePermAsync(sb, actor, "overlay.design.manage");
  if (!actor.userId) throw new Error("deleteAnimation: no actor.userId");

  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("overlay_element_animations")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("overlay_key", overlayKey)
    .eq("variant_id", variantId)
    .eq("element_id", elementId)
    .eq("anim_phase", phase)
    .is("deleted_at", null);
  if (error) throw new Error(`deleteAnimation: ${error.message}`);
}

/**
 * Build the `@keyframes` BODY for a given resolved animation. Pure —
 * no DB. Mirrors the bootstrap-side `buildKeyframes` implementation.
 *
 * The bootstrap also re-derives this client-side from the same
 * `animType` + `customCssKeyframes`; this server-side variant is
 * exposed so the SSR overlay route + smoke tests can compute it
 * synchronously without round-tripping through the iframe.
 */
export function buildKeyframesBody(a: ElementAnimation): string {
  switch (a.animType) {
    case "slide-left":
      return "from{opacity:0;transform:translateX(-32px)}to{opacity:1;transform:translateX(0)}";
    case "slide-right":
      return "from{opacity:0;transform:translateX(32px)}to{opacity:1;transform:translateX(0)}";
    case "slide-up":
      return "from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:translateY(0)}";
    case "slide-down":
      return "from{opacity:0;transform:translateY(-32px)}to{opacity:1;transform:translateY(0)}";
    case "fade":
      return "from{opacity:0}to{opacity:1}";
    case "scale":
      return "from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}";
    case "rotate":
      return "from{opacity:0;transform:rotate(-12deg)}to{opacity:1;transform:rotate(0)}";
    case "bounce":
      return "0%{opacity:0;transform:translateY(20px)}60%{transform:translateY(-6px)}100%{opacity:1;transform:translateY(0)}";
    case "pulse":
      return "0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)}";
    case "glow":
      return "0%{filter:drop-shadow(0 0 0 rgba(107,205,6,0))}50%{filter:drop-shadow(0 0 24px rgba(107,205,6,0.55))}100%{filter:drop-shadow(0 0 0 rgba(107,205,6,0))}";
    case "shake":
      return "0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}";
    case "flip":
      return "from{opacity:0;transform:perspective(800px) rotateY(-90deg)}to{opacity:1;transform:perspective(800px) rotateY(0)}";
    case "custom-css":
      return a.customCssKeyframes ?? "";
    case "none":
    default:
      return "";
  }
}

/**
 * Resolve EFFECTIVE animations for SSR injection.
 *
 * Skips `enabled=false` rows + `animType='none'` rows so the bootstrap
 * never emits empty rules. Rows with all phases disabled drop out
 * entirely.
 *
 * Map shape: `element_id → { entry?, continuous?, exit? }`.
 */
export async function resolveAnimations(
  sb: SupabaseClient,
  overlayKey: string,
  variantId: string = "default",
): Promise<Record<string, Partial<Record<AnimPhase, ResolvedAnimation>>>> {
  const rows = await listAnimations(sb, overlayKey, variantId);
  const out: Record<string, Partial<Record<AnimPhase, ResolvedAnimation>>> = {};
  for (const r of rows) {
    if (!r.enabled || r.animType === "none") continue;
    const animName = `cade-${r.elementId}-${r.animPhase}`;
    const body = buildKeyframesBody(r);
    if (!body) continue;
    const keyframesCss = `@keyframes ${animName}{${body}}`;
    const animationRule =
      `${animName} ${r.durationMs}ms ${r.easing} ${r.delayMs}ms ${r.iterationCount} both`;

    if (!out[r.elementId]) out[r.elementId] = {};
    out[r.elementId][r.animPhase] = {
      animType: r.animType,
      durationMs: r.durationMs,
      delayMs: r.delayMs,
      easing: r.easing,
      iterationCount: r.iterationCount,
      keyframesCss,
      animationRule,
    };
  }
  return out;
}
