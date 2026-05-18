/**
 * Overlay Builder — shared types + runtime schemas.
 *
 * All CRUD functions, validators, compiler stages, and the runtime
 * route import from here. Each Zod schema is paired with a `z.infer`
 * type alias so the wire shape stays unified — there is no separate
 * hand-rolled interface drifting from runtime validation.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §3
 */

import { z } from "zod";

// ────────────── ElementType ──────────────
//
// Wave 1A only implements rect / text / image / data-slot at the
// runtime layer, but the union accepts every shape so later waves can
// land schema migrations without churn here.
export const ElementTypeSchema = z.enum([
  "rect",
  "ellipse",
  "line",
  "polygon",
  "path",
  "text",
  "image",
  "psd-layer",
  "data-slot",
  "group",
]);
export type ElementType = z.infer<typeof ElementTypeSchema>;

// ────────────── Transform ──────────────
export const TransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  opacity: z.number(),
});
export type Transform = z.infer<typeof TransformSchema>;

// ────────────── ShadowSpec ──────────────
export const ShadowSpecSchema = z.object({
  offsetX: z.number(),
  offsetY: z.number(),
  blur: z.number(),
  color: z.string(),
  opacity: z.number(),
});
export type ShadowSpec = z.infer<typeof ShadowSpecSchema>;

// ────────── Wave 1B — GradientStop / Gradient ──────────
//
// Gradients fill rect / ellipse / text via CSS `linear-gradient` or
// `radial-gradient`. Each gradient has ≥2 stops. The discriminator
// `kind` lets the compiler emit the right CSS function.
export const GradientStopSchema = z.object({
  offset: z.number().min(0).max(1),
  color: z.string(),
});
export type GradientStop = z.infer<typeof GradientStopSchema>;

export const LinearGradientSchema = z.object({
  kind: z.literal("linear"),
  angle: z.number().min(0).max(360),
  stops: z.array(GradientStopSchema).min(2),
});
export type LinearGradient = z.infer<typeof LinearGradientSchema>;

export const RadialGradientSchema = z.object({
  kind: z.literal("radial"),
  cx: z.number().min(0).max(1),
  cy: z.number().min(0).max(1),
  radius: z.number().min(0).max(1),
  stops: z.array(GradientStopSchema).min(2),
});
export type RadialGradient = z.infer<typeof RadialGradientSchema>;

export const GradientSpecSchema = z.discriminatedUnion("kind", [
  LinearGradientSchema,
  RadialGradientSchema,
]);
export type GradientSpec = z.infer<typeof GradientSpecSchema>;

// ────────── Wave 1B — FilterSpec ──────────
//
// Maps to CSS `filter: blur(...) brightness(...) hue-rotate(...) saturate(...)`.
// All keys optional — admin enables only what they need.
//   - blur in px, capped at 40 (anything larger is performance death).
//   - brightness as multiplier, 0..2 (0 = black, 1 = identity, 2 = double).
//   - hueRotate in degrees, 0..360.
//   - saturate as multiplier, 0..2 (0 = grayscale, 1 = identity).
export const FilterSpecSchema = z.object({
  blur: z.number().min(0).max(40).optional(),
  brightness: z.number().min(0).max(2).optional(),
  hueRotate: z.number().min(0).max(360).optional(),
  saturate: z.number().min(0).max(2).optional(),
});
export type FilterSpec = z.infer<typeof FilterSpecSchema>;

// ────────── Wave 1B — ShadowStack ──────────
//
// Wave 1A accepted a single `ShadowSpec` on `style.shadow`. Wave 1B
// adds an array form on `style.shadows`. The union schema accepts
// either shape so the compiler can read both — back-compat preserved.
export const ShadowStackSchema = z.union([
  ShadowSpecSchema,
  z.array(ShadowSpecSchema).max(8),
]);
export type ShadowStack = z.infer<typeof ShadowStackSchema>;

// ────────── Wave 1B — FontUpload ──────────
//
// Server-side validation for the `/admin/broadcast/v2/builder/fonts`
// upload endpoint. fontkit parse + ttf2woff2 conversion run after
// this schema passes. 5MB hard cap matches spec §10.
const FONT_MIME = new Set([
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/font-sfnt",
  "application/x-font-ttf",
  "application/x-font-otf",
]);

export const FontUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().refine((m) => FONT_MIME.has(m), {
    message: "mimeType must be a known font MIME",
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024, "Font file must be ≤ 5MB"),
});
export type FontUpload = z.infer<typeof FontUploadSchema>;

// ────────────── Style ──────────────
//
// Style is a single permissive shape — element-type-discriminated
// validation lives in `style-schema.ts` / `style-validator.ts`. This
// schema accepts the union of every per-type field so the DB JSON
// column can be parsed without knowing the element_type up front.
export const StyleSchema = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  letterSpacing: z.number().optional(),
  lineHeight: z.number().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  color: z.string().optional(),
  // Wave 1A single shadow (preserved). Wave 1B `shadows` array below
  // takes precedence in the compiler when both present.
  shadow: ShadowSpecSchema.optional(),
  // Wave 1B — stack of up to 8 shadows. Compiled to a comma-joined
  // CSS `box-shadow` rule.
  shadows: z.array(ShadowSpecSchema).max(8).optional(),
  // Wave 1B — gradient fill (replaces solid `fill` when present).
  gradient: GradientSpecSchema.optional(),
  // Wave 1B — CSS filter stack applied to the element.
  filter: FilterSpecSchema.optional(),
  imageAssetId: z.string().optional(),
  imageFit: z.enum(["cover", "contain", "fill"]).optional(),
  // Wave 1B — polygon sides (used by PolygonStyleSchema + compiler).
  sides: z.number().int().min(3).max(12).optional(),
});
export type Style = z.infer<typeof StyleSchema>;

