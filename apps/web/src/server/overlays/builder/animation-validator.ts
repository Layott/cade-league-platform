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
import { AdvancedTimelineSchema, AnimTypeSchema } from "./types";
import type {
  AdvancedTimeline,
  AdvancedTimelineTrack,
  Animation,
  AnimType,
  PresetAnim,
  TimelineProperty,
} from "./types";

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
// here so callers don't need to bolt it onto PresetAnim. Wave 3B adds
// `advancedTimeline` — validated below in `validateAdvancedTimeline`.
const PhasePayloadSchema = z.object({
  type: AnimTypeSchema,
  durationMs: z.number(),
  delayMs: z.number(),
  easing: z.string(),
  keyframesBody: z.string().optional(),
  advancedTimeline: AdvancedTimelineSchema.optional(),
});
type PhasePayload = z.infer<typeof PhasePayloadSchema>;

// ─────────── Wave 3B — advanced timeline validation ───────────
//
// Property → expected value kind. Branch in `validateTrack`.
const NUMERIC_PROPS = new Set<TimelineProperty>([
  "opacity",
  "x",
  "y",
  "scaleX",
  "scaleY",
  "rotation",
]);
const STRING_PROPS = new Set<TimelineProperty>(["color", "filter"]);

// Per-property numeric range. Tight ranges catch silly inputs early.
const NUMERIC_RANGE: Record<string, { min: number; max: number }> = {
  opacity: { min: 0, max: 1 },
  x: { min: -10_000, max: 10_000 },
  y: { min: -10_000, max: 10_000 },
  scaleX: { min: 0, max: 100 },
  scaleY: { min: 0, max: 100 },
  rotation: { min: -3600, max: 3600 },
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function validateTrack(
  track: AdvancedTimelineTrack,
  phaseDurationMs: number,
  errors: string[],
): void {
  const { property, keyframes } = track;
  const isNumeric = NUMERIC_PROPS.has(property);
  const isString = STRING_PROPS.has(property);

  // 1. Monotonic time order + distinct times.
  for (let i = 1; i < keyframes.length; i++) {
    const prev = keyframes[i - 1]!;
    const cur = keyframes[i]!;
    if (cur.timeMs < prev.timeMs) {
      errors.push(
        `track[${property}]: keyframes not monotonic (kf[${i}].timeMs=${cur.timeMs} < kf[${i - 1}].timeMs=${prev.timeMs})`,
      );
    }
    if (cur.timeMs === prev.timeMs) {
      errors.push(
        `track[${property}]: duplicate keyframe times not allowed (both at ${cur.timeMs}ms — keyframes must be distinct in time)`,
      );
    }
  }

  // 2. Time bounds inside phase duration.
  for (const kf of keyframes) {
    if (kf.timeMs < 0 || kf.timeMs > phaseDurationMs) {
      errors.push(
        `track[${property}]: keyframe ${kf.id} timeMs=${kf.timeMs} outside phase range [0, ${phaseDurationMs}]`,
      );
    }
  }

  // 3. Value type matches property kind.
  for (const kf of keyframes) {
    if (isNumeric && typeof kf.value !== "number") {
      errors.push(
        `track[${property}]: keyframe ${kf.id} value must be a number (got ${typeof kf.value})`,
      );
    }
    if (isString && typeof kf.value !== "string") {
      errors.push(
        `track[${property}]: keyframe ${kf.id} value must be a string (got ${typeof kf.value})`,
      );
    }
  }

  // 4. Numeric range checks.
  if (isNumeric) {
    const range = NUMERIC_RANGE[property];
    if (range) {
      for (const kf of keyframes) {
        const v = kf.value;
        if (typeof v === "number" && (v < range.min || v > range.max)) {
          errors.push(
            `track[${property}]: keyframe ${kf.id} value=${v} outside allowed range [${range.min}, ${range.max}]`,
          );
        }
      }
    }
  }

  // 5. String shape: color must be hex; filter rejects url() / @ /
  //    expression() / <>. Compiler emits these into `filter:` CSS, so
  //    we mirror the sanitize_keyframes denylist tokens here.
  if (property === "color") {
    for (const kf of keyframes) {
      if (typeof kf.value === "string" && !HEX_COLOR_RE.test(kf.value)) {
        errors.push(
          `track[color]: keyframe ${kf.id} value=${JSON.stringify(kf.value)} must be hex like #6bcd06`,
        );
      }
    }
  }
  if (property === "filter") {
    for (const kf of keyframes) {
      if (typeof kf.value === "string") {
        if (/url\s*\(|@|expression\s*\(|<|>/.test(kf.value)) {
          errors.push(
            `track[filter]: keyframe ${kf.id} value contains disallowed token (url(), @, expression(), <, >)`,
          );
        }
      }
    }
  }
}

// If advancedTimeline is present and non-empty:
//   - mutual exclusivity: type MUST be 'noop' (or omitted)
//   - per-track validation via validateTrack
function validateAdvancedTimeline(
  phaseName: string,
  phase: {
    type?: AnimType;
    durationMs?: number;
    advancedTimeline?: AdvancedTimeline;
  },
  errors: string[],
): void {
  const tl = phase.advancedTimeline;
  if (!tl || tl.length === 0) return;

  // Zod shape check first.
  const parsed = AdvancedTimelineSchema.safeParse(tl);
  if (!parsed.success) {
    errors.push(
      `${phaseName}.advancedTimeline: schema invalid (${parsed.error.issues.map((i) => i.message).join(", ")})`,
    );
    return;
  }

  // Mutual exclusivity. `noop` is the sentinel for "advanced only";
  // any real preset alongside a non-empty advanced timeline is rejected.
  if (phase.type && phase.type !== "noop") {
    errors.push(
      `${phaseName}: preset type='${phase.type}' AND advancedTimeline both set — mutually exclusive (use type='noop' when advanced timeline drives the phase)`,
    );
  }

  const durationMs = phase.durationMs ?? 0;
  for (const track of parsed.data) {
    validateTrack(track, durationMs, errors);
  }
}

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

  // Wave 3B — advanced timeline branch. Only fires when
  // phase.advancedTimeline is present and non-empty. Mutual exclusivity
  // with the preset `type` is enforced inside.
  validateAdvancedTimeline(phaseName, p, errors);
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
