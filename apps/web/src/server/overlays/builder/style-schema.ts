/**
 * Overlay Builder — element-type-discriminated style schema.
 *
 * The base `StyleSchema` in `types.ts` accepts the union of every per-
 * type field. This file narrows per element_type so each save validates
 * that (a) required fields for that type are present, and (b) fields
 * that don't belong to that type are flagged.
 *
 * Wave 1A implements rect / text / image / data-slot. The remaining
 * element types accept the same permissive shape as rect — Wave 1B+
 * tightens those.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §6
 */

import { z } from "zod";
import { ShadowSpecSchema } from "./types";
import type { ElementType } from "./types";

const RectStyleSchema = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  shadow: ShadowSpecSchema.optional(),
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
  shadow: ShadowSpecSchema.optional(),
});

const ImageStyleSchema = z.object({
  imageAssetId: z.string(),
  imageFit: z.enum(["cover", "contain", "fill"]).optional(),
  cornerRadius: z.number().optional(),
  shadow: ShadowSpecSchema.optional(),
});

// data-slot reuses TextStyle for text slots and ImageStyle for image
// slots. The discriminator runs in validator code, not the schema.
const DataSlotTextSchema = TextStyleSchema;
const DataSlotImageSchema = ImageStyleSchema;

// Forward-compat permissive shape for element types not yet narrowed.
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
  shadow: ShadowSpecSchema.optional(),
  imageAssetId: z.string().optional(),
  imageFit: z.enum(["cover", "contain", "fill"]).optional(),
});

/**
 * Pick the per-element_type Zod schema. Wave 1A narrows rect / text /
 * image / data-slot; everything else falls through to the permissive
 * shape (still subject to forbidden-pattern sweep in style-validator.ts).
 *
 * For `data-slot` callers must include a hint of which downstream
 * element shape the slot renders as. The validator entrypoint defers
 * to TextStyle by default; image-slot callers re-validate through
 * `ImageStyleSchema` if `imageAssetId` is present on the input.
 */
export function schemaForElementType(elementType: ElementType): z.ZodTypeAny {
  switch (elementType) {
    case "rect":
      return RectStyleSchema;
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
  TextStyleSchema,
  ImageStyleSchema,
  DataSlotTextSchema,
  DataSlotImageSchema,
  PermissiveStyleSchema,
};
