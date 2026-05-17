# Overlay Builder Wave 3B — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an After Effects–style advanced keyframe timeline editor inside the overlay builder canvas editor. Operators select an element, click **Timeline** in the bottom panel of `CanvasEditorShell`, then add per-property keyframes (opacity, x, y, scaleX, scaleY, rotation, color, filter) at any millisecond time within the animation phase. Cubic-bezier easing handles between adjacent keyframes shape per-segment interpolation. Preset and advanced modes are mutually exclusive per `(element, phase)` — switching to advanced clears the preset payload for that phase and vice versa. The compiler converts `advancedTimeline` arrays to `@keyframes` CSS blocks (one per element + phase) and the runtime route serves them through the same `compileDesignToHtml` path Wave 1A established.

**Architecture:** Extension to the canvas-editor zustand store + a new `TimelinePanel` collapsible bottom dock + a new compile branch in `apps/web/src/server/overlays/builder/compiler.ts` that walks `animation.advancedTimeline` and emits `@keyframes <kf-name> { 0% {...} 25% {...} ... }` blocks (per-property values merged into combined-percent rules). Reuses Wave 1A's bootstrap injector — animation rules attach via `[data-element-id]` selectors; the bootstrap `cade-visible-gate-observer-v2` MutationObserver fires the animation when `body.cade-visible` lands. Behind the existing `overlayBuilder.enabled` feature flag.

**Tech Stack:** Next.js 15 (App Router) · Supabase Postgres · TypeScript · Vitest · Playwright · zustand · @dnd-kit/core · react-konva (for scrub-preview only — not for the timeline itself; timeline is plain SVG + DOM divs) · Zod · lucide-react

**Related:** Spec `docs/superpowers/specs/2026-05-17-overlay-builder-design.md` §8 + §11 · Wave 1A plan `2026-05-17-overlay-builder-wave-1a.md` (compiler, zustand store, animation validator, CanvasEditorShell — all extended here) · CLAUDE.md §14 (overlay HTML contract) · CLAUDE.md §15.B (animation phases, allowed keyframe properties, sanitizer)

**Wave 3B delivers (end of wave):**

1. Type extensions in `apps/web/src/server/overlays/builder/types.ts`: `KeyframeSchema`, `BezierEasingSchema`, `AdvancedTimelineTrackSchema`, `AdvancedTimelineSchema`. Added as optional fields on `AnimationSchema` per phase (`entry.advancedTimeline?`, `exit.advancedTimeline?`, `loop.advancedTimeline?`).
2. Animation validator updates: keyframe-time monotonic + within phase duration, bezier control points clamped to `[0, 1]` on x-axis and `[-1, 2]` on y-axis (matches CSS `cubic-bezier()` allowed ranges), property-value type matches property kind.
3. Compiler updates: when `phase.advancedTimeline` is present, emit `@keyframes builder-<elementId>-<phase> { ... }` instead of the preset preset-keyframe lookup; per-property keyframes merged into single percentage rules; bezier easing emitted as `animation-timing-function: cubic-bezier(...)` per-keyframe via `step()` decomposition is NOT needed — we render via percentage rules and CSS handles tweening.
4. New `TimelinePanel` collapsible bottom dock in `apps/web/src/components/admin/overlay-builder/TimelinePanel.tsx` toggled by a new **Timeline** button in `CanvasEditorShell` topbar.
5. `TimelineRuler` (top of panel) — pixels-per-second scale + time markers + draggable current-time cursor.
6. Per-element track list with multi-property sub-tracks (opacity / x / y / scaleX / scaleY / rotation / color / filter) — each row has its own draggable `KeyframeNode` diamonds.
7. `BezierHandle` between two adjacent keyframes — drag the two control points to shape easing.
8. `EasingPresetDropdown` per-keyframe — picks `linear` / `ease` / `ease-in` / `ease-out` / `ease-in-out` / `custom`.
9. Per-keyframe property inspector (right side of timeline panel) — shows value at selected keyframe, editable by property type (number stepper, color picker, filter string).
10. Add-keyframe / delete-keyframe actions + multi-select.
11. Scrub-preview: drag the time cursor → CanvasStage re-renders elements at interpolated values.
12. Zustand actions: `setElementAnimationMode(elementId, phase, 'preset'|'advanced')`, `addKeyframe(elementId, phase, property, timeMs, value)`, `updateKeyframe(elementId, phase, property, kfId, patch)`, `removeKeyframe(elementId, phase, property, kfId)`, `setBezierEasing(elementId, phase, property, fromKfId, bezier)`.
13. Mutual exclusivity guard inside `setElementAnimationMode` — switching to `advanced` clears `entry`/`exit`/`loop` preset on that phase; switching back to `preset` clears `advancedTimeline` on that phase.
14. New E2E spec `overlay-builder-wave-3b.spec.ts` covering the full flow (create design → add element → switch to advanced → place 3 keyframes → set bezier → save → publish → fetch HTML → assert `@keyframes` ladder).
15. New visual-regression baseline `overlay-builder-wave-3b-advanced-anim.spec.ts` capturing a mid-animation frame at 50% timeline progress.
16. Feature flag stays existing `overlayBuilder.enabled` — no new flag.

**Out of scope for Wave 3B** (deferred / explicitly NOT built):

- After-Effects-style **expression scripting** (`wiggle()`, `valueAtTime()`) — strict allowlist-only keyframe values.
- **Looping advanced timelines** — `loop` phase technically supports advanced, but iteration-count UI is preset-only (defaults to `infinite`). Wave 3C if requested.
- **Onion-skin preview** showing prior + next keyframe ghosts on CanvasStage. Future polish.
- **Velocity / wiggle curves** — only single cubic-bezier per segment.
- **Per-track audio scrubbing / waveform display** — overlays are silent.
- **Property linking** ("link x and y") — each property is its own sub-track. Future.
- **Spatial-keyframe trajectory editing** (curve-through-canvas). Future.
- **Coach / team-manager / player authoring** — locked to admin / design / production per spec §2.

---

### Task 1: Extend types.ts — keyframe / bezier / advanced-timeline schemas

The Wave 1A `types.ts` already exports `AnimationSchema = z.object({ entry, exit, loop })` with each phase typed as `PresetAnimSchema`. Wave 3B extends each phase with an optional `advancedTimeline: AdvancedTimelineSchema` field. Existing rows without the field decode untouched (Zod `.optional()` returns `undefined`). Preset and advanced live side-by-side at the type level — the mutual-exclusivity guard runs in validators + zustand, not the schema.

**Files:**
- Modify: `apps/web/src/server/overlays/builder/types.ts`
- Modify: `apps/web/src/server/overlays/builder/types.test.ts`

#### Steps

- [ ] 1. Extend `apps/web/src/server/overlays/builder/types.test.ts` with new cases:

```ts
import {
  AdvancedTimelineSchema,
  AdvancedTimelineTrackSchema,
  AnimationSchema,
  BezierEasingSchema,
  KeyframeSchema,
  TimelinePropertySchema,
  type AdvancedTimeline,
  type AdvancedTimelineTrack,
  type Animation,
  type BezierEasing,
  type Keyframe,
  type TimelineProperty,
} from "./types";

describe("types.ts — Wave 3B advanced timeline schemas", () => {
  it("TimelinePropertySchema enumerates every animatable property", () => {
    const props: TimelineProperty[] = [
      "opacity",
      "x",
      "y",
      "scaleX",
      "scaleY",
      "rotation",
      "color",
      "filter",
    ];
    for (const p of props) {
      expect(TimelinePropertySchema.parse(p)).toBe(p);
    }
    expect(() => TimelinePropertySchema.parse("translateZ")).toThrow();
  });

  it("BezierEasingSchema accepts four-control-point cubic bezier", () => {
    const b: BezierEasing = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
    expect(BezierEasingSchema.parse(b)).toEqual(b);
  });

  it("BezierEasingSchema rejects x outside [0, 1]", () => {
    expect(() =>
      BezierEasingSchema.parse({ x1: -0.1, y1: 0, x2: 0.5, y2: 1 }),
    ).toThrow();
    expect(() =>
      BezierEasingSchema.parse({ x1: 1.1, y1: 0, x2: 0.5, y2: 1 }),
    ).toThrow();
  });

  it("BezierEasingSchema accepts y in [-1, 2] (CSS cubic-bezier allowance)", () => {
    expect(
      BezierEasingSchema.parse({ x1: 0.4, y1: -0.5, x2: 0.6, y2: 1.8 }),
    ).toBeTruthy();
  });

  it("KeyframeSchema parses a numeric keyframe with bezier-out", () => {
    const k: Keyframe = {
      id: "kf-1",
      timeMs: 250,
      value: 0.6,
      easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
    };
    expect(KeyframeSchema.parse(k)).toEqual(k);
  });

  it("KeyframeSchema accepts string values for color/filter properties", () => {
    const k: Keyframe = {
      id: "kf-2",
      timeMs: 500,
      value: "#fe036d",
      easingOut: null,
    };
    expect(KeyframeSchema.parse(k)).toEqual(k);
  });

  it("KeyframeSchema rejects negative timeMs", () => {
    expect(() =>
      KeyframeSchema.parse({ id: "kf-3", timeMs: -10, value: 1, easingOut: null }),
    ).toThrow();
  });

  it("AdvancedTimelineTrackSchema enforces a property + keyframes array", () => {
    const t: AdvancedTimelineTrack = {
      property: "opacity",
      keyframes: [
        { id: "kf-a", timeMs: 0, value: 0, easingOut: null },
        { id: "kf-b", timeMs: 600, value: 1, easingOut: null },
      ],
    };
    expect(AdvancedTimelineTrackSchema.parse(t)).toEqual(t);
  });

  it("AnimationSchema accepts entry.advancedTimeline alongside no preset", () => {
    const a: Animation = {
      entry: {
        type: "fade",
        durationMs: 600,
        delayMs: 0,
        easing: "ease-out",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 600, value: 1, easingOut: null },
            ],
          },
        ],
      },
    };
    expect(AnimationSchema.parse(a)).toBeTruthy();
  });
});
```

- [ ] 2. Run the test (expect failure — symbols not yet exported):

```bash
npx vitest run apps/web/src/server/overlays/builder/types.test.ts
```

Expected: `Module './types' has no exported member 'KeyframeSchema'`.

- [ ] 3. Append to `apps/web/src/server/overlays/builder/types.ts` (after existing `PresetAnimSchema`):

```ts
// ────────────── Wave 3B: Advanced keyframe timeline ──────────────
//
// Animatable property catalog. Each property's value is one of:
//   - number  (opacity, x, y, scaleX, scaleY, rotation)
//   - string  (color hex, filter CSS string)
// Validator branches on this list to type-check the keyframe `value`.
export const TimelinePropertySchema = z.enum([
  "opacity",
  "x",
  "y",
  "scaleX",
  "scaleY",
  "rotation",
  "color",
  "filter",
]);
export type TimelineProperty = z.infer<typeof TimelinePropertySchema>;

// Cubic-bezier control points. x ∈ [0, 1] (time axis is monotonic),
// y ∈ [-1, 2] (CSS allows overshoot for spring-like curves).
export const BezierEasingSchema = z.object({
  x1: z.number().min(0).max(1),
  y1: z.number().min(-1).max(2),
  x2: z.number().min(0).max(1),
  y2: z.number().min(-1).max(2),
});
export type BezierEasing = z.infer<typeof BezierEasingSchema>;

// Single keyframe. `easingOut` is the bezier curve from THIS keyframe to
// the next; null means linear (default). The final keyframe in a track
// always has `easingOut: null` (no segment after it).
export const KeyframeSchema = z.object({
  id: z.string().min(1),
  timeMs: z.number().min(0).max(60_000),
  value: z.union([z.number(), z.string()]),
  easingOut: BezierEasingSchema.nullable(),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

// One track per property. Keyframes within a track MUST be sorted by
// `timeMs` ascending — enforced in `animation-validator.ts`, not here
// (Zod can't express ordering cheaply).
export const AdvancedTimelineTrackSchema = z.object({
  property: TimelinePropertySchema,
  keyframes: z.array(KeyframeSchema).min(2),
});
export type AdvancedTimelineTrack = z.infer<typeof AdvancedTimelineTrackSchema>;

// A complete advanced timeline = array of tracks (one per animated
// property). Empty array is legal (treated identically to "no advanced
// timeline set") but the UI never persists empty arrays.
export const AdvancedTimelineSchema = z.array(AdvancedTimelineTrackSchema);
export type AdvancedTimeline = z.infer<typeof AdvancedTimelineSchema>;
```

- [ ] 4. Modify the existing `PresetAnimSchema` in the same file to allow `advancedTimeline` per phase (additive):

```ts
// REPLACE the existing PresetAnimSchema definition with:
export const PresetAnimSchema = z.object({
  type: AnimTypeSchema,
  durationMs: z.number().min(0).max(60_000),
  delayMs: z.number().min(0).max(60_000),
  easing: z.string(),
  // Wave 3B: optional advanced keyframe timeline. Mutual exclusivity
  // with `type` is enforced in animation-validator.ts (when this array
  // is non-empty, `type` is ignored at compile time).
  advancedTimeline: AdvancedTimelineSchema.optional(),
  // Wave 1A compat: custom-css keyframes body still supported.
  keyframesBody: z.string().optional(),
});
export type PresetAnim = z.infer<typeof PresetAnimSchema>;
```

- [ ] 5. Re-run the test:

```bash
npx vitest run apps/web/src/server/overlays/builder/types.test.ts
```

Expected: all cases pass, including the Wave 1A cases (additive — no breakage).

- [ ] 6. Stage and commit:

```bash
git add apps/web/src/server/overlays/builder/types.ts apps/web/src/server/overlays/builder/types.test.ts
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): extend types with advanced keyframe schemas

Adds Wave 3B foundations to the shared types module:
  - TimelinePropertySchema      -> 8 animatable property union
  - BezierEasingSchema          -> 4-control-point cubic bezier, x in [0,1] y in [-1,2]
  - KeyframeSchema              -> id + timeMs + value (num|str) + easingOut?
  - AdvancedTimelineTrackSchema -> property + keyframes[>=2]
  - AdvancedTimelineSchema      -> array of tracks

Extends existing PresetAnimSchema with optional advancedTimeline so
each phase (entry / exit / loop) can carry either preset OR advanced.
Mutual exclusivity is enforced in animation-validator.ts (next task),
not at the schema level — keeps schema parse cheap and lets the editor
hold both side-by-side mid-edit before persisting.

All existing Wave 1A type tests still pass — extensions are additive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Animation validator — keyframe-time monotonicity + value-type checks + mutual exclusivity

The Wave 1A `animation-validator.ts` validates preset-only animations. Wave 3B extends it to also validate advanced timelines: keyframe times are monotonically increasing, fall inside `[0, phase.durationMs]`, property-value types match property kind, and per-phase mutual exclusivity holds (a phase has EITHER a real preset `type !== 'noop'` OR a non-empty `advancedTimeline`, never both — but a no-op preset with advanced is fine because the compiler reads advanced first).

**Files:**
- Modify: `apps/web/src/server/overlays/builder/animation-validator.ts`
- Modify: `apps/web/src/server/overlays/builder/animation-validator.test.ts`

#### Steps

- [ ] 1. Extend `apps/web/src/server/overlays/builder/animation-validator.test.ts` with Wave 3B cases:

```ts
describe("validateAnimation — Wave 3B advanced timeline", () => {
  it("accepts advanced opacity track with 2 keyframes inside duration", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 600, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts multi-property advanced timeline (opacity + x + scaleX)", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 1000,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "o1", timeMs: 0, value: 0, easingOut: null },
              { id: "o2", timeMs: 1000, value: 1, easingOut: null },
            ],
          },
          {
            property: "x",
            keyframes: [
              { id: "x1", timeMs: 0, value: -120, easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 } },
              { id: "x2", timeMs: 1000, value: 0, easingOut: null },
            ],
          },
          {
            property: "scaleX",
            keyframes: [
              { id: "s1", timeMs: 0, value: 0.8, easingOut: null },
              { id: "s2", timeMs: 500, value: 1.1, easingOut: null },
              { id: "s3", timeMs: 1000, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects non-monotonic keyframe times", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 600, value: 1, easingOut: null },
              { id: "k3", timeMs: 300, value: 0.5, easingOut: null }, // out of order
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/monotonic|order/i);
  });

  it("rejects keyframe time greater than phase durationMs", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 9000, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/durationMs|range/i);
  });

  it("rejects numeric value on color property", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "color",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0.5, easingOut: null }, // wrong type
              { id: "k2", timeMs: 600, value: "#fe036d", easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/color.*string|value.*type/i);
  });

  it("rejects string value on opacity property", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: "zero", easingOut: null },
              { id: "k2", timeMs: 600, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects opacity values outside [0, 1]", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: -0.2, easingOut: null },
              { id: "k2", timeMs: 600, value: 1.5, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects mutual-exclusivity violation (preset type AND advanced timeline)", () => {
    const r = validateAnimation({
      entry: {
        type: "slide-left",
        durationMs: 600,
        delayMs: 0,
        easing: "ease-out",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 600, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/mutual|exclusive|both/i);
  });

  it("rejects duplicate keyframe times within a track", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 300, value: 0, easingOut: null },
              { id: "k2", timeMs: 300, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/duplicate|distinct/i);
  });
});
```

- [ ] 2. Run the test (expect failures — validator branch not implemented):

```bash
npx vitest run apps/web/src/server/overlays/builder/animation-validator.test.ts
```

Expected: Wave 3B tests fail, Wave 1A tests still pass.

- [ ] 3. Modify `apps/web/src/server/overlays/builder/animation-validator.ts`. Add the advanced-timeline branch ABOVE the existing `validatePhase` return:

```ts
import {
  AdvancedTimelineSchema,
  type AdvancedTimeline,
  type AdvancedTimelineTrack,
  type TimelineProperty,
} from "./types";

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
        const v = kf.value as number;
        if (typeof v === "number" && (v < range.min || v > range.max)) {
          errors.push(
            `track[${property}]: keyframe ${kf.id} value=${v} outside allowed range [${range.min}, ${range.max}]`,
          );
        }
      }
    }
  }

  // 5. String shape: color must be hex; filter goes through the existing
  //    sanitize_keyframes allowlist via a slim check (no url(), no @,
  //    no expression() — the compiler emits values into `filter:` CSS).
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

