/**
 * Overlay Builder — element-type-discriminated style schema.
 *
 * Wave 1A: rect / text / image / data-slot tight schemas. Other types
 * fell through to PermissiveStyleSchema.
 *
 * Wave 1B: tightens ellipse / line / polygon, adds gradient / filter /
 * shadows array fields to fillable shapes (rect / ellipse / text /
 * polygon), preserves the single `shadow` field for back-compat.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §6
 */

import { z } from "zod";
import {
  ShadowSpecSchema,
  GradientSpecSchema,
  FilterSpecSchema,
} from "./types";
import type { ElementType } from "./types";

// Common optional effects every fillable shape inherits.
const EffectsShape = {
  shadow: ShadowSpecSchema.optional(),
  shadows: z.array(ShadowSpecSchema).max(8).optional(),
  gradient: GradientSpecSchema.optional(),
  filter: FilterSpecSchema.optional(),
};

const RectStyleSchema = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  ...EffectsShape,
});

const EllipseStyleSchema = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  ...EffectsShape,
});

// Line has NO fill — pure stroke shape.
const LineStyleSchema = z.object({
  stroke: z.string(),
  strokeWidth: z.number(),
  shadow: ShadowSpecSchema.optional(),
  shadows: z.array(ShadowSpecSchema).max(8).optional(),
  filter: FilterSpecSchema.optional(),
}).strict();

const PolygonStyleSchema = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  // Min 3, max 12 — beyond 12 just looks like a circle, gradient gets weird.
  sides: z.number().int().min(3).max(12),
  ...EffectsShape,
});

const TextStyleSchema = z.object({
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.number().optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  letterSpacing: z.number().optional(),
  lineHeight: z.number().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  color: z.string(),
  ...EffectsShape,
});

const ImageStyleSchema = z.object({
  imageAssetId: z.string(),
  imageFit: z.enum(["cover", "contain", "fill"]).optional(),
  cornerRadius: z.number().optional(),
  shadow: ShadowSpecSchema.optional(),
  shadows: z.array(ShadowSpecSchema).max(8).optional(),
  filter: FilterSpecSchema.optional(),
});

const DataSlotTextSchema = TextStyleSchema;
const DataSlotImageSchema = ImageStyleSchema;

// Forward-compat permissive shape for element types still unnarrowed
// (path, psd-layer, group).
const PermissiveStyleSchema = z.object({
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
  imageAssetId: z.string().optional(),
  imageFit: z.enum(["cover", "contain", "fill"]).optional(),
  ...EffectsShape,
});

export function schemaForElementType(elementType: ElementType): z.ZodTypeAny {
  switch (elementType) {
    case "rect":
      return RectStyleSchema;
    case "ellipse":
      return EllipseStyleSchema;
    case "line":
      return LineStyleSchema;
    case "polygon":
      return PolygonStyleSchema;
    case "text":
      return TextStyleSchema;
    case "image":
      return ImageStyleSchema;
    case "data-slot":
      return DataSlotTextSchema;
    default:
      return PermissiveStyleSchema;
  }
}

export {
  RectStyleSchema,
  EllipseStyleSchema,
  LineStyleSchema,
  PolygonStyleSchema,
  TextStyleSchema,
  ImageStyleSchema,
  DataSlotTextSchema,
  DataSlotImageSchema,
  PermissiveStyleSchema,
};