// ────────────── Binding ──────────────
export const FeedNameSchema = z.enum([
  "standings",
  "live_score",
  "top_scorers",
  "h2h",
  "match",
  "match_day",
  "custom_text",
]);
export type FeedName = z.infer<typeof FeedNameSchema>;

export const BindingSchema = z.object({
  feed: FeedNameSchema,
  fieldPath: z.string(),
  templateString: z.string().optional(),
});
export type Binding = z.infer<typeof BindingSchema>;

// ────────────── PathSpec (Wave 1C) ──────────────
//
// Path elements persist as a structured array of cubic-Bezier anchor
// nodes instead of a raw SVG `d` string. The PathPenOverlay (Task 5)
// edits the nodes directly; the compiler (Task 4) renders the `d`
// attribute from them server-side so the wire stays sanitised.
//
// For a straight segment, ctrlOut* of the prior node and ctrlIn* of
// the current node equal their owning anchor's (x, y).
export const PathNodeSchema = z.object({
  x: z.number(),
  y: z.number(),
  ctrlInX: z.number(),
  ctrlInY: z.number(),
  ctrlOutX: z.number(),
  ctrlOutY: z.number(),
});
export type PathNode = z.infer<typeof PathNodeSchema>;

export const PathSpecSchema = z.object({
  nodes: z.array(PathNodeSchema).min(2),
  closed: z.boolean().default(false),
});
export type PathSpec = z.infer<typeof PathSpecSchema>;

// ────────────── Animation ──────────────
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
  "noop", // Wave 3B sentinel — phase driven by advancedTimeline only
]);
export type AnimType = z.infer<typeof AnimTypeSchema>;

// ────────────── Wave 3B: Advanced keyframe timeline ──────────────
//
// Each animation phase (entry / exit / loop) can optionally carry an
// `advancedTimeline` array alongside (or instead of) the preset `type`.
// A track binds a single CSS-mapped property (opacity / x / y / scaleX /
// scaleY / rotation / color / filter) to ≥2 keyframes. Keyframes hold a
// timeMs offset, a value (number or string for color/filter), and an
// optional outgoing cubic-bezier easing curve. Mutual exclusivity with
// the preset `type` is enforced in `animation-validator.ts` so the
// schema parse stays cheap and the editor can hold both shapes
// side-by-side mid-edit.
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

export const BezierEasingSchema = z.object({
  x1: z.number().min(0).max(1),
  y1: z.number().min(-1).max(2),
  x2: z.number().min(0).max(1),
  y2: z.number().min(-1).max(2),
});
export type BezierEasing = z.infer<typeof BezierEasingSchema>;

export const KeyframeSchema = z.object({
  id: z.string().min(1),
  timeMs: z.number().min(0).max(60_000),
  value: z.union([z.number(), z.string()]),
  easingOut: BezierEasingSchema.nullable(),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const AdvancedTimelineTrackSchema = z.object({
  property: TimelinePropertySchema,
  keyframes: z.array(KeyframeSchema).min(2),
});
export type AdvancedTimelineTrack = z.infer<typeof AdvancedTimelineTrackSchema>;

export const AdvancedTimelineSchema = z.array(AdvancedTimelineTrackSchema);
export type AdvancedTimeline = z.infer<typeof AdvancedTimelineSchema>;

export const PresetAnimSchema = z.object({
  type: AnimTypeSchema,
  durationMs: z.number().min(0).max(60_000),
  delayMs: z.number().min(0).max(60_000),
  easing: z.string(),
  advancedTimeline: AdvancedTimelineSchema.optional(),
  keyframesBody: z.string().optional(),
});
export type PresetAnim = z.infer<typeof PresetAnimSchema>;

export const AnimationSchema = z.object({
  entry: PresetAnimSchema.optional(),
  exit: PresetAnimSchema.optional(),
  loop: PresetAnimSchema.optional(),
});
export type Animation = z.infer<typeof AnimationSchema>;

// ────────────── Element ──────────────
export const ElementSchema = z.object({
  id: z.string(),
  sceneId: z.string(),
  parentGroupId: z.string().nullable(),
  elementType: ElementTypeSchema,
  zIndex: z.number(),
  locked: z.boolean(),
  visible: z.boolean(),
  transform: TransformSchema,
  style: StyleSchema,
  content: z.record(z.string(), z.unknown()),
  binding: BindingSchema.nullable(),
  animation: AnimationSchema,
});
export type Element = z.infer<typeof ElementSchema>;

// ────────────── Scene ──────────────
export const SceneSchema = z.object({
  id: z.string(),
  designId: z.string(),
  orderIndex: z.number(),
  name: z.string().nullable(),
  durationMs: z.number(),
  transitionIn: z.string(),
  transitionOut: z.string(),
  elements: z.array(ElementSchema),
});
export type Scene = z.infer<typeof SceneSchema>;

// ────────────── Design ──────────────
export const DesignSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  mode: z.enum(["single", "sequence"]),
  status: z.enum(["draft", "published"]),
  canvasWidth: z.number(),
  canvasHeight: z.number(),
  scenes: z.array(SceneSchema),
  createdBy: z.string(),
});
export type Design = z.infer<typeof DesignSchema>;