// Insert into existing validatePhase function, AFTER preset checks and
// BEFORE returning. If advancedTimeline is present and non-empty:
//   - mutual exclusivity: type MUST be 'noop' (or omitted)
//   - per-track validation via validateTrack
function validateAdvancedTimeline(
  phaseName: string,
  phase: { type?: string; durationMs?: number; advancedTimeline?: AdvancedTimeline },
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
```

- [ ] 4. Wire `validateAdvancedTimeline` into the existing `validatePhase` (called by `validateAnimation`). Find the line just before `return { ok: errors.length === 0, errors }` inside `validatePhase` and insert:

```ts
  validateAdvancedTimeline(phaseName, phase, errors);
```

- [ ] 5. Also add `'noop'` to the allowed types in `AnimTypeSchema` (modify `types.ts`):

```ts
// In types.ts — append 'noop' to AnimTypeSchema enum
export const AnimTypeSchema = z.enum([
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
  "noop",  // Wave 3B sentinel — phase driven by advancedTimeline only
]);
```

- [ ] 6. Re-run tests:

```bash
npx vitest run apps/web/src/server/overlays/builder/animation-validator.test.ts apps/web/src/server/overlays/builder/types.test.ts
```

Expected: all Wave 1A + Wave 3B cases pass.

- [ ] 7. Stage and commit:

```bash
git add apps/web/src/server/overlays/builder/animation-validator.ts apps/web/src/server/overlays/builder/animation-validator.test.ts apps/web/src/server/overlays/builder/types.ts
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): validate advanced keyframe timelines

Extends animation-validator with the Wave 3B branch:
  - keyframe time monotonicity (strict <, no dupes)
  - in-range check against phase.durationMs
  - value type matches property kind (numeric vs string)
  - per-property numeric ranges (opacity [0,1], scale [0,100], etc.)
  - color values must be hex; filter values reject url() / @ / <>
  - mutual exclusivity: type='noop' required when advancedTimeline set

Adds 'noop' sentinel to AnimTypeSchema for the advanced-only case.
All Wave 1A preset cases still pass — the branch only fires when
phase.advancedTimeline is non-empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Compiler — emit `@keyframes` from `advancedTimeline`

Wave 1A's `compileDesignToHtml` already emits per-phase `animation:` rules from preset payloads via a `buildPresetKeyframes` switch. Wave 3B adds a parallel `buildAdvancedKeyframes` function that walks `phase.advancedTimeline`, normalizes each keyframe's `timeMs` to a percentage of `phase.durationMs`, merges all per-property values at the same percentage into a single rule body, and emits the resulting `@keyframes builder-<elementId>-<phase>` block. When `advancedTimeline` is present, the preset-keyframes branch is skipped for that phase. The `animation-timing-function` per-segment bezier is emitted INSIDE each non-final keyframe's percent rule (CSS handles per-keyframe timing functions when declared this way).

**Files:**
- Modify: `apps/web/src/server/overlays/builder/compiler.ts`
- Modify: `apps/web/src/server/overlays/builder/compiler.test.ts`
- Create: `apps/web/src/server/overlays/builder/fixtures/design-with-advanced-timeline.ts`

#### Steps

- [ ] 1. Create the fixture `apps/web/src/server/overlays/builder/fixtures/design-with-advanced-timeline.ts`:

```ts
import type { Design } from "../types";

/**
 * Single text element with a 3-keyframe advanced opacity track + a
 * 2-keyframe x track. Exercises the Wave 3B compiler branch:
 *   - 0%   opacity:0 x:-120
 *   - 50%  opacity:1
 *   - 100% opacity:0.4 x:0
 *
 * Phase entry duration 1000ms. Bezier easing on first segment of x.
 */
export const designWithAdvancedTimeline: Design = {
  id: "00000000-0000-0000-0000-000000003001",
  slug: "fx-advanced-timeline",
  title: "Fixture: advanced timeline",
  description: null,
  mode: "single",
  status: "published",
  canvas_width: 1920,
  canvas_height: 1080,
  created_by: "00000000-0000-0000-0000-000000000099",
  created_at: "2026-05-17T00:00:00.000Z",
  updated_at: "2026-05-17T00:00:00.000Z",
  deleted_at: null,
  scenes: [
    {
      id: "00000000-0000-0000-0000-000000003010",
      design_id: "00000000-0000-0000-0000-000000003001",
      order_index: 0,
      name: "main",
      duration_ms: 5000,
      transition_in: "fade",
      transition_out: "fade",
      deleted_at: null,
      elements: [
        {
          id: "00000000-0000-0000-0000-000000003100",
          scene_id: "00000000-0000-0000-0000-000000003010",
          parent_group_id: null,
          element_type: "text",
          z_index: 0,
          locked: false,
          visible: true,
          transform: {
            x: 400, y: 400, width: 1000, height: 100,
            rotation: 0, scale_x: 1, scale_y: 1, opacity: 1,
          },
          style: {
            fill: "#ffffff",
            fontFamily: "Agharti",
            fontSize: 72,
            fontWeight: 700,
            textAlign: "left",
            shadow: null,
          },
          content: { text: "ADVANCED" },
          binding: null,
          animation: {
            entry: {
              type: "noop",
              durationMs: 1000,
              delayMs: 0,
              easing: "linear",
              advancedTimeline: [
                {
                  property: "opacity",
                  keyframes: [
                    { id: "o1", timeMs: 0, value: 0, easingOut: null },
                    { id: "o2", timeMs: 500, value: 1, easingOut: null },
                    { id: "o3", timeMs: 1000, value: 0.4, easingOut: null },
                  ],
                },
                {
                  property: "x",
                  keyframes: [
                    { id: "x1", timeMs: 0, value: -120, easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 } },
                    { id: "x2", timeMs: 1000, value: 0, easingOut: null },
                  ],
                },
              ],
            },
          },
          deleted_at: null,
        },
      ],
    },
  ],
};
```

- [ ] 2. Append to `apps/web/src/server/overlays/builder/compiler.test.ts`:

```ts
import { designWithAdvancedTimeline } from "./fixtures/design-with-advanced-timeline";

describe("compileDesignToHtml — Wave 3B advanced timeline", () => {
  it("emits an @keyframes block named builder-<elementId>-entry", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(
      /@keyframes\s+builder-00000000-0000-0000-0000-000000003100-entry/,
    );
  });

  it("emits a 0% rule containing opacity:0 AND transform with translateX(-120px)", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(/0%\s*\{[^}]*opacity:\s*0\b/);
    expect(html).toMatch(/0%\s*\{[^}]*translate(X|3d)\([^)]*-120/);
  });

  it("emits a 50% rule (mid-timeline) with opacity:1", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(/50%\s*\{[^}]*opacity:\s*1\b/);
  });

  it("emits a 100% rule with opacity:0.4 AND translateX(0)", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(/100%\s*\{[^}]*opacity:\s*0\.4\b/);
    expect(html).toMatch(/100%\s*\{[^}]*translate(X|3d)\(0/);
  });

  it("emits cubic-bezier(0.4, 0, 0.6, 1) as the segment timing function", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(/animation-timing-function:\s*cubic-bezier\(0\.4,\s*0,\s*0\.6,\s*1\)/);
  });

  it("emits an animation: rule referencing the builder-<id>-entry keyframes", () => {
    const html = compileDesignToHtml(designWithAdvancedTimeline, 0);
    expect(html).toMatch(
      /\[data-element-id="00000000-0000-0000-0000-000000003100"\][^{]*\{[^}]*animation:[^;]*builder-00000000-0000-0000-0000-000000003100-entry/,
    );
  });
});
```

- [ ] 3. Run the test (expect failures — compiler branch not implemented):

```bash
npx vitest run apps/web/src/server/overlays/builder/compiler.test.ts
```

- [ ] 4. Extend `apps/web/src/server/overlays/builder/compiler.ts`. Add the advanced-keyframes builder near the existing preset builder:

```ts
import type {
  AdvancedTimeline,
  AdvancedTimelineTrack,
  BezierEasing,
  Keyframe,
  TimelineProperty,
} from "./types";

export function buildAdvancedKeyframesBody(
  timeline: AdvancedTimeline,
  phaseDurationMs: number,
): string {
  if (timeline.length === 0 || phaseDurationMs <= 0) return "";

  // 1. Collect all distinct percentage stops across all tracks.
  const stopsMs = new Set<number>();
  for (const track of timeline) {
    for (const kf of track.keyframes) stopsMs.add(kf.timeMs);
  }
  const sortedStops = [...stopsMs].sort((a, b) => a - b);

  type Stop = {
    percent: number;
    declarations: Record<string, string>;
    transformFragments: string[];
    segmentEasing: BezierEasing | null;
  };
  const stops: Stop[] = [];

  for (const ms of sortedStops) {
    const declarations: Record<string, string> = {};
    const transformFragments: string[] = [];
    let segmentEasing: BezierEasing | null = null;

    for (const track of timeline) {
      const value = resolveTrackValueAtMs(track, ms);
      if (value === null) continue;
      const css = propertyToCss(track.property, value);
      for (const [k, v] of Object.entries(css)) {
        if (k === "transform") transformFragments.push(v);
        else declarations[k] = v;
      }
      const exact = track.keyframes.find((k2) => k2.timeMs === ms);
      if (exact?.easingOut && !segmentEasing) segmentEasing = exact.easingOut;
    }

    stops.push({
      percent: Math.round((ms / phaseDurationMs) * 1000) / 10,
      declarations,
      transformFragments,
      segmentEasing,
    });
  }

  return stops
    .map((s) => {
      const declParts = Object.entries(s.declarations).map(
        ([k, v]) => `${k}: ${v};`,
      );
      if (s.transformFragments.length > 0) {
        declParts.unshift(`transform: ${s.transformFragments.join(" ")};`);
      }
      if (s.segmentEasing) {
        const b = s.segmentEasing;
        declParts.push(
          `animation-timing-function: cubic-bezier(${b.x1}, ${b.y1}, ${b.x2}, ${b.y2});`,
        );
      }
      return `  ${s.percent}% { ${declParts.join(" ")} }`;
    })
    .join("\n");
}

function resolveTrackValueAtMs(
  track: AdvancedTimelineTrack,
  ms: number,
): number | string | null {
  const kfs = track.keyframes;
  if (ms < kfs[0]!.timeMs) return null;
  if (ms > kfs[kfs.length - 1]!.timeMs) return null;

  const exact = kfs.find((k) => k.timeMs === ms);
  if (exact) return exact.value;

  let prev: Keyframe = kfs[0]!;
  let next: Keyframe = kfs[kfs.length - 1]!;
  for (let i = 1; i < kfs.length; i++) {
    if (kfs[i]!.timeMs >= ms) {
      prev = kfs[i - 1]!;
      next = kfs[i]!;
      break;
    }
  }

  if (typeof prev.value === "number" && typeof next.value === "number") {
    const t = (ms - prev.timeMs) / (next.timeMs - prev.timeMs);
    return prev.value + (next.value - prev.value) * t;
  }
  return prev.value;
}

function propertyToCss(
  property: TimelineProperty,
  value: number | string,
): Record<string, string> {
  switch (property) {
    case "opacity": return { opacity: String(value) };
    case "x":       return { transform: `translateX(${value}px)` };
    case "y":       return { transform: `translateY(${value}px)` };
    case "scaleX":  return { transform: `scaleX(${value})` };
    case "scaleY":  return { transform: `scaleY(${value})` };
    case "rotation":return { transform: `rotate(${value}deg)` };
    case "color":   return { color: String(value) };
    case "filter":  return { filter: String(value) };
    default:        return {};
  }
}
```

- [ ] 5. Wire `buildAdvancedKeyframesBody` into the per-element animation emitter. Find the existing `emitElementAnimations` helper and prepend the advanced check:

```ts
for (const phaseName of ["entry", "exit", "loop"] as const) {
  const phase = anim[phaseName];
  if (!phase) continue;

  const kfName = `builder-${el.id}-${phaseName}`;
  let body = "";

  if (phase.advancedTimeline && phase.advancedTimeline.length > 0) {
    body = buildAdvancedKeyframesBody(phase.advancedTimeline, phase.durationMs);
  } else if (phase.type === "noop") {
    continue;
  } else {
    body = buildPresetKeyframesBody(phase.type, phase);
  }

  if (body) {
    blocks.push(`@keyframes ${kfName} {\n${body}\n}`);
    const iteration = phaseName === "loop" ? "infinite" : "1";
    const fill = phaseName === "loop" ? "none" : "forwards";
    rules.push(
      `[data-element-id="${el.id}"].cade-anim-${phaseName} { animation: ${kfName} ${phase.durationMs}ms ${phase.easing} ${phase.delayMs}ms ${iteration} ${fill}; }`,
    );
  }
}
```

- [ ] 6. Re-run tests:

```bash
npx vitest run apps/web/src/server/overlays/builder/compiler.test.ts
```

- [ ] 7. Stage and commit:

