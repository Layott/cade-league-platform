/**
 * Plan 54 — sync Zod schemas + types for the social-render-jobs CRUD layer.
 *
 * Lives in a sibling `schemas.ts` per CLAUDE.md §10: a server-action `.ts`
 * file with `"use server"` may export ONLY async functions; sync schemas /
 * types must live in a sibling. `jobs.ts` itself does NOT carry `"use
 * server"` — it's a server module called from action files (Wave 2). But we
 * still keep schemas in this file so a future "use server" mig is mechanical.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §4 + §6.
 */

import { z } from "zod";
import {
  SIZE_PRESETS,
  type SocialSize,
} from "@/lib/social-sizes";

/**
 * Mirrors the `social_render_jobs.status` CHECK constraint in the Wave 1A
 * migration. Locked enum.
 */
export const SocialJobStatus = [
  "pending",
  "rendering",
  "ready",
  "failed",
  "cancelled",
] as const;
export type SocialJobStatus = (typeof SocialJobStatus)[number];

/** `format` enum for `social_render_jobs.format`. */
export const SocialJobFormat = ["image", "video"] as const;
export type SocialJobFormat = (typeof SocialJobFormat)[number];

/** Allowed `template_key` values — kept in sync with the typed registry. */
export const SocialTemplateKeyEnum = z.enum([
  "leaderboard",
  "top-scorers",
  "upcoming-fixtures",
  "gd-leaders",
  "league-avg",
]);
export type SocialTemplateKeyValue = z.infer<typeof SocialTemplateKeyEnum>;

/**
 * Z-enum for SocialSize — Object.keys on SIZE_PRESETS gives a literal tuple
 * we can hand straight to Zod, so size validation stays driven by the
 * presets file (single source of truth).
 */
const SOCIAL_SIZE_KEYS = Object.keys(SIZE_PRESETS) as readonly SocialSize[];
export const SocialSizeEnum = z.enum(
  SOCIAL_SIZE_KEYS as readonly string[] as [string, ...string[]],
);

/* ------------------------------------------------------------------ *
 * Job CRUD payload shapes                                             *
 * ------------------------------------------------------------------ */

/**
 * Input shape for `createJob`. `sourceData` is intentionally `unknown` —
 * the renderer freezes whatever payload was visible at trigger time so
 * a re-render produces the SAME asset. Validating the inner shape per
 * template is the renderer's job, not the queue's.
 */
export const CreateJobInputSchema = z.object({
  templateKey: SocialTemplateKeyEnum,
  size: SocialSizeEnum,
  format: z.enum(SocialJobFormat),
  sourceData: z.record(z.string(), z.unknown()),
  seasonId: z.string().uuid().optional(),
  matchDayId: z.string().uuid().optional(),
});
export type CreateJobInput = z.infer<typeof CreateJobInputSchema>;

/**
 * Optional fields surfaced by the worker on a status update. `outputUrl`
 * lands when the renderer has uploaded to Storage; `errorMessage` lands on
 * a failure path.
 */
export const UpdateJobStatusExtrasSchema = z
  .object({
    outputUrl: z.string().min(1).max(2048).optional(),
    outputSizeBytes: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    errorMessage: z.string().max(2048).optional(),
  })
  .partial();
export type UpdateJobStatusExtras = z.infer<typeof UpdateJobStatusExtrasSchema>;

/* ------------------------------------------------------------------ *
 * Domain row shape (snake_case columns mapped to camelCase fields)    *
 * ------------------------------------------------------------------ */

/**
 * Row shape returned by `getJob` / `listRecentJobs`. Mirrors the
 * `social_render_jobs` table 1:1 with snake → camel.
 */
export interface SocialRenderJob {
  id: string;
  templateKey: string;
  size: string;
  format: SocialJobFormat;
  sourceData: Record<string, unknown>;
  seasonId: string | null;
  matchDayId: string | null;
  status: SocialJobStatus;
  outputUrl: string | null;
  outputSizeBytes: number | null;
  errorMessage: string | null;
  durationMs: number | null;
  requestedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  postedMarker: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
