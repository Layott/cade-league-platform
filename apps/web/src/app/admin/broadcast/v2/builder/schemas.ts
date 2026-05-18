import { z } from "zod";

/**
 * Wave 1A — schemas + types for builder admin actions.
 *
 * Per CLAUDE.md §10: this file is NOT `'use server'`. It exports sync
 * Zod schemas + derived types consumed by the action handlers in the
 * sibling `actions.ts` file.
 *
 * Convention: camelCase throughout to match the `Design` type from
 * `@/server/overlays/builder/types`. No snake_case conversion layer.
 */

export const CreateDesignSchema = z.object({
  title: z.string().min(1, "title required").max(120),
  mode: z.enum(["single", "sequence"], {
    error: "mode must be 'single' or 'sequence'",
  }),
});

export type CreateDesignInput = z.infer<typeof CreateDesignSchema>;

// ────────────── Transform ──────────────

const TransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  opacity: z.number().min(0).max(1),
});

// ────────────── Style ──────────────

const StyleSchema = z
  .object({
    fill: z.string().nullable().optional(),
    fontFamily: z.string().nullable().optional(),
    fontSize: z.number().nullable().optional(),
    fontWeight: z.number().nullable().optional(),
    textAlign: z.enum(["left", "center", "right"]).nullable().optional(),
    shadow: z
      .object({
        offsetX: z.number(),
        offsetY: z.number(),
        blur: z.number(),
        spread: z.number().optional(),
        color: z.string(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

// ────────────── Binding ──────────────

const BindingSchema = z
  .object({
    feed: z.string(),
    fieldPath: z.string(),
    templateString: z.string().nullable().optional(),
    variant: z.string().nullable().optional(),
  })
  .nullable();

// ────────────── Animation ──────────────

const AnimationStepSchema = z
  .object({
    type: z.string(),
    durationMs: z.number().optional(),
    delayMs: z.number().optional(),
    easing: z.string().optional(),
  })
  .nullable();

const AnimationSchema = z
  .object({
    entry: AnimationStepSchema,
    exit: AnimationStepSchema,
    loop: AnimationStepSchema,
    advancedTimeline: z.any().nullable().optional(),
  })
  .nullable();

// ────────────── Element ──────────────
//
// Note: The JSON wire format (what the Zustand store serialises to FormData)
// uses snake_case field names for scene + element arrays (order_index,
// duration_ms, z_index, element_type, etc.) to match the DB row shape.
// Top-level design fields (canvasWidth, canvasHeight) stay camelCase
// because they come from the Design type on the TypeScript side.

const ElementSchema = z.object({
  id: z.string().min(1),
  // scene_id may be absent when elements are nested inside SceneSchema
  scene_id: z.string().min(1).optional(),
  parent_group_id: z.string().nullable().optional(),
  element_type: z.enum([
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
  ]),
  z_index: z.number(),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  transform: TransformSchema,
  style: StyleSchema,
  content: z.any().nullable().optional(),
  binding: BindingSchema,
  animation: AnimationSchema,
});

export type SaveElementInput = z.infer<typeof ElementSchema>;

// ────────────── Scene ──────────────

const SceneSchema = z.object({
  id: z.string().min(1),
  order_index: z.number(),
  name: z.string().nullable().optional(),
  duration_ms: z.number().default(5000),
  transition_in: z.enum(["cut", "fade", "slide-left", "slide-right", "slide-up", "slide-down"]),
  transition_out: z.enum(["cut", "fade", "slide-left", "slide-right", "slide-up", "slide-down"]),
  elements: z.array(ElementSchema),
});

export type SaveSceneInput = z.infer<typeof SceneSchema>;

// ────────────── SaveDesign ──────────────

export const SaveDesignSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  mode: z.enum(["single", "sequence"]),
  status: z.enum(["draft", "published"]),
  canvas_width: z.number(),
  canvas_height: z.number(),
  scenes: z.array(SceneSchema).min(1, "design must have at least one scene"),
});

export type SaveDesignInput = z.infer<typeof SaveDesignSchema>;

// ────────────── UpdateDesignMeta ──────────────

export const UpdateDesignMetaSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  mode: z.enum(["single", "sequence"]).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

export type UpdateDesignMetaInput = z.infer<typeof UpdateDesignMetaSchema>;

// ────────────── Wave 3A — Scene-scoped action schemas ──────────────

export const TRANSITION_VALUES = [
  "cut",
  "fade",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down",
] as const;
export const TransitionEnum = z.enum(TRANSITION_VALUES);
export type Transition = z.infer<typeof TransitionEnum>;

export const AddSceneInputSchema = z.object({
  designId: z.string().uuid(),
  designSlug: z.string().min(1),
  afterOrderIndex: z.number().int().min(-1),
  durationMs: z.number().int().min(200).max(60000).optional(),
  transitionIn: TransitionEnum.optional(),
  transitionOut: TransitionEnum.optional(),
});

export const UpdateScenePatchSchema = z
  .object({
    name: z.string().max(120).nullable(),
    durationMs: z.number().int().min(200).max(60000),
    transitionIn: TransitionEnum,
    transitionOut: TransitionEnum,
  })
  .partial();

export const UpdateSceneInputSchema = z.object({
  sceneId: z.string().uuid(),
  designSlug: z.string().min(1),
  patch: UpdateScenePatchSchema,
});

export const ReorderScenesInputSchema = z.object({
  designId: z.string().uuid(),
  designSlug: z.string().min(1),
  sceneIdOrder: z.array(z.string().uuid()).min(1),
});

export const DeleteSceneInputSchema = z.object({
  sceneId: z.string().uuid(),
  designSlug: z.string().min(1),
});

export const CloneSceneInputSchema = z.object({
  sceneId: z.string().uuid(),
  designSlug: z.string().min(1),
});