```bash
git add apps/web/src/server/overlays/builder/compiler.ts apps/web/src/server/overlays/builder/compiler.test.ts apps/web/src/server/overlays/builder/fixtures/design-with-advanced-timeline.ts
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): compile advancedTimeline to @keyframes

buildAdvancedKeyframesBody walks per-property keyframe tracks,
collects distinct time stops, resolves each track's value at each
stop (exact match or linear interp), and emits combined CSS rule
bodies per percent. Transform-derived properties merge into a single
transform: declaration per stop; opacity/color/filter emit independent
declarations.

Bezier easing on the segment OUT of a keyframe is emitted as
animation-timing-function: cubic-bezier(...) inside that keyframe's
percent rule — CSS handles per-segment timing this way.

The 'noop' sentinel type tells the per-phase emitter to skip the
preset branch when advancedTimeline is empty (advanced opted out
mid-edit) and use advancedTimeline when present. Mutual exclusivity
enforced one layer up in animation-validator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Zustand store — advanced-timeline actions + mutual-exclusivity guard

The Wave 1A canvas store at `apps/web/src/state/builder/store.ts` already manages elements + selection + preset animation state. Wave 3B adds five actions for per-keyframe operations plus a mode toggle. The mutual-exclusivity guard lives inside `setElementAnimationMode` — switching `'advanced' → 'preset'` clears `advancedTimeline` from that phase; switching `'preset' → 'advanced'` clears `type` (set to `'noop'`), `durationMs` defaults to 600, `delayMs` to 0, `easing` to `'linear'`, and seeds two default keyframes (0%, 100%) on the `opacity` track so the timeline isn't empty at first render.

**Files:**
- Modify: `apps/web/src/state/builder/store.ts`
- Modify: `apps/web/src/state/builder/store.test.ts`

#### Steps

- [ ] 1. Append cases to `apps/web/src/state/builder/store.test.ts`:

```ts
describe("zustand store — Wave 3B advanced timeline actions", () => {
  function setupStoreWithOneElement() {
    const store = createBuilderStore();
    const designId = store.getState().createDesign({ title: "Test", mode: "single" });
    const sceneId = store.getState().designs[designId].scenes[0].id;
    const elementId = store.getState().addElement(sceneId, {
      element_type: "text",
      transform: { x: 100, y: 100, width: 400, height: 80, rotation: 0, scale_x: 1, scale_y: 1, opacity: 1 },
      style: { fill: "#ffffff", fontSize: 64 },
      content: { text: "T" },
    });
    return { store, elementId };
  }

  it("setElementAnimationMode('advanced') seeds opacity track with 2 keyframes", () => {
    const { store, elementId } = setupStoreWithOneElement();
    store.getState().setElementAnimationMode(elementId, "entry", "advanced");
    const el = store.getState().getElement(elementId);
    expect(el.animation?.entry?.type).toBe("noop");
    expect(el.animation?.entry?.advancedTimeline).toHaveLength(1);
    expect(el.animation?.entry?.advancedTimeline?.[0].property).toBe("opacity");
    expect(el.animation?.entry?.advancedTimeline?.[0].keyframes).toHaveLength(2);
  });

  it("switching advanced -> preset clears advancedTimeline", () => {
    const { store, elementId } = setupStoreWithOneElement();
    store.getState().setElementAnimationMode(elementId, "entry", "advanced");
    store.getState().setElementAnimationMode(elementId, "entry", "preset");
    const el = store.getState().getElement(elementId);
    expect(el.animation?.entry?.advancedTimeline).toBeUndefined();
    expect(el.animation?.entry?.type).not.toBe("noop"); // reset to a real preset
  });

  it("addKeyframe inserts a new keyframe sorted by timeMs", () => {
    const { store, elementId } = setupStoreWithOneElement();
    store.getState().setElementAnimationMode(elementId, "entry", "advanced");
    store.getState().addKeyframe(elementId, "entry", "opacity", 300, 0.5);
    const track = store
      .getState()
      .getElement(elementId)
      .animation?.entry?.advancedTimeline?.find((t) => t.property === "opacity");
    expect(track?.keyframes.map((k) => k.timeMs)).toEqual([0, 300, 600]);
  });

  it("addKeyframe on a property without a track creates the track", () => {
    const { store, elementId } = setupStoreWithOneElement();
    store.getState().setElementAnimationMode(elementId, "entry", "advanced");
    store.getState().addKeyframe(elementId, "entry", "x", 0, -120);
    store.getState().addKeyframe(elementId, "entry", "x", 600, 0);
    const tracks = store
      .getState()
      .getElement(elementId)
      .animation?.entry?.advancedTimeline;
    expect(tracks?.map((t) => t.property).sort()).toEqual(["opacity", "x"]);
  });

  it("updateKeyframe patches value + timeMs", () => {
    const { store, elementId } = setupStoreWithOneElement();
    store.getState().setElementAnimationMode(elementId, "entry", "advanced");
    const track = store
      .getState()
      .getElement(elementId)
      .animation?.entry?.advancedTimeline?.[0]!;
    const kfId = track.keyframes[1].id;
    store.getState().updateKeyframe(elementId, "entry", "opacity", kfId, { timeMs: 400, value: 0.9 });
    const updated = store
      .getState()
      .getElement(elementId)
      .animation?.entry?.advancedTimeline?.[0].keyframes.find((k) => k.id === kfId);
    expect(updated?.timeMs).toBe(400);
    expect(updated?.value).toBe(0.9);
  });

  it("removeKeyframe drops the keyframe — track collapsed when <2 keyframes remain", () => {
    const { store, elementId } = setupStoreWithOneElement();
    store.getState().setElementAnimationMode(elementId, "entry", "advanced");
    const track = store
      .getState()
      .getElement(elementId)
      .animation?.entry?.advancedTimeline?.[0]!;
    store.getState().removeKeyframe(elementId, "entry", "opacity", track.keyframes[0].id);
    const after = store
      .getState()
      .getElement(elementId)
      .animation?.entry?.advancedTimeline;
    // Only one keyframe left → track removed entirely (a track needs >=2)
    expect(after?.find((t) => t.property === "opacity")).toBeUndefined();
  });

  it("setBezierEasing patches the easingOut on a specific keyframe", () => {
    const { store, elementId } = setupStoreWithOneElement();
    store.getState().setElementAnimationMode(elementId, "entry", "advanced");
    const track = store
      .getState()
      .getElement(elementId)
      .animation?.entry?.advancedTimeline?.[0]!;
    const kfId = track.keyframes[0].id;
    store.getState().setBezierEasing(elementId, "entry", "opacity", kfId, {
      x1: 0.4, y1: 0, x2: 0.6, y2: 1,
    });
    const updated = store
      .getState()
      .getElement(elementId)
      .animation?.entry?.advancedTimeline?.[0].keyframes.find((k) => k.id === kfId);
    expect(updated?.easingOut).toEqual({ x1: 0.4, y1: 0, x2: 0.6, y2: 1 });
  });
});
```

- [ ] 2. Run the test (expect failures — actions not implemented):

```bash
npx vitest run apps/web/src/state/builder/store.test.ts
```

- [ ] 3. Extend `apps/web/src/state/builder/store.ts`. Append to the store factory's `set`-based action set:

```ts
import { nanoid } from "nanoid";
import type {
  AdvancedTimelineTrack,
  BezierEasing,
  Keyframe,
  TimelineProperty,
} from "../../server/overlays/builder/types";

type AnimPhase = "entry" | "exit" | "loop";

function defaultPresetForPhase(phase: AnimPhase): {
  type: string;
  durationMs: number;
  delayMs: number;
  easing: string;
} {
  return {
    type: phase === "entry" ? "fade" : phase === "exit" ? "fade" : "pulse",
    durationMs: phase === "loop" ? 1200 : 400,
    delayMs: 0,
    easing: "ease-out",
  };
}

function seedAdvancedTimeline(): AdvancedTimelineTrack[] {
  return [
    {
      property: "opacity",
      keyframes: [
        { id: nanoid(8), timeMs: 0, value: 0, easingOut: null },
        { id: nanoid(8), timeMs: 600, value: 1, easingOut: null },
      ],
    },
  ];
}

// --- inside the store factory's actions object ---

setElementAnimationMode(elementId: string, phase: AnimPhase, mode: "preset" | "advanced") {
  set((state) => {
    const el = state.elements[elementId];
    if (!el) return state;
    el.animation = el.animation ?? {};
    el.animation[phase] = el.animation[phase] ?? defaultPresetForPhase(phase);

    if (mode === "advanced") {
      el.animation[phase] = {
        ...el.animation[phase],
        type: "noop",
        durationMs: el.animation[phase].durationMs ?? 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: seedAdvancedTimeline(),
      };
    } else {
      // preset mode — clear advancedTimeline + restore a real preset type
      const restored = defaultPresetForPhase(phase);
      const { advancedTimeline: _drop, ...rest } = el.animation[phase];
      el.animation[phase] = {
        ...rest,
        type: rest.type === "noop" ? restored.type : rest.type,
      };
    }
  });
},

addKeyframe(elementId: string, phase: AnimPhase, property: TimelineProperty, timeMs: number, value: number | string) {
  set((state) => {
    const el = state.elements[elementId];
    const ph = el?.animation?.[phase];
    if (!ph || !ph.advancedTimeline) return state;
    let track = ph.advancedTimeline.find((t) => t.property === property);
    if (!track) {
      track = { property, keyframes: [] };
      ph.advancedTimeline.push(track);
    }
    const kf: Keyframe = { id: nanoid(8), timeMs, value, easingOut: null };
    track.keyframes.push(kf);
    track.keyframes.sort((a, b) => a.timeMs - b.timeMs);
  });
},

updateKeyframe(elementId: string, phase: AnimPhase, property: TimelineProperty, keyframeId: string, patch: Partial<Pick<Keyframe, "timeMs" | "value" | "easingOut">>) {
  set((state) => {
    const track = state.elements[elementId]?.animation?.[phase]?.advancedTimeline?.find(
      (t) => t.property === property,
    );
    if (!track) return state;
    const kf = track.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return state;
    if (patch.timeMs !== undefined) kf.timeMs = patch.timeMs;
    if (patch.value !== undefined) kf.value = patch.value;
    if (patch.easingOut !== undefined) kf.easingOut = patch.easingOut;
    track.keyframes.sort((a, b) => a.timeMs - b.timeMs);
  });
},

removeKeyframe(elementId: string, phase: AnimPhase, property: TimelineProperty, keyframeId: string) {
  set((state) => {
    const ph = state.elements[elementId]?.animation?.[phase];
    if (!ph?.advancedTimeline) return state;
    const track = ph.advancedTimeline.find((t) => t.property === property);
    if (!track) return state;
    track.keyframes = track.keyframes.filter((k) => k.id !== keyframeId);
    if (track.keyframes.length < 2) {
      ph.advancedTimeline = ph.advancedTimeline.filter((t) => t.property !== property);
    }
  });
},

setBezierEasing(elementId: string, phase: AnimPhase, property: TimelineProperty, keyframeId: string, easing: BezierEasing | null) {
  set((state) => {
    const kf = state.elements[elementId]?.animation?.[phase]?.advancedTimeline
      ?.find((t) => t.property === property)
      ?.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    kf.easingOut = easing;
  });
},
```

- [ ] 4. Re-run tests:

```bash
npx vitest run apps/web/src/state/builder/store.test.ts
```

- [ ] 5. Stage and commit:

```bash
git add apps/web/src/state/builder/store.ts apps/web/src/state/builder/store.test.ts
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): zustand actions for advanced timeline

Adds five Wave 3B actions to the builder store:
  - setElementAnimationMode(elementId, phase, 'preset'|'advanced')
  - addKeyframe(elementId, phase, property, timeMs, value)
  - updateKeyframe(elementId, phase, property, kfId, patch)
  - removeKeyframe(elementId, phase, property, kfId)
  - setBezierEasing(elementId, phase, property, kfId, bezier)

Mutual-exclusivity guard inside setElementAnimationMode:
  - 'advanced' clears type to 'noop', seeds opacity track [0ms,600ms]
  - 'preset'   drops advancedTimeline + restores a real preset type

removeKeyframe collapses the parent track when fewer than 2 keyframes
remain (matches AdvancedTimelineTrackSchema's .min(2) constraint).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Properties panel — animation mode toggle (Preset / Advanced)

The Wave 1A Properties Panel at `apps/web/src/components/admin/overlay-builder/PropertiesPanel.tsx` has an Animation tab showing per-phase preset selectors. Wave 3B adds a `<ToggleGroup>` at the top of each phase block with two pills: `Preset` and `Advanced`. Selecting Advanced calls `setElementAnimationMode(elementId, phase, 'advanced')` and disables the preset selectors below; switching back re-enables them. When `phase.advancedTimeline?.length > 0`, the toggle is force-set to Advanced and the preset dropdown is grayed out.

**Files:**
- Modify: `apps/web/src/components/admin/overlay-builder/PropertiesPanel.tsx`
- Modify: `apps/web/src/components/admin/overlay-builder/PropertiesPanel.test.tsx`

#### Steps

- [ ] 1. Append cases to `apps/web/src/components/admin/overlay-builder/PropertiesPanel.test.tsx`:

```tsx
describe("PropertiesPanel — Wave 3B animation mode toggle", () => {
  it("renders Preset / Advanced toggle for each phase", () => {
    renderWithStore(<PropertiesPanel />);
    selectElement("test-text");
    fireEvent.click(screen.getByRole("tab", { name: /animation/i }));

    const entryGroup = screen.getByTestId("anim-phase-entry");
    expect(within(entryGroup).getByRole("button", { name: /preset/i })).toBeInTheDocument();
    expect(within(entryGroup).getByRole("button", { name: /advanced/i })).toBeInTheDocument();
  });

  it("clicking Advanced calls setElementAnimationMode(..., 'advanced')", () => {
    const setMode = vi.fn();
    renderWithStore(<PropertiesPanel />, { actions: { setElementAnimationMode: setMode } });
    selectElement("test-text");
    fireEvent.click(screen.getByRole("tab", { name: /animation/i }));
    const entryGroup = screen.getByTestId("anim-phase-entry");
    fireEvent.click(within(entryGroup).getByRole("button", { name: /advanced/i }));
    expect(setMode).toHaveBeenCalledWith("test-text", "entry", "advanced");
  });

  it("when advancedTimeline non-empty, preset dropdown disabled + Advanced toggle active", () => {
    renderWithStoreSeed({
      "test-text": {
        animation: {
          entry: {
            type: "noop",
            durationMs: 600,
            delayMs: 0,
            easing: "linear",
            advancedTimeline: [
              { property: "opacity", keyframes: [
                { id: "a", timeMs: 0, value: 0, easingOut: null },
                { id: "b", timeMs: 600, value: 1, easingOut: null },
              ] },
            ],
          },
        },
      },
    });
    selectElement("test-text");
    fireEvent.click(screen.getByRole("tab", { name: /animation/i }));
    const entryGroup = screen.getByTestId("anim-phase-entry");
    expect(within(entryGroup).getByRole("button", { name: /advanced/i })).toHaveAttribute("data-active", "true");
    expect(within(entryGroup).getByRole("combobox", { name: /preset type/i })).toBeDisabled();
  });

  it("clicking 'Open Timeline' button toggles TimelinePanel visibility via store", () => {
    const toggle = vi.fn();
    renderWithStore(<PropertiesPanel />, { actions: { toggleTimelinePanel: toggle } });
    selectElement("test-text");
    fireEvent.click(screen.getByRole("tab", { name: /animation/i }));
    fireEvent.click(screen.getByRole("button", { name: /open timeline/i }));
    expect(toggle).toHaveBeenCalled();
  });
});
```

- [ ] 2. Modify `apps/web/src/components/admin/overlay-builder/PropertiesPanel.tsx`. Inside the Animation tab content, wrap each phase's existing preset selector with a header containing the mode toggle:

```tsx
type AnimPhase = "entry" | "exit" | "loop";

function PhaseBlock({ phase, element }: { phase: AnimPhase; element: Element }) {
  const setMode = useBuilderStore((s) => s.setElementAnimationMode);
  const toggleTimeline = useBuilderStore((s) => s.toggleTimelinePanel);
  const phaseData = element.animation?.[phase];
  const isAdvanced = (phaseData?.advancedTimeline?.length ?? 0) > 0;

  return (
    <div data-testid={`anim-phase-${phase}`} className="rounded border border-neutral-800 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium capitalize">{phase}</span>
        <div className="inline-flex rounded bg-neutral-900 p-0.5" role="group">
          <button
            type="button"
            data-active={!isAdvanced}
            onClick={() => setMode(element.id, phase, "preset")}
            className={cn(
              "px-2 py-1 text-xs rounded",
              !isAdvanced ? "bg-neutral-700 text-white" : "text-neutral-400",
            )}
          >
            Preset
          </button>
          <button
            type="button"
            data-active={isAdvanced}
            onClick={() => setMode(element.id, phase, "advanced")}
            className={cn(
              "px-2 py-1 text-xs rounded",
              isAdvanced ? "bg-neutral-700 text-white" : "text-neutral-400",
            )}
          >
            Advanced
          </button>
        </div>
      </div>

      {/* Preset selectors — disabled in advanced mode */}
      <PresetSelectors phase={phase} element={element} disabled={isAdvanced} />

      {isAdvanced && (
        <button
          type="button"
          onClick={toggleTimeline}
          className="w-full text-xs rounded bg-[#6bcd06] text-black px-3 py-2 font-medium"
        >
          Open Timeline
        </button>
      )}
    </div>
  );
}
```

- [ ] 3. Add `toggleTimelinePanel` action to the store (also used by Task 6):

```ts
// In apps/web/src/state/builder/store.ts
timelinePanelOpen: false,
toggleTimelinePanel() {
  set((state) => { state.timelinePanelOpen = !state.timelinePanelOpen; });
},
openTimelinePanel() {
  set((state) => { state.timelinePanelOpen = true; });
},
closeTimelinePanel() {
  set((state) => { state.timelinePanelOpen = false; });
},
```

- [ ] 4. Re-run component tests:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/PropertiesPanel.test.tsx
```

- [ ] 5. Stage and commit:

```bash
git add apps/web/src/components/admin/overlay-builder/PropertiesPanel.tsx apps/web/src/components/admin/overlay-builder/PropertiesPanel.test.tsx apps/web/src/state/builder/store.ts
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): properties panel mode toggle + open timeline

Each phase block (entry / exit / loop) gets a Preset / Advanced pill
toggle. Advanced disables the preset dropdown and reveals an "Open
Timeline" button that toggles the bottom TimelinePanel via the store.

Adds timelinePanelOpen + toggleTimelinePanel / openTimelinePanel /
closeTimelinePanel actions — TimelinePanel uses these in Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: TimelinePanel shell — bottom dock with header + close

Build the bottom-dock panel itself. Wave 1A's CanvasEditorShell renders three regions (toolbar / canvas+layers / properties). Wave 3B mounts a fourth region below the canvas that toggles based on `state.timelinePanelOpen`. The shell of `TimelinePanel` contains a header (selected element title, close button, time-readout) and a placeholder body — Tasks 7-11 fill the body with the ruler, tracks, keyframe nodes, bezier handles, and inspector.

**Files:**
- Create: `apps/web/src/components/admin/overlay-builder/TimelinePanel.tsx`
- Create: `apps/web/src/components/admin/overlay-builder/TimelinePanel.test.tsx`
- Modify: `apps/web/src/components/admin/overlay-builder/CanvasEditorShell.tsx`
- Modify: `apps/web/src/components/admin/overlay-builder/CanvasEditorShell.test.tsx`

#### Steps

- [ ] 1. Write component test at `apps/web/src/components/admin/overlay-builder/TimelinePanel.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelinePanel } from "./TimelinePanel";

describe("TimelinePanel", () => {
  it("renders nothing when no element selected", () => {
    const { container } = render(<TimelinePanel />);
    expect(container.querySelector("[data-testid=timeline-panel]")).toBeNull();
  });

  it("renders header with element title when element selected and mode advanced", () => {
    renderWithStoreSeed({
      selectedElementId: "el-1",
      elements: { "el-1": minimalElementWithAdvancedEntry() },
      timelinePanelOpen: true,
    });
    render(<TimelinePanel />);
    expect(screen.getByTestId("timeline-panel")).toBeInTheDocument();
    expect(screen.getByText(/timeline/i)).toBeInTheDocument();
  });

  it("close button calls closeTimelinePanel", () => {
    const close = vi.fn();
    renderWithStoreSeed({ /* ... */ timelinePanelOpen: true });
    render(<TimelinePanel />);
    fireEvent.click(screen.getByRole("button", { name: /close timeline/i }));
    expect(close).toHaveBeenCalled();
  });

  it("phase tabs render for entry/exit/loop, defaulting to entry", () => {
    renderWithStoreSeed({ /* ... */ timelinePanelOpen: true });
    render(<TimelinePanel />);
    expect(screen.getByRole("tab", { name: /entry/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /exit/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /loop/i })).toBeInTheDocument();
  });
});
```

