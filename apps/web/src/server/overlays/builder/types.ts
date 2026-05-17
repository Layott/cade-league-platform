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
  shadow: ShadowSpecSchema.optional(),
  imageAssetId: z.string().optional(),
  imageFit: z.enum(["cover", "contain", "fill"]).optional(),
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
]);
export type AnimType = z.infer<typeof AnimTypeSchema>;

export const PresetAnimSchema = z.object({
  type: AnimTypeSchema,
  durationMs: z.number(),
  delayMs: z.number(),
  easing: z.string(),
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
