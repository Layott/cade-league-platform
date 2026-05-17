/**
 * Overlay Builder — animation JSON validator.
 *
 * Per phase (entry / exit / loop):
 *   - type ∈ AnimType union (Zod parse)
 *   - durationMs ∈ [0, 30000]
 *   - delayMs ∈ [0, 30000]
 *   - easing ∈ named curve OR `cubic-bezier(n,n,n,n)` literal
 *   - if type === "custom-css", the phase payload MUST include
 *     `keyframesBody: string`. The body is run through the existing
 *     `animations/sanitize_keyframes.ts` allowlist — anything outside
 *     ALLOWED_KEYFRAMES_PROPS, any `url(...)`, any nested @-rule, etc.
 *     is rejected.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §8 + §12
 */

import { z } from "zod";
import { sanitizeKeyframes } from "../animations/sanitize_keyframes";
import { AnimTypeSchema } from "./types";
import type { Animation, AnimType, PresetAnim } from "./types";

const NAMED_EASING = new Set([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
]);
const CUBIC_BEZIER_RE =
  /^cubic-bezier\(\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*\)$/;

const DURATION_MIN = 0;
const DURATION_MAX = 30000;

// The phase payload may carry a `keyframesBody` alongside the preset
// fields when `type === "custom-css"`. We accept the extended shape
// here so callers don't need to bolt it onto PresetAnim.
const PhasePayloadSchema = z.object({
  type: AnimTypeSchema,
  durationMs: z.number(),
  delayMs: z.number(),
  easing: z.string(),
  keyframesBody: z.string().optional(),
});
type PhasePayload = z.infer<typeof PhasePayloadSchema>;

const AnimationPayloadSchema = z.object({
  entry: PhasePayloadSchema.optional(),
  exit: PhasePayloadSchema.optional(),
  loop: PhasePayloadSchema.optional(),
});

export type AnimationValidationResult =
  | { ok: true; value: Animation }
  | { ok: false; errors: string[] };

function validatePhase(
  phaseName: "entry" | "exit" | "loop",
  p: PhasePayload,
  errors: string[],
): void {
  if (p.durationMs < DURATION_MIN || p.durationMs > DURATION_MAX) {
    errors.push(
      `${phaseName}.durationMs: ${p.durationMs} out of range [${DURATION_MIN}, ${DURATION_MAX}]`,
    );
  }
  if (p.delayMs < DURATION_MIN || p.delayMs > DURATION_MAX) {
    errors.push(
      `${phaseName}.delayMs: ${p.delayMs} out of range [${DURATION_MIN}, ${DURATION_MAX}]`,
    );
  }
  if (!NAMED_EASING.has(p.easing) && !CUBIC_BEZIER_RE.test(p.easing)) {
    errors.push(
      `${phaseName}.easing: "${p.easing}" must be linear|ease|ease-in|ease-out|ease-in-out or cubic-bezier(n,n,n,n)`,
    );
  }
  if (p.type === "custom-css") {
    if (typeof p.keyframesBody !== "string") {
      errors.push(
        `${phaseName}.keyframesBody: required when type === "custom-css"`,
      );
      return;
    }
    const sanitized = sanitizeKeyframes(p.keyframesBody);
    if (!sanitized.ok) {
      errors.push(`${phaseName}.keyframesBody: ${sanitized.error}`);
    }
  }
}

export function validateAnimation(
  animation: unknown,
): AnimationValidationResult {
  const errors: string[] = [];

  const parsed = AnimationPayloadSchema.safeParse(animation);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "animation";
      errors.push(`${path}: ${issue.message}`);
    }
    return { ok: false, errors };
  }
  const a = parsed.data;

  if (a.entry) validatePhase("entry", a.entry, errors);
  if (a.exit) validatePhase("exit", a.exit, errors);
  if (a.loop) validatePhase("loop", a.loop, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Strip keyframesBody from the returned Animation — that field lives
  // on the phase payload but is not part of the canonical
  // Animation/PresetAnim shape (it is consumed at compile time, not
  // stored on the typed shape). The compiler reads it back from the
  // raw JSON column. Callers that need to round-trip the body should
  // keep the raw input alongside the validated value.
  const stripBody = (p: PhasePayload | undefined): PresetAnim | undefined =>
    p
      ? {
          type: p.type as AnimType,
          durationMs: p.durationMs,
          delayMs: p.delayMs,
          easing: p.easing,
        }
      : undefined;

  const value: Animation = {};
  if (a.entry) value.entry = stripBody(a.entry);
  if (a.exit) value.exit = stripBody(a.exit);
  if (a.loop) value.loop = stripBody(a.loop);
  return { ok: true, value };
}