- [ ] 2. Create `apps/web/src/components/admin/overlay-builder/TimelinePanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useBuilderStore } from "@/state/builder/store";
import { TimelineRuler } from "./timeline/TimelineRuler";
import { TimelineTracks } from "./timeline/TimelineTracks";
import { KeyframeInspector } from "./timeline/KeyframeInspector";

type AnimPhase = "entry" | "exit" | "loop";

export function TimelinePanel() {
  const open = useBuilderStore((s) => s.timelinePanelOpen);
  const close = useBuilderStore((s) => s.closeTimelinePanel);
  const selectedElementId = useBuilderStore((s) => s.selectedElementId);
  const element = useBuilderStore((s) => (selectedElementId ? s.elements[selectedElementId] : null));
  const [phase, setPhase] = useState<AnimPhase>("entry");

  if (!open || !element) return null;

  const phaseData = element.animation?.[phase];
  const inAdvancedMode = (phaseData?.advancedTimeline?.length ?? 0) > 0;

  return (
    <div
      data-testid="timeline-panel"
      className="border-t border-neutral-800 bg-neutral-950 h-72 flex flex-col"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Timeline — {element.content?.text ?? element.element_type}</span>
          <PhaseTabs value={phase} onChange={setPhase} />
        </div>
        <button
          aria-label="Close timeline"
          onClick={close}
          className="text-neutral-400 hover:text-white"
        >
          <X size={16} />
        </button>
      </header>

      {!inAdvancedMode ? (
        <div className="flex items-center justify-center flex-1 text-neutral-500 text-sm">
          Switch this phase to Advanced mode in Properties to edit a timeline.
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            <TimelineRuler phase={phase} element={element} />
            <TimelineTracks phase={phase} element={element} />
          </div>
          <div className="w-72 border-l border-neutral-800 overflow-y-auto">
            <KeyframeInspector phase={phase} element={element} />
          </div>
        </div>
      )}
    </div>
  );
}

function PhaseTabs({
  value,
  onChange,
}: {
  value: AnimPhase;
  onChange: (p: AnimPhase) => void;
}) {
  return (
    <div role="tablist" className="inline-flex bg-neutral-900 rounded p-0.5">
      {(["entry", "exit", "loop"] as AnimPhase[]).map((p) => (
        <button
          key={p}
          role="tab"
          aria-selected={value === p}
          onClick={() => onChange(p)}
          className={cn(
            "px-2 py-1 text-xs rounded capitalize",
            value === p ? "bg-neutral-700 text-white" : "text-neutral-400",
          )}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
```

- [ ] 3. Modify `CanvasEditorShell.tsx` — mount TimelinePanel below the canvas region:

```tsx
import { TimelinePanel } from "./TimelinePanel";

// Inside the layout, AFTER the layers panel and BEFORE the closing tag of the canvas column:
<TimelinePanel />
```

- [ ] 4. Add the Timeline button to the top bar in CanvasEditorShell:

```tsx
const toggleTimeline = useBuilderStore((s) => s.toggleTimelinePanel);
// ...
<button
  onClick={toggleTimeline}
  className="text-xs rounded bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5"
>
  Timeline
</button>
```

- [ ] 5. Run tests:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/TimelinePanel.test.tsx apps/web/src/components/admin/overlay-builder/CanvasEditorShell.test.tsx
```

- [ ] 6. Stage and commit:

```bash
git add apps/web/src/components/admin/overlay-builder/TimelinePanel.tsx apps/web/src/components/admin/overlay-builder/TimelinePanel.test.tsx apps/web/src/components/admin/overlay-builder/CanvasEditorShell.tsx apps/web/src/components/admin/overlay-builder/CanvasEditorShell.test.tsx
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): timeline panel shell + Timeline button

Adds the bottom-dock TimelinePanel skeleton with header, phase tabs
(entry/exit/loop), and close button. Renders nothing when no element
selected or when the panel is toggled off. When the selected element's
current phase is preset, shows a placeholder "switch to Advanced"
message — the ruler/tracks/inspector only mount in advanced mode.

CanvasEditorShell gets a Timeline button on the top bar to toggle the
panel + mounts <TimelinePanel/> beneath the canvas column.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: TimelineRuler — pixels-per-second scale + draggable current-time cursor

The ruler sits at the top of the timeline content area and shows time markers from `0ms` to `phase.durationMs`. A draggable vertical cursor indicates the current scrub position (state lives in store as `state.timelineCursorMs[elementId][phase]`). Dragging the cursor calls `setTimelineCursor(elementId, phase, ms)` which Task 11 picks up to drive the CanvasStage scrub preview.

**Files:**
- Create: `apps/web/src/components/admin/overlay-builder/timeline/TimelineRuler.tsx`
- Create: `apps/web/src/components/admin/overlay-builder/timeline/TimelineRuler.test.tsx`
- Create: `apps/web/src/components/admin/overlay-builder/timeline/time-axis.ts` (shared helpers: `msToPx`, `pxToMs`, `pickTickStep`)
- Create: `apps/web/src/components/admin/overlay-builder/timeline/time-axis.test.ts`

#### Steps

- [ ] 1. Write helper tests at `apps/web/src/components/admin/overlay-builder/timeline/time-axis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { msToPx, pxToMs, pickTickStep } from "./time-axis";

describe("time-axis", () => {
  it("msToPx and pxToMs are inverses", () => {
    const opts = { totalMs: 1000, widthPx: 800 };
    expect(msToPx(500, opts)).toBeCloseTo(400);
    expect(pxToMs(400, opts)).toBeCloseTo(500);
    expect(pxToMs(msToPx(123, opts), opts)).toBeCloseTo(123);
  });

  it("pickTickStep returns 100ms for short timelines", () => {
    expect(pickTickStep({ totalMs: 600, widthPx: 800 })).toBe(100);
  });

  it("pickTickStep returns 500ms for medium timelines", () => {
    expect(pickTickStep({ totalMs: 3000, widthPx: 800 })).toBe(500);
  });

  it("pickTickStep returns 1000ms for long timelines", () => {
    expect(pickTickStep({ totalMs: 15000, widthPx: 800 })).toBe(1000);
  });
});
```

- [ ] 2. Create `apps/web/src/components/admin/overlay-builder/timeline/time-axis.ts`:

```ts
export type Axis = { totalMs: number; widthPx: number };

export function msToPx(ms: number, { totalMs, widthPx }: Axis): number {
  if (totalMs <= 0) return 0;
  return (ms / totalMs) * widthPx;
}

export function pxToMs(px: number, { totalMs, widthPx }: Axis): number {
  if (widthPx <= 0) return 0;
  return Math.max(0, Math.min(totalMs, (px / widthPx) * totalMs));
}

const STEPS_MS = [50, 100, 200, 500, 1000, 2000, 5000, 10_000];
const MIN_TICK_GAP_PX = 60;

export function pickTickStep({ totalMs, widthPx }: Axis): number {
  for (const step of STEPS_MS) {
    const gap = msToPx(step, { totalMs, widthPx });
    if (gap >= MIN_TICK_GAP_PX) return step;
  }
  return STEPS_MS[STEPS_MS.length - 1]!;
}
```

- [ ] 3. Run helper tests — expect green.

- [ ] 4. Write ruler component tests:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineRuler } from "./TimelineRuler";

describe("TimelineRuler", () => {
  it("renders ticks every pickTickStep from 0 to durationMs", () => {
    render(<TimelineRuler phase="entry" element={mockElementWithDurationMs(1000)} />);
    // 1000ms / 100ms steps = 11 labels (0..1000 inclusive)
    expect(screen.getAllByTestId(/ruler-tick-/)).toHaveLength(11);
  });

  it("renders current-time cursor at correct pixel position", () => {
    const setCursor = vi.fn();
    renderWithStoreSeed({
      timelineCursorMs: { "el-1": { entry: 250 } },
    });
    render(<TimelineRuler phase="entry" element={mockElementWithDurationMs(1000)} />);
    const cursor = screen.getByTestId("ruler-cursor");
    // 250ms / 1000ms * 800px container = 200px
    expect(cursor.style.left).toBe("200px");
  });

  it("clicking on the ruler sets the cursor to the clicked ms", () => {
    const setCursor = vi.fn();
    renderWithStoreSeed({ actions: { setTimelineCursor: setCursor } });
    render(<TimelineRuler phase="entry" element={mockElementWithDurationMs(1000)} />);
    fireEvent.mouseDown(screen.getByTestId("ruler-track"), { clientX: 400 });
    expect(setCursor).toHaveBeenCalledWith("el-1", "entry", expect.closeTo(500, 5));
  });
});
```

- [ ] 5. Create `apps/web/src/components/admin/overlay-builder/timeline/TimelineRuler.tsx`:

```tsx
"use client";
import { useEffect, useRef } from "react";
import { useBuilderStore } from "@/state/builder/store";
import { msToPx, pxToMs, pickTickStep } from "./time-axis";

const RULER_HEIGHT_PX = 28;

