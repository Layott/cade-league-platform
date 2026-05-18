import { z } from "zod";
import { MAX_PSD_BYTES, SOFT_WARN_PSD_BYTES } from "@/server/overlays/builder/psd-parser";

/**
 * Wave 2A — Zod + types for asset-upload server action.
 *
 * Per CLAUDE.md §10 this file is NOT 'use server'. Sync exports only.
 */

export const UploadPsdResultSchema = z.object({
  ok: z.literal(true),
  parentAssetId: z.string().uuid(),
  flatAssetId: z.string().uuid(),
  layerAssetIds: z.array(z.string().uuid()),
  canvasWidth: z.number().int().positive(),
  canvasHeight: z.number().int().positive(),
  softWarnLarge: z.boolean(),
});

export const UploadPsdErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: z.enum([
    "missing_file",
    "bad_extension",
    "too_large",
    "parse_failed",
    "storage_failed",
    "db_failed",
    "forbidden",
    "rate_limited",
    "unknown",
  ]),
});

export const UploadPsdResponseSchema = z.discriminatedUnion("ok", [
  UploadPsdResultSchema,
  UploadPsdErrorSchema,
]);

export type UploadPsdResponse = z.infer<typeof UploadPsdResponseSchema>;

export { MAX_PSD_BYTES, SOFT_WARN_PSD_BYTES };