export function TimelineRuler({
  phase,
  element,
}: {
  phase: "entry" | "exit" | "loop";
  element: { id: string; animation?: { entry?: any; exit?: any; loop?: any } };
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const durationMs = element.animation?.[phase]?.durationMs ?? 0;
  const cursorMs = useBuilderStore(
    (s) => s.timelineCursorMs?.[element.id]?.[phase] ?? 0,
  );
  const setCursor = useBuilderStore((s) => s.setTimelineCursor);
  const [width, setWidth] = useResizeObserverWidth(trackRef);

  useEffect(() => {
    if (!trackRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(w);
    });
    ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, [setWidth]);

  const axis = { totalMs: durationMs, widthPx: width };
  const step = pickTickStep(axis);
  const ticks: number[] = [];
  for (let t = 0; t <= durationMs; t += step) ticks.push(t);

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ms = pxToMs(e.clientX - rect.left, axis);
    setCursor(element.id, phase, ms);
    function move(ev: MouseEvent) {
      const ms2 = pxToMs(ev.clientX - rect!.left, axis);
      setCursor(element.id, phase, ms2);
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div
      ref={trackRef}
      data-testid="ruler-track"
      onMouseDown={handleMouseDown}
      className="relative border-b border-neutral-800 cursor-col-resize select-none"
      style={{ height: RULER_HEIGHT_PX }}
    >
      {ticks.map((t) => {
        const left = msToPx(t, axis);
        return (
          <div
            key={t}
            data-testid={`ruler-tick-${t}`}
            className="absolute top-0 bottom-0 border-l border-neutral-700"
            style={{ left }}
          >
            <span className="ml-1 text-[10px] text-neutral-500">{t}ms</span>
          </div>
        );
      })}
      <div
        data-testid="ruler-cursor"
        className="absolute top-0 bottom-0 w-0.5 bg-[#fe036d] pointer-events-none"
        style={{ left: `${msToPx(cursorMs, axis)}px` }}
      />
    </div>
  );
}
```

- [ ] 6. Add `timelineCursorMs` + `setTimelineCursor` to the store:

```ts
timelineCursorMs: {} as Record<string, Partial<Record<"entry" | "exit" | "loop", number>>>,
setTimelineCursor(elementId: string, phase: "entry" | "exit" | "loop", ms: number) {
  set((state) => {
    state.timelineCursorMs[elementId] = state.timelineCursorMs[elementId] ?? {};
    state.timelineCursorMs[elementId][phase] = ms;
  });
},
```

- [ ] 7. Run tests:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/timeline
```

- [ ] 8. Stage and commit:

```bash
git add apps/web/src/components/admin/overlay-builder/timeline/TimelineRuler.tsx apps/web/src/components/admin/overlay-builder/timeline/TimelineRuler.test.tsx apps/web/src/components/admin/overlay-builder/timeline/time-axis.ts apps/web/src/components/admin/overlay-builder/timeline/time-axis.test.ts apps/web/src/state/builder/store.ts
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): timeline ruler + cursor + axis helpers

TimelineRuler renders evenly-spaced tick marks (50/100/200/500/1000ms
steps picked by pickTickStep based on viewport width) and a draggable
current-time cursor. Mouse-down on the ruler track sets the cursor;
drag updates it continuously. Pink cursor (#fe036d brand) sits on top
of the ticks.

time-axis.ts exposes pure msToPx / pxToMs / pickTickStep helpers
shared by every timeline subcomponent.

Adds timelineCursorMs + setTimelineCursor to the store. Cursor is
per-(element, phase) so swapping elements preserves each one's
last-scrubbed position.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: KeyframeNode — draggable diamond on a per-property sub-track

Each track in the timeline renders one row per property (opacity / x / y / scaleX / scaleY / rotation / color / filter). Inside each row, every keyframe is a draggable diamond positioned at `msToPx(kf.timeMs)`. Click selects the keyframe (selection lives in store as `state.selectedKeyframeId`). Drag horizontally calls `updateKeyframe(... { timeMs })`. Delete-key while selected calls `removeKeyframe(...)`.

**Files:**
- Create: `apps/web/src/components/admin/overlay-builder/timeline/KeyframeNode.tsx`
- Create: `apps/web/src/components/admin/overlay-builder/timeline/KeyframeNode.test.tsx`

#### Steps

- [ ] 1. Test cases at `apps/web/src/components/admin/overlay-builder/timeline/KeyframeNode.test.tsx`:

```tsx
describe("KeyframeNode", () => {
  it("renders a diamond at msToPx(timeMs)", () => {
    render(<KeyframeNode {...mkProps({ timeMs: 250, durationMs: 1000, widthPx: 800 })} />);
    const node = screen.getByTestId(/keyframe-node-/);
    expect(node.style.left).toBe("200px"); // 250/1000 * 800
  });

  it("click selects the keyframe", () => {
    const select = vi.fn();
    render(<KeyframeNode {...mkProps()} onSelect={select} />);
    fireEvent.mouseDown(screen.getByTestId(/keyframe-node-/));
    expect(select).toHaveBeenCalled();
  });

  it("when selectedKeyframeId matches, node has data-selected=true", () => {
    renderWithStoreSeed({ selectedKeyframeId: "kf-1" });
    render(<KeyframeNode {...mkProps({ id: "kf-1" })} />);
    expect(screen.getByTestId("keyframe-node-kf-1")).toHaveAttribute("data-selected", "true");
  });

  it("dragging horizontally calls updateKeyframe with new timeMs", () => {
    const update = vi.fn();
    renderWithStoreSeed({ actions: { updateKeyframe: update } });
    render(<KeyframeNode {...mkProps({ id: "kf-1", timeMs: 200, durationMs: 1000, widthPx: 800 })} />);
    const node = screen.getByTestId("keyframe-node-kf-1");
    fireEvent.mouseDown(node, { clientX: 160 });
    fireEvent.mouseMove(window, { clientX: 240 });
    fireEvent.mouseUp(window);
    expect(update).toHaveBeenCalledWith(
      expect.any(String),
      "entry",
      "opacity",
      "kf-1",
      expect.objectContaining({ timeMs: expect.closeTo(300, 5) }),
    );
  });

  it("Delete key while selected calls removeKeyframe", () => {
    const remove = vi.fn();
    renderWithStoreSeed({ selectedKeyframeId: "kf-1", actions: { removeKeyframe: remove } });
    render(<KeyframeNode {...mkProps({ id: "kf-1" })} />);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(remove).toHaveBeenCalled();
  });
});
```

- [ ] 2. Create `apps/web/src/components/admin/overlay-builder/timeline/KeyframeNode.tsx`:

```tsx
"use client";
import { useEffect } from "react";
import { useBuilderStore } from "@/state/builder/store";
import { msToPx, pxToMs } from "./time-axis";

export function KeyframeNode({
  elementId,
  phase,
  property,
  id,
  timeMs,
  durationMs,
  widthPx,
  containerRect,
}: {
  elementId: string;
  phase: "entry" | "exit" | "loop";
  property: "opacity" | "x" | "y" | "scaleX" | "scaleY" | "rotation" | "color" | "filter";
  id: string;
  timeMs: number;
  durationMs: number;
  widthPx: number;
  containerRect: DOMRect | null;
}) {
  const selectedKeyframeId = useBuilderStore((s) => s.selectedKeyframeId);
  const selectKeyframe = useBuilderStore((s) => s.selectKeyframe);
  const updateKeyframe = useBuilderStore((s) => s.updateKeyframe);
  const removeKeyframe = useBuilderStore((s) => s.removeKeyframe);
  const isSelected = selectedKeyframeId === id;
  const axis = { totalMs: durationMs, widthPx };
  const left = msToPx(timeMs, axis);

  useEffect(() => {
    if (!isSelected) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeKeyframe(elementId, phase, property, id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSelected, elementId, phase, property, id, removeKeyframe]);

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    selectKeyframe(id);
    if (!containerRect) return;
    const startX = e.clientX;
    const startMs = timeMs;
    function move(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dMs = (dx / widthPx) * durationMs;
      const next = Math.max(0, Math.min(durationMs, startMs + dMs));
      updateKeyframe(elementId, phase, property, id, { timeMs: next });
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div
      data-testid={`keyframe-node-${id}`}
      data-selected={isSelected}
      onMouseDown={handleMouseDown}
      className={cn(
        "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rotate-45 cursor-pointer transition-colors",
        isSelected ? "bg-[#fe036d] ring-2 ring-white" : "bg-[#6bcd06]",
      )}
      style={{ left }}
    />
  );
}
```

- [ ] 3. Add `selectedKeyframeId` + `selectKeyframe` to the store:

```ts
selectedKeyframeId: null as string | null,
selectKeyframe(id: string | null) {
  set((state) => { state.selectedKeyframeId = id; });
},
```

- [ ] 4. Run tests + commit:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/timeline/KeyframeNode.test.tsx
git add apps/web/src/components/admin/overlay-builder/timeline/KeyframeNode.tsx apps/web/src/components/admin/overlay-builder/timeline/KeyframeNode.test.tsx apps/web/src/state/builder/store.ts
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): draggable keyframe diamond nodes

KeyframeNode positions a 45deg-rotated square at msToPx(timeMs) on
its parent track. Click selects (selectedKeyframeId in store); drag
horizontally calls updateKeyframe with the new timeMs clamped to
phase.durationMs. Delete/Backspace while selected removes the
keyframe via removeKeyframe (track auto-collapses to <2 keyframes per
Task 4 logic).

Brand colors: unselected green (#6bcd06), selected pink (#fe036d)
with white ring — matches every other v2 overlay editor surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: TimelineTracks — per-element multi-property track list + add-keyframe-on-click

Wraps the per-property rows. Each row labels the property on the left (~80px column) and renders a relative-positioned track to the right containing the row's KeyframeNodes. Clicking on an empty area of a row's track at time `T` calls `addKeyframe(elementId, phase, property, T, defaultValueForProperty(property))`. The list of tracks is derived from `phase.advancedTimeline` — properties without a track are listed as ghosts (clicking the ghost row creates the track + seeds it with one keyframe).

**Files:**
- Create: `apps/web/src/components/admin/overlay-builder/timeline/TimelineTracks.tsx`
- Create: `apps/web/src/components/admin/overlay-builder/timeline/TimelineTracks.test.tsx`

#### Steps

- [ ] 1. Component tests:

```tsx
describe("TimelineTracks", () => {
  it("renders one row per existing track", () => {
    renderWithStoreSeed({
      elements: {
        "el-1": {
          animation: {
            entry: {
              type: "noop", durationMs: 1000, delayMs: 0, easing: "linear",
              advancedTimeline: [
                { property: "opacity", keyframes: [
                  { id: "a", timeMs: 0, value: 0, easingOut: null },
                  { id: "b", timeMs: 1000, value: 1, easingOut: null },
                ]},
                { property: "x", keyframes: [
                  { id: "c", timeMs: 0, value: -120, easingOut: null },
                  { id: "d", timeMs: 1000, value: 0, easingOut: null },
                ]},
              ],
            },
          },
        },
      },
    });
    render(<TimelineTracks phase="entry" element={mockEl()} />);
    expect(screen.getByTestId("track-row-opacity")).toBeInTheDocument();
    expect(screen.getByTestId("track-row-x")).toBeInTheDocument();
  });

  it("renders ghost rows for properties without a track", () => {
    renderWithStoreSeed({ /* only opacity track */ });
    render(<TimelineTracks phase="entry" element={mockEl()} />);
    expect(screen.getByTestId("track-row-y")).toHaveAttribute("data-ghost", "true");
    expect(screen.getByTestId("track-row-rotation")).toHaveAttribute("data-ghost", "true");
  });

  it("clicking empty track area calls addKeyframe with computed ms", () => {
    const add = vi.fn();
    renderWithStoreSeed({ /* el-1 with opacity track */, actions: { addKeyframe: add } });
    render(<TimelineTracks phase="entry" element={mockEl()} />);
    fireEvent.click(screen.getByTestId("track-row-opacity-clickarea"), { clientX: 400 });
    expect(add).toHaveBeenCalledWith("el-1", "entry", "opacity", expect.closeTo(500, 5), expect.anything());
  });
});
```

- [ ] 2. Create `apps/web/src/components/admin/overlay-builder/timeline/TimelineTracks.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useBuilderStore } from "@/state/builder/store";
import { KeyframeNode } from "./KeyframeNode";
import { BezierHandle } from "./BezierHandle";
import { pxToMs, msToPx } from "./time-axis";
import type { TimelineProperty } from "@/server/overlays/builder/types";

const ALL_PROPERTIES: TimelineProperty[] = [
  "opacity", "x", "y", "scaleX", "scaleY", "rotation", "color", "filter",
];

const DEFAULT_VALUE_FOR: Record<TimelineProperty, number | string> = {
  opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
  color: "#ffffff", filter: "none",
};

const ROW_HEIGHT_PX = 28;

export function TimelineTracks({
  phase,
  element,
}: {
  phase: "entry" | "exit" | "loop";
  element: any;
}) {
  const addKeyframe = useBuilderStore((s) => s.addKeyframe);
  const phaseData = element.animation?.[phase];
  const tracks = phaseData?.advancedTimeline ?? [];
  const durationMs = phaseData?.durationMs ?? 0;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((e) => setWidth(e[0]?.contentRect.width ?? 0));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      {ALL_PROPERTIES.map((prop) => {
        const track = tracks.find((t: any) => t.property === prop);
        const isGhost = !track;
        const axis = { totalMs: durationMs, widthPx: width };
        return (
          <div
            key={prop}
            data-testid={`track-row-${prop}`}
            data-ghost={isGhost}
            className={cn(
              "flex border-b border-neutral-800 relative",
              isGhost && "opacity-40",
            )}
            style={{ height: ROW_HEIGHT_PX }}
          >
            <div className="w-20 px-2 flex items-center text-xs text-neutral-400 border-r border-neutral-800">
              {prop}
            </div>
            <div
              data-testid={`track-row-${prop}-clickarea`}
              className="relative flex-1 cursor-cell"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ms = pxToMs(e.clientX - rect.left, axis);
                addKeyframe(element.id, phase, prop, ms, DEFAULT_VALUE_FOR[prop]);
              }}
            >
              {!isGhost && track.keyframes.map((kf: any, i: number) => (
                <KeyframeNode
                  key={kf.id}
                  elementId={element.id}
                  phase={phase}
                  property={prop}
                  id={kf.id}
                  timeMs={kf.timeMs}
                  durationMs={durationMs}
                  widthPx={width}
                  containerRect={containerRef.current?.getBoundingClientRect() ?? null}
                />
              ))}
              {!isGhost && track.keyframes.slice(0, -1).map((kf: any, i: number) => {
                const next = track.keyframes[i + 1];
                return (
                  <BezierHandle
                    key={`${kf.id}-handle`}
                    elementId={element.id}
                    phase={phase}
                    property={prop}
                    fromKeyframeId={kf.id}
                    fromTimeMs={kf.timeMs}
                    toTimeMs={next.timeMs}
                    easingOut={kf.easingOut}
                    durationMs={durationMs}
                    widthPx={width}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] 3. Run tests + commit:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/timeline/TimelineTracks.test.tsx
git add apps/web/src/components/admin/overlay-builder/timeline/TimelineTracks.tsx apps/web/src/components/admin/overlay-builder/timeline/TimelineTracks.test.tsx
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): per-property track rows + add-keyframe-on-click

TimelineTracks renders 8 rows (one per TimelineProperty) inside the
panel's content area. Existing tracks render their KeyframeNodes plus
BezierHandle between adjacent keyframes; properties without a track
render as 40%-opacity ghost rows clickable to seed the first keyframe.

Clicking empty space on any row calls addKeyframe with the computed
ms (pxToMs(clientX - left, axis)) and a sensible default value per
property (opacity:1, x:0, color:#ffffff, etc.). The row's track
auto-creates if it didn't exist.

ResizeObserver tracks container width so msToPx stays correct when
the user resizes the timeline panel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: BezierHandle — draggable cubic-bezier curve between two adjacent keyframes

Between every pair of adjacent keyframes (after the segment-out keyframe is selected), a curve overlay shows the cubic-bezier with two draggable control points (P1, P2). Dragging a point updates `keyframes[i].easingOut` via `setBezierEasing(...)`. The curve renders as an SVG path inside the track row, sized to fit between the two keyframe x-positions, with y-axis squeezed to row height. Default (no easing set) renders a hairline diagonal indicating linear.

**Files:**
- Create: `apps/web/src/components/admin/overlay-builder/timeline/BezierHandle.tsx`
- Create: `apps/web/src/components/admin/overlay-builder/timeline/BezierHandle.test.tsx`

#### Steps

- [ ] 1. Component tests at `apps/web/src/components/admin/overlay-builder/timeline/BezierHandle.test.tsx`:

```tsx
describe("BezierHandle", () => {
  it("renders an SVG path between fromTimeMs and toTimeMs positions", () => {
    render(<BezierHandle {...mkProps({ fromTimeMs: 0, toTimeMs: 500, durationMs: 1000, widthPx: 800 })} />);
    const svg = screen.getByTestId(/bezier-handle-/);
    expect(svg).toBeInTheDocument();
    expect(svg.style.left).toBe("0px");
    expect(svg.style.width).toBe("400px"); // (500-0)/1000*800
  });

  it("renders linear hairline when easingOut is null", () => {
    render(<BezierHandle {...mkProps({ easingOut: null })} />);
    const path = screen.getByTestId(/bezier-curve-/);
    // Linear path: control points = endpoints
    expect(path.getAttribute("d")).toMatch(/M\s*0\s+\d+\s+C\s*0\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+/);
  });

  it("dragging control point P1 calls setBezierEasing with updated x1/y1", () => {
    const setBez = vi.fn();
    renderWithStoreSeed({ actions: { setBezierEasing: setBez } });
    render(<BezierHandle {...mkProps({ easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 } })} />);
    const p1 = screen.getByTestId(/bezier-handle-.*-p1/);
    fireEvent.mouseDown(p1, { clientX: 100, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 5 });
    fireEvent.mouseUp(window);
    expect(setBez).toHaveBeenCalledWith(
      expect.any(String), "entry", "opacity", expect.any(String),
      expect.objectContaining({ x1: expect.any(Number), y1: expect.any(Number) }),
    );
  });

  it("clamps x1/x2 to [0, 1] when drag overshoots", () => {
    const setBez = vi.fn();
    renderWithStoreSeed({ actions: { setBezierEasing: setBez } });
    render(<BezierHandle {...mkProps()} />);
    const p2 = screen.getByTestId(/bezier-handle-.*-p2/);
    fireEvent.mouseDown(p2, { clientX: 1000, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 5000, clientY: -200 });
    fireEvent.mouseUp(window);
    const call = setBez.mock.calls[setBez.mock.calls.length - 1];
    const easing = call[4];
    expect(easing.x2).toBeLessThanOrEqual(1);
    expect(easing.x2).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] 2. Create `apps/web/src/components/admin/overlay-builder/timeline/BezierHandle.tsx`:

```tsx
"use client";
import { nanoid } from "nanoid";
import { useMemo, useRef } from "react";
import { useBuilderStore } from "@/state/builder/store";
import type { BezierEasing } from "@/server/overlays/builder/types";

const ROW_HEIGHT_PX = 28;

export function BezierHandle({
  elementId,
  phase,
  property,
  fromKeyframeId,
  fromTimeMs,
  toTimeMs,
  easingOut,
  durationMs,
  widthPx,
}: {
  elementId: string;
  phase: "entry" | "exit" | "loop";
  property: string;
  fromKeyframeId: string;
  fromTimeMs: number;
  toTimeMs: number;
  easingOut: BezierEasing | null;
  durationMs: number;
  widthPx: number;
}) {
  const setBezier = useBuilderStore((s) => s.setBezierEasing);
  const handleId = useMemo(() => nanoid(6), []);
  const segmentLeft = (fromTimeMs / durationMs) * widthPx;
  const segmentWidth = ((toTimeMs - fromTimeMs) / durationMs) * widthPx;

  // Normalize to local 0..1 coords. y is inverted (SVG y=0 is top).
  const x1 = easingOut?.x1 ?? 0;
  const y1 = easingOut?.y1 ?? 0;
  const x2 = easingOut?.x2 ?? 1;
  const y2 = easingOut?.y2 ?? 1;
  const px = (n: number) => n * segmentWidth;
  const py = (n: number) => (1 - n) * ROW_HEIGHT_PX;

  function makeDrag(point: "p1" | "p2") {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const start = { x1, y1, x2, y2 };
      function move(ev: MouseEvent) {
        const dx = (ev.clientX - startX) / segmentWidth;
        const dy = -(ev.clientY - startY) / ROW_HEIGHT_PX;
        const next: BezierEasing = { x1: start.x1, y1: start.y1, x2: start.x2, y2: start.y2 };
        if (point === "p1") {
          next.x1 = clamp(start.x1 + dx, 0, 1);
          next.y1 = clamp(start.y1 + dy, -1, 2);
        } else {
          next.x2 = clamp(start.x2 + dx, 0, 1);
          next.y2 = clamp(start.y2 + dy, -1, 2);
        }
        setBezier(elementId, phase, property as any, fromKeyframeId, next);
      }
      function up() {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      }
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
  }

  return (
    <svg
      data-testid={`bezier-handle-${handleId}`}
      className="absolute top-0 pointer-events-none"
      style={{ left: segmentLeft, width: segmentWidth, height: ROW_HEIGHT_PX }}
      viewBox={`0 0 ${segmentWidth} ${ROW_HEIGHT_PX}`}
    >
      <path
        data-testid={`bezier-curve-${handleId}`}
        d={`M 0 ${ROW_HEIGHT_PX} C ${px(x1)} ${py(y1)} ${px(x2)} ${py(y2)} ${segmentWidth} 0`}
        stroke="#6bcd06"
        strokeWidth={1}
        fill="none"
      />
      <circle
        data-testid={`bezier-handle-${handleId}-p1`}
        cx={px(x1)} cy={py(y1)} r={4}
        fill="#fe036d"
        className="pointer-events-auto cursor-pointer"
        onMouseDown={makeDrag("p1")}
      />
      <circle
        data-testid={`bezier-handle-${handleId}-p2`}
        cx={px(x2)} cy={py(y2)} r={4}
        fill="#fe036d"
        className="pointer-events-auto cursor-pointer"
        onMouseDown={makeDrag("p2")}
      />
    </svg>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
```

- [ ] 3. Run tests + commit:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/timeline/BezierHandle.test.tsx
git add apps/web/src/components/admin/overlay-builder/timeline/BezierHandle.tsx apps/web/src/components/admin/overlay-builder/timeline/BezierHandle.test.tsx
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): cubic-bezier curve handle between keyframes

BezierHandle renders an SVG cubic-bezier path between two adjacent
keyframes, with two draggable control points (P1, P2) at the curve's
shape positions. Default (no easingOut set) renders linear — control
points coincide with endpoints.

Dragging a control point updates the source keyframe's easingOut via
setBezierEasing. x is clamped to [0, 1] (time axis is monotonic in
CSS cubic-bezier); y is clamped to [-1, 2] (CSS allows overshoot for
spring-like curves).

Coordinate frame: local 0..1 x maps to (fromTimeMs..toTimeMs) px
span; local 0..1 y maps to row height with y inverted (SVG y=0 is
top, but bezier convention has y=0 at start so we invert visually).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: EasingPresetDropdown — quick easing presets per keyframe

A select element inside the KeyframeInspector. Options: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `custom`. Picking a named option calls `setBezierEasing` with the canonical bezier values for that curve. Picking `custom` leaves the current `easingOut` in place and lets the user drag the BezierHandle.

**Files:**
- Create: `apps/web/src/components/admin/overlay-builder/timeline/EasingPresetDropdown.tsx`
- Create: `apps/web/src/components/admin/overlay-builder/timeline/EasingPresetDropdown.test.tsx`

#### Steps

- [ ] 1. Tests:

```tsx
describe("EasingPresetDropdown", () => {
  it("renders all 6 options", () => {
    render(<EasingPresetDropdown {...mkProps()} />);
    const select = screen.getByRole("combobox");
    expect(within(select).getAllByRole("option")).toHaveLength(6);
  });

  it("selecting 'ease-out' calls setBezierEasing with (0, 0, 0.58, 1)", () => {
    const setBez = vi.fn();
    renderWithStoreSeed({ actions: { setBezierEasing: setBez } });
    render(<EasingPresetDropdown {...mkProps()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ease-out" } });
    expect(setBez).toHaveBeenCalledWith(
      expect.any(String), "entry", "opacity", "kf-1",
      { x1: 0, y1: 0, x2: 0.58, y2: 1 },
    );
  });

  it("auto-selects 'linear' when easingOut is null", () => {
    render(<EasingPresetDropdown {...mkProps({ easingOut: null })} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("linear");
  });

  it("auto-selects 'custom' when easingOut does not match a named preset", () => {
    render(<EasingPresetDropdown {...mkProps({ easingOut: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 } })} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("custom");
  });
});
```

- [ ] 2. Create `apps/web/src/components/admin/overlay-builder/timeline/EasingPresetDropdown.tsx`:

```tsx
"use client";
import { useBuilderStore } from "@/state/builder/store";
import type { BezierEasing } from "@/server/overlays/builder/types";

const PRESETS: Record<string, BezierEasing | null> = {
  linear: null,
  ease: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
  "ease-in": { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  "ease-out": { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  "ease-in-out": { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
};

function matchPreset(b: BezierEasing | null): string {
  if (!b) return "linear";
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (!preset) continue;
    if (
      Math.abs(preset.x1 - b.x1) < 0.01 &&
      Math.abs(preset.y1 - b.y1) < 0.01 &&
      Math.abs(preset.x2 - b.x2) < 0.01 &&
      Math.abs(preset.y2 - b.y2) < 0.01
    ) return name;
  }
  return "custom";
}

export function EasingPresetDropdown({
  elementId,
  phase,
  property,
  keyframeId,
  easingOut,
}: {
  elementId: string;
  phase: "entry" | "exit" | "loop";
  property: string;
  keyframeId: string;
  easingOut: BezierEasing | null;
}) {
  const setBezier = useBuilderStore((s) => s.setBezierEasing);
  const current = matchPreset(easingOut);

  function onChange(name: string) {
    if (name === "custom") return; // leave current as-is
    setBezier(elementId, phase, property as any, keyframeId, PRESETS[name] ?? null);
  }

  return (
    <select
      className="bg-neutral-900 text-xs rounded px-2 py-1"
      value={current}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="linear">linear</option>
      <option value="ease">ease</option>
      <option value="ease-in">ease-in</option>
      <option value="ease-out">ease-out</option>
      <option value="ease-in-out">ease-in-out</option>
      <option value="custom">custom…</option>
    </select>
  );
}
```

- [ ] 3. Commit:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/timeline/EasingPresetDropdown.test.tsx
git add apps/web/src/components/admin/overlay-builder/timeline/EasingPresetDropdown.tsx apps/web/src/components/admin/overlay-builder/timeline/EasingPresetDropdown.test.tsx
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): easing preset dropdown

EasingPresetDropdown offers 6 quick-select curves: linear / ease /
ease-in / ease-out / ease-in-out / custom. Selecting a named option
writes the canonical bezier control points via setBezierEasing.
Custom leaves easingOut untouched so the BezierHandle drag still
applies.

matchPreset() round-trips the current easingOut back to its name
(0.01 tolerance to avoid drift from drag jitter) so the dropdown
reflects whichever curve the keyframe is currently using.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: KeyframeInspector — right-side panel showing selected keyframe's value + easing

Rendered to the right of the tracks. When `selectedKeyframeId` is set, walks `phase.advancedTimeline` to find the matching keyframe and displays an editable value field (NumericInput for numeric properties, color picker for `color`, plain text input for `filter`) + the EasingPresetDropdown + a Delete button. When no keyframe is selected, shows an empty-state message.

**Files:**
- Create: `apps/web/src/components/admin/overlay-builder/timeline/KeyframeInspector.tsx`
- Create: `apps/web/src/components/admin/overlay-builder/timeline/KeyframeInspector.test.tsx`

#### Steps

- [ ] 1. Tests:

```tsx
describe("KeyframeInspector", () => {
  it("shows empty state when no keyframe selected", () => {
    render(<KeyframeInspector phase="entry" element={mockEl()} />);
    expect(screen.getByText(/select a keyframe/i)).toBeInTheDocument();
  });

  it("shows numeric input for opacity keyframe with current value", () => {
    renderWithStoreSeed({
      selectedKeyframeId: "kf-1",
      elements: { "el-1": withOpacityTrack([{ id: "kf-1", timeMs: 0, value: 0.4, easingOut: null }]) },
    });
    render(<KeyframeInspector phase="entry" element={mockEl()} />);
    expect((screen.getByLabelText(/value/i) as HTMLInputElement).valueAsNumber).toBe(0.4);
  });

  it("changing value calls updateKeyframe", () => {
    const update = vi.fn();
    renderWithStoreSeed({ selectedKeyframeId: "kf-1", actions: { updateKeyframe: update } });
    render(<KeyframeInspector phase="entry" element={mockEl()} />);
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "0.7" } });
    expect(update).toHaveBeenCalledWith("el-1", "entry", "opacity", "kf-1", { value: 0.7 });
  });

  it("shows color picker when property is color", () => {
    renderWithStoreSeed({
      selectedKeyframeId: "kc-1",
      elements: { "el-1": withColorTrack([{ id: "kc-1", timeMs: 0, value: "#fe036d", easingOut: null }]) },
    });
    render(<KeyframeInspector phase="entry" element={mockEl()} />);
    expect(screen.getByLabelText(/color/i)).toHaveAttribute("type", "color");
  });

  it("Delete button calls removeKeyframe and clears selection", () => {
    const remove = vi.fn();
    const select = vi.fn();
    renderWithStoreSeed({ selectedKeyframeId: "kf-1", actions: { removeKeyframe: remove, selectKeyframe: select } });
    render(<KeyframeInspector phase="entry" element={mockEl()} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(remove).toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith(null);
  });
});
```

- [ ] 2. Create `apps/web/src/components/admin/overlay-builder/timeline/KeyframeInspector.tsx`:

```tsx
"use client";
import { useBuilderStore } from "@/state/builder/store";
import { EasingPresetDropdown } from "./EasingPresetDropdown";

export function KeyframeInspector({
  phase,
  element,
}: {
  phase: "entry" | "exit" | "loop";
  element: any;
}) {
  const selectedId = useBuilderStore((s) => s.selectedKeyframeId);
  const updateKeyframe = useBuilderStore((s) => s.updateKeyframe);
  const removeKeyframe = useBuilderStore((s) => s.removeKeyframe);
  const selectKeyframe = useBuilderStore((s) => s.selectKeyframe);

  if (!selectedId) {
    return (
      <div className="p-4 text-xs text-neutral-500">
        Select a keyframe to inspect.
      </div>
    );
  }

  // Find the keyframe + property.
  const tracks = element.animation?.[phase]?.advancedTimeline ?? [];
  let found: { property: string; kf: any } | null = null;
  for (const t of tracks) {
    const kf = t.keyframes.find((k: any) => k.id === selectedId);
    if (kf) { found = { property: t.property, kf }; break; }
  }
  if (!found) {
    return <div className="p-4 text-xs text-neutral-500">Keyframe not found.</div>;
  }
  const { property, kf } = found;

  return (
    <div className="p-3 space-y-3">
      <div className="text-xs uppercase tracking-wide text-neutral-400">
        {property} @ {kf.timeMs}ms
      </div>

      <ValueEditor
        property={property}
        value={kf.value}
        onChange={(v) => updateKeyframe(element.id, phase, property as any, kf.id, { value: v })}
      />

      <div className="space-y-1">
        <label className="text-[10px] uppercase text-neutral-500">Easing out</label>
        <EasingPresetDropdown
          elementId={element.id}
          phase={phase}
          property={property}
          keyframeId={kf.id}
          easingOut={kf.easingOut}
        />
      </div>

      <button
        onClick={() => {
          removeKeyframe(element.id, phase, property as any, kf.id);
          selectKeyframe(null);
        }}
        className="w-full text-xs rounded bg-red-900/40 text-red-200 px-3 py-2"
      >
        Delete keyframe
      </button>
    </div>
  );
}

function ValueEditor({
  property,
  value,
  onChange,
}: {
  property: string;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  if (property === "color") {
    return (
      <label className="block text-xs">
        <span className="text-[10px] uppercase text-neutral-500">Color</span>
        <input
          type="color"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-8 bg-transparent border border-neutral-800 rounded"
          aria-label="color"
        />
      </label>
    );
  }
  if (property === "filter") {
    return (
      <label className="block text-xs">
        <span className="text-[10px] uppercase text-neutral-500">Filter (CSS)</span>
        <input
          type="text"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-neutral-900 rounded px-2 py-1"
          placeholder="blur(4px) brightness(1.2)"
          aria-label="filter"
        />
      </label>
    );
  }
  return (
    <label className="block text-xs">
      <span className="text-[10px] uppercase text-neutral-500">Value</span>
      <input
        type="number"
        step={property === "opacity" ? 0.05 : property.startsWith("scale") ? 0.1 : 1}
        value={Number(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-neutral-900 rounded px-2 py-1"
        aria-label="value"
      />
    </label>
  );
}
```

- [ ] 3. Commit:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/timeline/KeyframeInspector.test.tsx
git add apps/web/src/components/admin/overlay-builder/timeline/KeyframeInspector.tsx apps/web/src/components/admin/overlay-builder/timeline/KeyframeInspector.test.tsx
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): keyframe inspector panel

Right-rail KeyframeInspector reads the currently-selected keyframe
(via selectedKeyframeId in store) and renders a typed value editor
(numeric stepper / color picker / filter string input) plus the
EasingPresetDropdown for segment-out easing plus a Delete button.

Numeric step adapts per property: 0.05 for opacity, 0.1 for scale,
1 for x/y/rotation. Filter input is plain text — sanitization is
the validator's job at save time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Scrub-preview interpolator — pure function for CanvasStage to read values at time T

A pure utility that, given an element + phase + currentTimeMs, returns a merged set of `{ opacity, x, y, scaleX, scaleY, rotation, color, filter }` patch values to apply on top of the element's static transform/style. CanvasStage subscribes to `timelineCursorMs` and re-renders the selected element with these patches. The interpolator handles linear interpolation for numeric properties and falls back to the most-recent keyframe for string properties (matches the compiler's `resolveTrackValueAtMs` behavior).

**Files:**
- Create: `apps/web/src/components/admin/overlay-builder/timeline/scrub-interpolator.ts`
- Create: `apps/web/src/components/admin/overlay-builder/timeline/scrub-interpolator.test.ts`

#### Steps

- [ ] 1. Tests:

```ts
import { describe, expect, it } from "vitest";
import { interpolateAtMs } from "./scrub-interpolator";
import type { AdvancedTimeline } from "@/server/overlays/builder/types";

const TL: AdvancedTimeline = [
  {
    property: "opacity",
    keyframes: [
      { id: "a", timeMs: 0, value: 0, easingOut: null },
      { id: "b", timeMs: 1000, value: 1, easingOut: null },
    ],
  },
  {
    property: "x",
    keyframes: [
      { id: "c", timeMs: 0, value: -120, easingOut: null },
      { id: "d", timeMs: 500, value: 0, easingOut: null },
      { id: "e", timeMs: 1000, value: 60, easingOut: null },
    ],
  },
  {
    property: "color",
    keyframes: [
      { id: "f", timeMs: 0, value: "#000000", easingOut: null },
      { id: "g", timeMs: 1000, value: "#ffffff", easingOut: null },
    ],
  },
];

describe("interpolateAtMs", () => {
  it("returns endpoint values at exact keyframes", () => {
    expect(interpolateAtMs(TL, 0)).toMatchObject({ opacity: 0, x: -120, color: "#000000" });
    expect(interpolateAtMs(TL, 1000)).toMatchObject({ opacity: 1, x: 60, color: "#ffffff" });
  });

  it("linearly interpolates numeric properties between keyframes", () => {
    const r = interpolateAtMs(TL, 250);
    expect(r.opacity).toBeCloseTo(0.25);
    expect(r.x).toBeCloseTo(-60); // halfway from -120 to 0 at 50% of 0-500 segment
  });

  it("uses prior keyframe value for string properties between keyframes", () => {
    expect(interpolateAtMs(TL, 500).color).toBe("#000000");
  });

  it("clamps to phase bounds", () => {
    expect(interpolateAtMs(TL, -100).opacity).toBe(0);
    expect(interpolateAtMs(TL, 99999).opacity).toBe(1);
  });

  it("returns empty object when timeline is empty", () => {
    expect(interpolateAtMs([], 500)).toEqual({});
  });
});
```

- [ ] 2. Create `apps/web/src/components/admin/overlay-builder/timeline/scrub-interpolator.ts`:

```ts
import type { AdvancedTimeline, AdvancedTimelineTrack, Keyframe, TimelineProperty } from "@/server/overlays/builder/types";

export type InterpolatedPatch = Partial<{
  opacity: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  color: string;
  filter: string;
}>;

export function interpolateAtMs(
  timeline: AdvancedTimeline,
  ms: number,
): InterpolatedPatch {
  const out: InterpolatedPatch = {};
  for (const track of timeline) {
    const v = resolveTrackAt(track, ms);
    if (v === undefined) continue;
    (out as any)[track.property] = v;
  }
  return out;
}

function resolveTrackAt(
  track: AdvancedTimelineTrack,
  ms: number,
): number | string | undefined {
  const kfs = track.keyframes;
  if (kfs.length === 0) return undefined;
  // Clamp to bounds.
  if (ms <= kfs[0]!.timeMs) return kfs[0]!.value;
  if (ms >= kfs[kfs.length - 1]!.timeMs) return kfs[kfs.length - 1]!.value;

  // Find bracket.
  let prev: Keyframe = kfs[0]!;
  let next: Keyframe = kfs[kfs.length - 1]!;
  for (let i = 1; i < kfs.length; i++) {
    if (kfs[i]!.timeMs >= ms) {
      prev = kfs[i - 1]!;
      next = kfs[i]!;
      break;
    }
  }
  if (typeof prev.value === "number" && typeof next.value === "number") {
    const t = (ms - prev.timeMs) / (next.timeMs - prev.timeMs);
    return prev.value + (next.value - prev.value) * t;
  }
  return prev.value;
}
```

- [ ] 3. Commit:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/timeline/scrub-interpolator.test.ts
git add apps/web/src/components/admin/overlay-builder/timeline/scrub-interpolator.ts apps/web/src/components/admin/overlay-builder/timeline/scrub-interpolator.test.ts
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): scrub-preview interpolator

interpolateAtMs takes an AdvancedTimeline + a time and returns a patch
of resolved values per animated property. Linear interp for numerics,
last-known-value for strings (color/filter). Out-of-bounds times clamp
to first/last keyframe value.

Pure function with no zustand or DOM dependencies — used by Task 14's
CanvasStage hook AND reused for E2E + visual-regression assertions
(testing that a 50%-progress frame shows interpolated values).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: CanvasStage scrub-preview hook — apply interpolated patch during drag

Wave 1A's CanvasStage at `apps/web/src/components/admin/overlay-builder/CanvasStage.tsx` renders elements from the store. Wave 3B adds a `useScrubPreview(element)` hook that reads `timelineCursorMs[element.id][activePhase]` and `element.animation[activePhase].advancedTimeline`, computes `interpolateAtMs`, and returns the merged transform/style overlay to apply when rendering. The render path branches: if `timelinePanelOpen && phase advanced && cursorMs set`, render with the patch applied; otherwise render the static state.

**Files:**
- Modify: `apps/web/src/components/admin/overlay-builder/CanvasStage.tsx`
- Create: `apps/web/src/components/admin/overlay-builder/timeline/useScrubPreview.ts`
- Create: `apps/web/src/components/admin/overlay-builder/timeline/useScrubPreview.test.ts`

#### Steps

- [ ] 1. Hook tests:

```ts
describe("useScrubPreview", () => {
  it("returns empty patch when timelinePanelOpen is false", () => {
    const { result } = renderHook(() => useScrubPreview("el-1", "entry"), {
      wrapper: makeWrapper({ timelinePanelOpen: false }),
    });
    expect(result.current).toEqual({});
  });

  it("returns interpolated patch when panel open and cursor set", () => {
    const { result } = renderHook(() => useScrubPreview("el-1", "entry"), {
      wrapper: makeWrapper({
        timelinePanelOpen: true,
        timelineCursorMs: { "el-1": { entry: 500 } },
        elements: {
          "el-1": withOpacityTrack([
            { id: "a", timeMs: 0, value: 0, easingOut: null },
            { id: "b", timeMs: 1000, value: 1, easingOut: null },
          ]),
        },
      }),
    });
    expect(result.current.opacity).toBeCloseTo(0.5);
  });
});
```

- [ ] 2. Create `apps/web/src/components/admin/overlay-builder/timeline/useScrubPreview.ts`:

```ts
import { useMemo } from "react";
import { useBuilderStore } from "@/state/builder/store";
import { interpolateAtMs, type InterpolatedPatch } from "./scrub-interpolator";

export function useScrubPreview(
  elementId: string,
  phase: "entry" | "exit" | "loop",
): InterpolatedPatch {
  const panelOpen = useBuilderStore((s) => s.timelinePanelOpen);
  const cursorMs = useBuilderStore((s) => s.timelineCursorMs?.[elementId]?.[phase]);
  const timeline = useBuilderStore(
    (s) => s.elements[elementId]?.animation?.[phase]?.advancedTimeline,
  );
  return useMemo(() => {
    if (!panelOpen || cursorMs === undefined || !timeline) return {};
    return interpolateAtMs(timeline, cursorMs);
  }, [panelOpen, cursorMs, timeline]);
}
```

- [ ] 3. Modify `CanvasStage.tsx` to consume the patch inside the per-element render:

```tsx
function ElementNode({ element, activePhase }: { element: Element; activePhase: "entry" | "exit" | "loop" }) {
  const scrub = useScrubPreview(element.id, activePhase);
  // Merge patch over static transform/style.
  const x = scrub.x !== undefined ? element.transform.x + scrub.x : element.transform.x;
  const y = scrub.y !== undefined ? element.transform.y + scrub.y : element.transform.y;
  const opacity = scrub.opacity ?? element.transform.opacity;
  const scaleX = scrub.scaleX ?? element.transform.scale_x;
  const scaleY = scrub.scaleY ?? element.transform.scale_y;
  const rotation = scrub.rotation ?? element.transform.rotation;
  const color = scrub.color ?? element.style?.color;
  const filter = scrub.filter ?? element.style?.filter;
  // ... pass to <Group x={x} y={y} opacity={opacity} scaleX={scaleX} scaleY={scaleY} rotation={rotation} />
}
```

- [ ] 4. The `activePhase` defaults to `entry` and is sourced from TimelinePanel's local state via a new `activeTimelinePhase` store value (so other components can read it):

```ts
// store.ts
activeTimelinePhase: "entry" as "entry" | "exit" | "loop",
setActiveTimelinePhase(phase: "entry" | "exit" | "loop") {
  set((state) => { state.activeTimelinePhase = phase; });
},
```

- [ ] 5. Update TimelinePanel's `PhaseTabs` to write through:

```tsx
const setPhase = useBuilderStore((s) => s.setActiveTimelinePhase);
const phase = useBuilderStore((s) => s.activeTimelinePhase);
```

- [ ] 6. Commit:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/timeline/useScrubPreview.test.ts
git add apps/web/src/components/admin/overlay-builder/timeline/useScrubPreview.ts apps/web/src/components/admin/overlay-builder/timeline/useScrubPreview.test.ts apps/web/src/components/admin/overlay-builder/CanvasStage.tsx apps/web/src/components/admin/overlay-builder/TimelinePanel.tsx apps/web/src/state/builder/store.ts
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): canvas-stage scrub preview

useScrubPreview hook reads timelineCursorMs + active phase's advanced
timeline, runs interpolateAtMs, and returns the patch. CanvasStage's
per-element node merges the patch over the static transform/style so
dragging the ruler cursor moves the element on the canvas in real
time — operators can see exactly what each keyframe value produces.

Active phase moves from TimelinePanel local state to store
(activeTimelinePhase) so CanvasStage's per-element hook reads the
same value the timeline displays.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Server save path — extend elements CRUD to accept advancedTimeline through save

Wave 1A's `apps/web/src/server/overlays/builder/elements.ts` exports `updateElement(input)` which validates incoming `animation` JSON via `validateAnimation` from Task 8. Now that the validator accepts the advanced shape (Task 2), the save path needs no logic change — but the test surface needs new cases asserting that designs with advanced timelines round-trip correctly through the DB and that the design publish path emits the right `@keyframes` body via the compiler.

**Files:**
- Modify: `apps/web/src/server/overlays/builder/elements.test.ts`
- Modify: `apps/web/src/server/overlays/builder/designs.test.ts`

#### Steps

- [ ] 1. Append to `elements.test.ts`:

```ts
describe("updateElement — Wave 3B advanced timeline", () => {
  it("persists an advancedTimeline payload on the animation column", async () => {
    const sb = makeMockSupabase();
    const result = await updateElement(sb, {
      id: "el-1",
      animation: {
        entry: {
          type: "noop",
          durationMs: 1000,
          delayMs: 0,
          easing: "linear",
          advancedTimeline: [
            {
              property: "opacity",
              keyframes: [
                { id: "k1", timeMs: 0, value: 0, easingOut: null },
                { id: "k2", timeMs: 1000, value: 1, easingOut: null },
              ],
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(sb.from).toHaveBeenCalledWith("overlay_user_design_elements");
    const updatePayload = sb._lastUpdatePayload();
    expect(updatePayload.animation.entry.advancedTimeline).toHaveLength(1);
  });

  it("rejects invalid advancedTimeline via the validator", async () => {
    const sb = makeMockSupabase();
    const result = await updateElement(sb, {
      id: "el-2",
      animation: {
        entry: {
          type: "slide-left", // mutual-exclusivity violation
          durationMs: 600,
          delayMs: 0,
          easing: "ease-out",
          advancedTimeline: [
            {
              property: "opacity",
              keyframes: [
                { id: "k1", timeMs: 0, value: 0, easingOut: null },
                { id: "k2", timeMs: 600, value: 1, easingOut: null },
              ],
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("|")).toMatch(/mutual|exclusive/i);
  });
});
```

- [ ] 2. Append to `designs.test.ts`:

```ts
describe("publishDesign — Wave 3B advanced timeline", () => {
  it("compiles design with advanced timeline and writes the published HTML row", async () => {
    const sb = makeMockSupabase();
    const designId = await seedDesign(sb, designWithAdvancedTimeline);
    const result = await publishDesign(sb, designId);
    expect(result.ok).toBe(true);
    // overlay_template_variants row's html_path should still point at
    // /overlay/v2/user/<slug> — published HTML is rendered on request,
    // not precomputed. Compiler is exercised at request time.
    const variant = sb._lastUpsertRow("overlay_template_variants");
    expect(variant.html_path).toBe("/overlay/v2/user/fx-advanced-timeline");
    expect(variant.kind).toBe("dynamic");
  });
});
```

- [ ] 3. Run tests + commit:

```bash
npx vitest run apps/web/src/server/overlays/builder/elements.test.ts apps/web/src/server/overlays/builder/designs.test.ts
git add apps/web/src/server/overlays/builder/elements.test.ts apps/web/src/server/overlays/builder/designs.test.ts
git commit -m "$(cat <<'EOF'
test(overlay-builder/wave-3b): server save + publish round-trip with advanced timeline

Asserts updateElement persists advancedTimeline on the animation jsonb
column and the validator rejects mutual-exclusivity violations at the
server boundary (additional defense beyond client-side guards).

publishDesign test confirms the overlay_template_variants row stays
kind='dynamic' pointing at /overlay/v2/user/<slug> — the compiler is
exercised at request time, not at publish, so advancedTimeline can be
edited and re-saved without re-publishing.

No production code changed — these tests cover the existing Wave 1A
save path now that the Task 2 validator accepts the advanced shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Library page — surface "Animations: advanced" badge on cards with advanced timelines

Tiny UX touch so the library makes the advanced-mode designs discoverable. The library card at `/admin/broadcast/v2/builder` shows status + last-edited; Wave 3B adds a small pink "ADV" pill in the corner of the thumbnail when any element in the design has at least one phase with a non-empty advancedTimeline.

**Files:**
- Modify: `apps/web/src/app/admin/broadcast/v2/builder/page.tsx`
- Modify: `apps/web/src/components/admin/overlay-builder/DesignCard.tsx`
- Modify: `apps/web/src/components/admin/overlay-builder/DesignCard.test.tsx`

#### Steps

- [ ] 1. Add a helper:

```ts
// apps/web/src/components/admin/overlay-builder/has-advanced-timeline.ts
import type { Design } from "@/server/overlays/builder/types";
export function hasAdvancedTimeline(design: Design): boolean {
  for (const scene of design.scenes) {
    for (const el of scene.elements) {
      for (const phase of ["entry", "exit", "loop"] as const) {
        if ((el.animation?.[phase]?.advancedTimeline?.length ?? 0) > 0) return true;
      }
    }
  }
  return false;
}
```

- [ ] 2. Tests:

```tsx
describe("DesignCard — ADV pill", () => {
  it("renders ADV pill when design has any advanced timeline", () => {
    render(<DesignCard design={designWithAdvancedTimeline} />);
    expect(screen.getByText(/ADV/i)).toBeInTheDocument();
  });
  it("hides ADV pill when no element has advancedTimeline", () => {
    render(<DesignCard design={designRectTextImage} />);
    expect(screen.queryByText(/ADV/i)).toBeNull();
  });
});
```

- [ ] 3. Update `DesignCard.tsx`:

```tsx
import { hasAdvancedTimeline } from "./has-advanced-timeline";
// ... inside component
{hasAdvancedTimeline(design) && (
  <span className="absolute top-2 right-2 bg-[#fe036d] text-black text-[10px] font-bold rounded px-1.5 py-0.5">
    ADV
  </span>
)}
```

- [ ] 4. Commit:

```bash
npx vitest run apps/web/src/components/admin/overlay-builder/DesignCard.test.tsx
git add apps/web/src/components/admin/overlay-builder/DesignCard.tsx apps/web/src/components/admin/overlay-builder/DesignCard.test.tsx apps/web/src/components/admin/overlay-builder/has-advanced-timeline.ts
git commit -m "$(cat <<'EOF'
feat(overlay-builder/wave-3b): ADV pill on design library cards

DesignCard surfaces a pink ADV pill in the top-right corner of the
thumbnail when any element in the design has a non-empty
advancedTimeline on entry / exit / loop. Designers + operators can
scan the library at a glance and know which designs use advanced
keyframe authoring vs preset animations.

hasAdvancedTimeline is a pure helper exported standalone so future
analytics / filtering can reuse it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: One-shot server-pipeline smoke for advanced timeline

Mirrors Wave 1A's `_wave-1a-server-smoke.mjs` pattern (operator-invoked Node script). Reads `designWithAdvancedTimeline` fixture, runs it through `compileDesignToHtml`, asserts the output:
1. Contains the `@keyframes builder-<elementId>-entry` block.
2. Contains 0% / 50% / 100% percent rules.
3. Contains `cubic-bezier(0.4, 0, 0.6, 1)` on the x track's first segment.
4. Satisfies the §14 contract (color-scheme dark, opacity gates, observer script).
5. Is below 200 KB total size.

**Files:**
- Create: `apps/web/scripts/_wave-3b-server-smoke.mjs`

#### Steps

- [ ] 1. Create the smoke script:

```js
#!/usr/bin/env node
// Wave 3B server-pipeline smoke — exits non-zero on any check() failure.
// One-shot. Delete after run (matches Wave 1A convention).
import { compileDesignToHtml } from "../src/server/overlays/builder/compiler.ts";
import { designWithAdvancedTimeline } from "../src/server/overlays/builder/fixtures/design-with-advanced-timeline.ts";

let failed = 0;
function check(name, pass, detail = "") {
  if (pass) {
    console.log(`OK   ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const html = compileDesignToHtml(designWithAdvancedTimeline, 0);

check("contains @keyframes builder-<id>-entry",
  /@keyframes\s+builder-00000000-0000-0000-0000-000000003100-entry/.test(html));
check("emits 0% rule with opacity:0", /0%\s*\{[^}]*opacity:\s*0\b/.test(html));
check("emits 50% rule with opacity:1", /50%\s*\{[^}]*opacity:\s*1\b/.test(html));
check("emits 100% rule with opacity:0.4", /100%\s*\{[^}]*opacity:\s*0\.4\b/.test(html));
check("emits cubic-bezier(0.4, 0, 0.6, 1)",
  /animation-timing-function:\s*cubic-bezier\(0\.4,\s*0,\s*0\.6,\s*1\)/.test(html));
check("satisfies §14 color-scheme meta", /name="color-scheme"\s+content="dark"/.test(html));
check("satisfies §14 transparent body", /background:\s*transparent\s*!important/.test(html));
check("satisfies §14 observer script", /cade-visible-gate-observer-v2/.test(html));
check("satisfies §14 demo guard", /\?demo=1/.test(html));
check("output below 200KB", Buffer.byteLength(html, "utf8") < 200_000,
  `actual ${Buffer.byteLength(html, "utf8")} bytes`);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nWave 3B server smoke OK");
```

- [ ] 2. Run the smoke + commit:

```bash
node --experimental-strip-types apps/web/scripts/_wave-3b-server-smoke.mjs
git add apps/web/scripts/_wave-3b-server-smoke.mjs
git commit -m "$(cat <<'EOF'
test(overlay-builder/wave-3b): server-pipeline smoke for advanced timeline

One-shot Node script (mirrors Wave 1A's _wave-1a-server-smoke pattern).
Compiles the designWithAdvancedTimeline fixture and asserts:
  - @keyframes builder-<id>-entry present
  - 0% / 50% / 100% rules with expected opacity values
  - cubic-bezier(0.4, 0, 0.6, 1) on the bezier-easing segment
  - §14 contract pieces (color-scheme dark, transparent body,
    observer, demo guard) all present
  - output below 200KB

Exits non-zero on any check failure. Operator-invoked — not in the
Vitest suite. Delete after run per script convention.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: E2E spec — full author flow for advanced timeline

End-to-end Playwright spec that drives the full Wave 3B flow:
1. Login admin.
2. Open builder, click New Design, create "Wave 3B E2E".
3. Drop a text element on the canvas.
4. Click Animation tab → toggle entry to Advanced.
5. Click Open Timeline → bottom panel appears.
6. Add a keyframe at 500ms with opacity 0.5 by clicking the opacity track.
7. Open EasingPresetDropdown on the first keyframe, select `ease-out`.
8. Save the design.
9. Publish the design.
10. Fetch `/overlay/v2/user/wave-3b-e2e?demo=1` via the page's same context.
11. Assert the response HTML contains `@keyframes builder-<elementId>-entry` and a `cubic-bezier(0, 0, 0.58, 1)` declaration (ease-out's canonical curve).
12. Drive the scrub cursor in the panel to 250ms and assert the canvas element node opacity becomes ~0.25 (interpolated from 0 at 0ms to 0.5 at 500ms).

**Files:**
- Create: `apps/web/tests/e2e/overlay-builder-wave-3b.spec.ts`

#### Steps

- [ ] 1. Create the spec:

```ts
import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe("Overlay Builder Wave 3B — advanced timeline E2E", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("create design with advanced opacity keyframes + ease-out + scrub preview", async ({ page }) => {
    await page.goto("/admin/broadcast/v2/builder");

    await page.getByRole("button", { name: /new design/i }).click();
    await page.getByLabel(/title/i).fill("Wave 3B E2E");
    await page.getByLabel(/mode/i).selectOption("single");
    await page.getByRole("button", { name: /create/i }).click();

    // Drop a text element.
    await page.getByRole("button", { name: /add text/i }).click();
    await page.locator("[data-testid=canvas-stage]").click({ position: { x: 400, y: 300 } });

    // Animation tab + advanced toggle.
    await page.getByRole("tab", { name: /animation/i }).click();
    const entryGroup = page.getByTestId("anim-phase-entry");
    await entryGroup.getByRole("button", { name: /advanced/i }).click();

    // Open timeline.
    await page.getByRole("button", { name: /open timeline/i }).click();
    await expect(page.getByTestId("timeline-panel")).toBeVisible();

    // Add keyframe at 500ms on opacity by clicking the row's clickarea
    // at the calculated x for 500ms.
    const clickArea = page.getByTestId("track-row-opacity-clickarea");
    const box = await clickArea.boundingBox();
    expect(box).not.toBeNull();
    const midX = box!.x + box!.width / 2;
    await page.mouse.click(midX, box!.y + box!.height / 2);

    // Select the new keyframe (the second one in the opacity track) and
    // set easing to ease-out via the dropdown.
    const inspector = page.getByTestId("timeline-panel");
    const valueInput = inspector.getByLabel(/value/i);
    await valueInput.fill("0.5");

    const easingDropdown = inspector.getByRole("combobox");
    await easingDropdown.selectOption("ease-out");

    // Save + publish.
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/saved/i)).toBeVisible();
    await page.getByRole("button", { name: /^publish$/i }).click();
    await expect(page.getByText(/published/i)).toBeVisible();

    // Fetch the rendered overlay and assert keyframes block + ease-out
    // bezier are present.
    const slug = "wave-3b-e2e";
    const resp = await page.request.get(`/overlay/v2/user/${slug}?demo=1`);
    expect(resp.status()).toBe(200);
    const html = await resp.text();
    expect(html).toMatch(/@keyframes\s+builder-[^{]+-entry/);
    // ease-out canonical: cubic-bezier(0, 0, 0.58, 1)
    expect(html).toMatch(/cubic-bezier\(0,\s*0,\s*0\.58,\s*1\)/);

    // Scrub the cursor to 250ms and assert canvas element opacity is
    // ~0.25 (linear interp from 0 at 0ms to 0.5 at 500ms).
    const ruler = page.getByTestId("ruler-track");
    const rulerBox = await ruler.boundingBox();
    expect(rulerBox).not.toBeNull();
    // 250ms / 1000ms (default duration after advanced mode toggle) * width
    const targetX = rulerBox!.x + rulerBox!.width * 0.25;
    await page.mouse.click(targetX, rulerBox!.y + rulerBox!.height / 2);

    const canvasNode = page.locator("[data-canvas-element-opacity]").first();
    const opacityAttr = await canvasNode.getAttribute("data-canvas-element-opacity");
    expect(Number(opacityAttr)).toBeGreaterThan(0.2);
    expect(Number(opacityAttr)).toBeLessThan(0.32);
  });
});
```

- [ ] 2. Run + commit:

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-3b.spec.ts
git add apps/web/tests/e2e/overlay-builder-wave-3b.spec.ts
git commit -m "$(cat <<'EOF'
test(overlay-builder/wave-3b): E2E covers create -> save -> publish -> scrub

Playwright spec drives the full Wave 3B user flow:
  1. Create design in builder
  2. Drop text element
  3. Toggle entry to Advanced mode
  4. Open bottom timeline panel
  5. Add a 500ms opacity-0.5 keyframe by clicking opacity track
  6. Set ease-out via the easing dropdown
  7. Save + Publish
  8. Fetch /overlay/v2/user/<slug>?demo=1 and assert @keyframes +
     cubic-bezier(0, 0, 0.58, 1) (ease-out canonical) in the HTML
  9. Scrub the ruler cursor to 250ms and assert the canvas element
     opacity is ~0.25 (linear interp at 50% of the 0->500ms segment)

CanvasStage exposes data-canvas-element-opacity on its element nodes
specifically so this spec can assert the scrub-preview interpolator
is wired to the live canvas (not just the compiled HTML).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Visual regression baseline — mid-animation frame at 50% timeline

Extend the visual-regression suite with one new baseline that captures a published Wave 3B design AT a specific mid-animation moment. Pattern: a seeded design with a 1000ms entry containing opacity 0→1 + scaleX 0.8→1 advanced track, rendered at `/overlay/v2/user/wave-3b-vr-baseline?demo=1`. The spec issues `show` via postMessage AND injects a `__cade_force_anim_progress__=0.5` window flag that the bootstrap reads (added in Task 14 of compiler if not already present — otherwise behind a `?animProgress=0.5` query param the route forwards to the bootstrap).

**Files:**
- Create: `apps/web/tests/e2e/overlay-builder-wave-3b-vr.spec.ts`
- Create: `apps/web/tests/e2e/fixtures/wave-3b-vr-baseline.json` (seeded design payload)
- Modify: `apps/web/src/app/(overlay)/overlay/v2/user/[slug]/route.ts` (forward `?animProgress=` into the bootstrap script so the visual-regression spec can capture a deterministic mid-animation frame)

#### Steps

- [ ] 1. Add `?animProgress=<0..1>` support to the runtime route. In the route handler, parse the query param and inject a `<script>window.__cadeForceAnimProgress = <value>;</script>` BEFORE the bootstrap. The bootstrap reads it and on `show`, sets per-animation `animation-play-state: paused` + `animation-delay: -<durationMs * progress>ms` to lock every element at that progress fraction.

```ts
// route.ts
const animProgress = parseFloat(url.searchParams.get("animProgress") ?? "");
const forceProgressInject = Number.isFinite(animProgress) && animProgress >= 0 && animProgress <= 1
  ? `<script>window.__cadeForceAnimProgress = ${animProgress};</script>`
  : "";
// ... insert forceProgressInject after </head> and before <body>'s bootstrap
```

- [ ] 2. Update the bootstrap template in `bootstrap-template.ts` to honor `window.__cadeForceAnimProgress`:

```js
function applyForceAnimProgress() {
  const v = (window).__cadeForceAnimProgress;
  if (typeof v !== "number") return;
  document.querySelectorAll("[data-element-id]").forEach((node) => {
    const style = window.getComputedStyle(node);
    const dur = parseFloat(style.animationDuration || "0");
    if (!dur) return;
    node.style.animationDelay = `-${dur * v}s`;
    node.style.animationPlayState = "paused";
  });
}
// Call after `body.cade-visible` is added in the show handler.
```

- [ ] 3. Create the seeded design payload `apps/web/tests/e2e/fixtures/wave-3b-vr-baseline.json` (representing the same shape as `designWithAdvancedTimeline` but with both opacity AND scaleX tracks for visual richness).

- [ ] 4. Create the VR spec `apps/web/tests/e2e/overlay-builder-wave-3b-vr.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { seedDesignFromFixture } from "./helpers/seed";

test("Wave 3B VR baseline — mid-animation frame at 50%", async ({ page }) => {
  await seedDesignFromFixture("wave-3b-vr-baseline");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/overlay/v2/user/wave-3b-vr-baseline?demo=1&animProgress=0.5");

  // Wait for the body.cade-visible class to land + the bootstrap to
  // freeze the animation at progress 0.5.
  await page.waitForFunction(() => document.body.classList.contains("cade-visible"));
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("[data-element-id]")).every(
      (n) => (n as HTMLElement).style.animationPlayState === "paused",
    ),
  );

  // 100ms settle for any final paint.
  await page.waitForTimeout(100);

  await expect(page).toHaveScreenshot("wave-3b-mid-anim.png", {
    maxDiffPixelRatio: 0.001,
  });
});
```

- [ ] 5. Generate the baseline once + commit:

```bash
npm --workspace apps/web run e2e -- overlay-builder-wave-3b-vr.spec.ts --update-snapshots
npm --workspace apps/web run e2e -- overlay-builder-wave-3b-vr.spec.ts
git add apps/web/tests/e2e/overlay-builder-wave-3b-vr.spec.ts apps/web/tests/e2e/fixtures/wave-3b-vr-baseline.json apps/web/tests/e2e/overlay-builder-wave-3b-vr.spec.ts-snapshots apps/web/src/app/(overlay)/overlay/v2/user/[slug]/route.ts apps/web/src/server/overlays/builder/bootstrap-template.ts
git commit -m "$(cat <<'EOF'
test(overlay-builder/wave-3b): visual regression baseline at 50% progress

Adds a Wave 3B VR baseline that pauses every per-element animation
at exactly progress 0.5 so Playwright can capture a deterministic
mid-animation screenshot. <0.1% pixel-diff tolerance.

Mechanism: ?animProgress=0.5 query param threads through to a
__cadeForceAnimProgress window value the bootstrap reads on show,
setting animation-delay: -durationMs*0.5 and animation-play-state:
paused on every [data-element-id] node. Works for both preset and
advanced @keyframes because CSS handles both identically.

Fixture wave-3b-vr-baseline.json has opacity 0->1 + scaleX 0.8->1
tracks over 1000ms entry — visually rich enough to catch regression.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Full verification gate + commit + push

Final gate before declaring Wave 3B complete. Mirrors Wave 1A Task 32 and the acceptance discipline in CLAUDE.md §§4, 11, 12.

**Files:**
- Modify: `tasks/todo.md` (append Wave 3B review section)
- Modify: `tasks/lessons.md` (capture any lessons from this verification pass)
- Modify: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md` (Status section — mark Wave 3B SHIPPED)
- Modify: `C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\MEMORY.md` (RESUME line — link to Wave 3B project memory)

#### Steps

- [ ] 1. Unit tests:

```bash
npm --workspace apps/web run test
```

Expected: 0 failures. The ~30 new tests across types / animation-validator / compiler / store / TimelinePanel / TimelineRuler / KeyframeNode / TimelineTracks / BezierHandle / EasingPresetDropdown / KeyframeInspector / scrub-interpolator / useScrubPreview / elements / designs / DesignCard all green AND every Wave 1A + Wave 1B + Wave 2 + Wave 3A test still passes.

- [ ] 2. Lint:

```bash
npm --workspace apps/web run lint
```

Expected: 0 errors. New warnings must not regress baseline.

- [ ] 3. Build:

```bash
npm --workspace apps/web run build
```

Expected: clean production build. `prebuild` `sync:overlays` + `check:element-id-parity` both pass.

- [ ] 4. E2E:

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-3b.spec.ts
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e
```

Expected: Wave 3B spec passes + every existing spec still passes. Watch for regressions in: `overlay-builder-wave-1a.spec.ts`, `overlay-builder-wave-1b.spec.ts`, `overlay-builder-wave-3a.spec.ts` (sequence transitions interact with new animation phases).

- [ ] 5. Visual regression:

```bash
NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true npm --workspace apps/web run e2e -- overlay-builder-wave-3b-vr.spec.ts
npm --workspace apps/web run e2e:visual-regression
```

Expected: Wave 3B mid-animation baseline passes (<0.1% pixel diff) + all 16 built-in overlay baselines unchanged + Wave 1A/1B/3A baselines unchanged. Wave 3B work MUST NOT alter rendering of any other surface.

- [ ] 6. Manual Chrome browser end-to-end per CLAUDE.md §11. Drive the full advanced-timeline flow via Claude-in-Chrome:

   1. Set `NEXT_PUBLIC_OVERLAY_BUILDER_ENABLED=true` in `apps/web/.env.local`.
   2. Start dev server: `npx next dev -p 3030`.
   3. Load Claude-in-Chrome tools via `ToolSearch select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input` and:
      1. Navigate to `http://localhost:3030/login`, login as `admin@cade.local` / `dev-admin-2026`.
      2. Navigate to `/admin/broadcast/v2/builder`. Confirm library loads, no console errors.
      3. Click **New Design** → title "Chrome Smoke Wave 3B" mode single → submit.
      4. Drop one text element on the canvas, type "TIMELINE".
      5. Animation tab → entry → toggle Advanced. Click **Open Timeline**.
      6. Confirm bottom panel appears with ruler + 8 property rows + opacity track seeded with 2 keyframes.
      7. Click opacity track at the midpoint to add a 3rd keyframe; click on it to select; set value 0.5 in inspector; pick easing `ease-out`.
      8. Drag the ruler cursor across — confirm the TIMELINE text on the canvas above changes opacity smoothly in real time.
      9. Click **Save** → confirm `data-dirty="false"`.
      10. Click **Publish** → status badge flips to **Published**.
      11. Open `http://localhost:3030/overlay/v2/user/chrome-smoke-wave-3b?demo=1` in a new tab. Watch the entry animation play — should fade in to opacity 0.5 then up to 1.0 over the phase duration.
      12. Run `read_console_messages` against that tab → assert zero red errors.
      13. Navigate to `/admin/broadcast/v2` → pick the most-recent session → confirm Custom Designs section shows the new design with an **ADV** pill on its card → click **Trigger** → confirm the OBS-source iframe receives `show` and the entry animation fires.

If any step shows red errors or visible glitches, STOP. Fix root cause. Re-run from Step 1.

- [ ] 7. Post-push platform-wide route verification per CLAUDE.md §12. Build the route-by-route status table:

| Route | Expected | Actual | Notes |
|---|---|---|---|
| `GET /` | 200 | | public landing |
| `GET /login` | 200 | | login form |
| `GET /standings` | 200 | | public standings |
| `GET /fixtures` | 200 | | public fixtures |
| `GET /admin` | 307 / 200 | | gate |
| `GET /admin/broadcast/v2` | 307 / 200 | | broadcast hub |
| `GET /admin/broadcast/v2/builder` (flag ON) | 307 / 200 | | unchanged surface |
| `GET /admin/broadcast/v2/builder/<seeded-slug>/edit` | 200 | | timeline panel mounts here |
| `GET /overlay/v2/04-h2h-2?demo=1` | 200 | | built-in unchanged |
| `GET /overlay/v2/07-leaderboard?demo=1` | 200 | | built-in unchanged |
| `GET /overlay/v2/11-match-scores-day?demo=1` | 200 | | built-in unchanged |
| `GET /overlay/v2/user/<wave-3b-seed>?demo=1` | 200 | | renders @keyframes |
| `GET /overlay/v2/user/<wave-3b-seed>?demo=1&animProgress=0.5` | 200 | | freezes at 50% progress |
| `GET /overlay/v2/user/does-not-exist-xyz?demo=1` | 404 | | not-found behavior |

Capture in post-push report. If any actual ≠ expected, STOP, diagnose, fix, restart from Step 1.

- [ ] 8. Push to origin/main:

```bash
git status
git push origin main
```

Monitor Vercel deploy until **Ready**. After green, re-run Step 7's curl table against the live URL. If anything fails on prod that passed locally, diagnose via Vercel logs and push the fix.

- [ ] 9. Update memory files per CLAUDE.md "feedback_always_document_resume_state" and "feedback_auto_memory_update":
   - Append a new "Wave 3B SHIPPED" line to MEMORY.md with date + commit SHA + key files touched.
   - Update `project_overlay_builder_2026_05_17.md` Status section: `Wave 3B SHIPPED 2026-05-DD — advanced keyframe timeline editor live, all gates green, manual Chrome verification confirmed`.

- [ ] 10. Append a Wave 3B review section to `tasks/todo.md`:

```md
## Wave 3B — Advanced keyframe timeline (SHIPPED 2026-05-DD)

Delivered:
- Per-element advanced timeline: 8 animatable properties (opacity, x, y, scaleX, scaleY, rotation, color, filter)
- Per-keyframe cubic-bezier easing with 5 named presets + custom drag handles
- After-Effects-style bottom-panel UI with ruler, scrub cursor, per-property tracks, BezierHandle SVG curves, KeyframeInspector
- Mutual exclusivity guard (preset xor advanced per phase) at validator + zustand layers
- Compiler converts advancedTimeline -> @keyframes <name> { 0% {...} 50% {...} 100% {...} } with merged-transform percent rules and per-segment animation-timing-function
- Scrub-preview: drag the ruler cursor and the canvas element re-renders with interpolated values in real time
- ADV pill on library cards surfaces designs using advanced animations
- VR baseline at 50% animation progress + E2E covering create -> scrub -> save -> publish -> fetch HTML

Verification: unit + lint + build + e2e + VR + manual Chrome + post-push route table all green. No regressions in Wave 1A/1B/2/3A surfaces.
```

- [ ] 11. Final commit + push:

```bash
git add tasks/todo.md tasks/lessons.md "C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\project_overlay_builder_2026_05_17.md" "C:\Users\Sweez\.claude\projects\C--Users-Sweez-Desktop-LAYO-CLAUDE-GAMEEVO-ESOCCER\memory\MEMORY.md"
git commit -m "$(cat <<'EOF'
chore(overlay-builder/wave-3b): mark wave complete + memory + tasks update

Wave 3B SHIPPED — advanced keyframe timeline editor live.

All gates green:
  - npm run test          : 0 failures (~30 new tests Wave 3B + Wave 1A/1B/2/3A unchanged)
  - npm run lint          : clean
  - npm run build         : clean
  - npm run e2e           : every spec green, Wave 3B + existing
  - npm run e2e:visual-regression : 16 built-in baselines unchanged + Wave 3B mid-anim baseline holds
  - Manual Chrome §11     : end-to-end advanced flow verified
  - Post-push §12 table   : every route returns expected status

Memory updated: project_overlay_builder_2026_05_17.md status flipped to
SHIPPED, MEMORY.md RESUME line added.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Wave 3B — Self-Review

### (A) Spec coverage

Spec §8 + §11 acceptance pieces mapped to tasks:

| Spec piece | Task(s) |
|---|---|
| Per-element track with keyframes per property | 4, 9 |
| Bezier easing handle between keyframes | 10, 11 |
| Bottom-panel UI in CanvasEditorShell (Timeline button toggle) | 5, 6 |
| `element.animation.advancedTimeline` storage shape | 1, 15 |
| Preset and advanced mutually exclusive per (element, phase) | 2, 4 |
| Compiler emits @keyframes from advancedTimeline | 3, 17 |
| Add Keyframe action (click track at time T) | 9 |
| Delete Keyframe (select + Delete key) | 8 |
| Multi-track per element (8 properties) | 9, 13 |
| Scrub preview drives canvas | 13, 14 |
| Save / publish round-trip | 15 |
| E2E spec | 18 |
| VR baseline for advanced animation | 19 |
| Verification gate + push | 20 |

20 / 20 spec asks covered. No omitted scope.

### (B) Placeholder scan

No `TODO` / `FIXME` / `...` placeholders left in task bodies. Every code block compiles standalone modulo Wave 1A imports.

### (C) Type consistency

- `KeyframeSchema.value` is `z.union([z.number(), z.string()])` — validator branches on property to enforce numeric-vs-string. Same shape used by zustand, server, compiler, scrub-interpolator, inspector.
- `BezierEasing` uniform across compiler / handle / dropdown / inspector / store (4 numbers x1/y1/x2/y2).
- `TimelineProperty` union (8 values) consistent across types / validator / compiler / tracks / interpolator / DEFAULT_VALUE_FOR.

### (D) File-path consistency

Server: `apps/web/src/server/overlays/builder/`
Client: `apps/web/src/components/admin/overlay-builder/` and `apps/web/src/components/admin/overlay-builder/timeline/` (new Wave 3B subdir)
State: `apps/web/src/state/builder/`
Routes: `apps/web/src/app/admin/broadcast/v2/builder/...` and `apps/web/src/app/(overlay)/overlay/v2/user/[slug]/route.ts`
Tests: co-located unit tests + `apps/web/tests/e2e/overlay-builder-wave-3b*.spec.ts`

No conflict with Wave 1A / 1B / 2 / 3A paths.

### (E) Migration sequencing

No DB migrations required. Wave 1A's `overlay_user_design_elements.animation` jsonb column accepts the extended payload as-is (Zod parse on server, no schema change). Mutual-exclusivity is enforced in app code, not by DB constraint.

### (F) Commit message format

All 20 task commits use the HEREDOC pattern with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer on the final body line.

### (G) TDD ordering

Every task with code follows: failing-test author → run-and-show-FAIL → minimal implementation → run-and-show-PASS → commit.

Exempt tasks:
- **Task 17 (smoke):** one-shot Node script; gate is `check()` assertion exit code, not Vitest.
- **Task 19 (VR baseline):** baseline is generated once via `--update-snapshots`, then locked.
- **Task 20 (verification gate):** final acceptance gate runs full suites; not a unit-test cycle.

All other tasks (1-16, 18) document explicit failing-test → impl → passing-test cycles.

### Self-Review Summary

| Check | Found | Fixed | Notes |
|---|---|---|---|
| (A) Spec coverage | 20 spec pieces mapped to 20 tasks | 0 missing | Complete |
| (B) Placeholder scan | 0 issues | 0 | Implementation-complete |
| (C) Type consistency | Schemas unified across server/client/state | 0 | Single source via types.ts |
| (D) File-path consistency | No path conflict with prior waves | 0 | New `timeline/` subdir cleanly separated |
| (E) Migration sequencing | 0 migrations | n/a | Extends existing jsonb shape |
| (F) Commit message format | 20 commits — all HEREDOC + trailer | 0 | Compliant |
| (G) TDD ordering | 3 legitimate exemptions (smoke / VR / gate) | 0 | Documented |





