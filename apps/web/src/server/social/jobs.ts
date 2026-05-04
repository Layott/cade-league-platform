/**
 * Plan 54 — `social_render_jobs` CRUD layer.
 *
 * Server module — NOT a `"use server"` action file. Per CLAUDE.md §10,
 * action files may export only async functions; this module exports types
 * + helper functions and is consumed from action files (Wave 2) +
 * directly from the worker (Phase 3). Sync types live in `schemas.ts`.
 *
 * Audit trail: every INSERT/UPDATE on `social_render_jobs` is captured by
 * the `audit_row_change()` trigger attached in Wave 1A (migration
 * `20260801000003_attach_audit_social_render_jobs.sql`). The trigger
 * reads `current_setting('app.current_user_id')` set by API middleware,
 * so this module deliberately does NOT call any audit helper itself —
 * mutating from the service-role client + a perm-gated action layer is
 * sufficient to populate `audit_events.actor_user_id`.
 *
 * Permission gates:
 *   - createJob       → social.render
 *   - approveJob      → social.approve
 *   - softDeleteJob   → social.delete
 *   - listRecentJobs  → social.read
 *   - getJob          → social.read
 *   - updateJobStatus → social.render (worker context)
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §4 + §5.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import {
  CreateJobInputSchema,
  UpdateJobStatusExtrasSchema,
  type CreateJobInput,
  type SocialJobStatus,
  type SocialRenderJob,
  type UpdateJobStatusExtras,
} from "./schemas";

// Re-export for convenience so callers don't need to import from two paths.
export type {
  CreateJobInput,
  SocialJobStatus,
  SocialRenderJob,
  UpdateJobStatusExtras,
} from "./schemas";

const SELECT_COLS =
  "id, template_key, size, format, source_data, season_id, match_day_id, status, output_url, output_size_bytes, error_message, duration_ms, requested_by, approved_by, approved_at, posted_marker, created_at, updated_at, deleted_at";

/** DB row shape (snake_case) — internal, never crosses module boundaries. */
type Row = {
  id: string;
  template_key: string;
  size: string;
  format: "image" | "video";
  source_data: Record<string, unknown> | null;
  season_id: string | null;
  match_day_id: string | null;
  status: SocialJobStatus;
  output_url: string | null;
  output_size_bytes: number | null;
  error_message: string | null;
  duration_ms: number | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  posted_marker: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function toJob(r: Row): SocialRenderJob {
  return {
    id: r.id,
    templateKey: r.template_key,
    size: r.size,
    format: r.format,
    sourceData: (r.source_data ?? {}) as Record<string, unknown>,
    seasonId: r.season_id,
    matchDayId: r.match_day_id,
    status: r.status,
    outputUrl: r.output_url,
    outputSizeBytes: r.output_size_bytes,
    errorMessage: r.error_message,
    durationMs: r.duration_ms,
    requestedBy: r.requested_by,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    postedMarker: r.posted_marker,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

/* ------------------------------------------------------------------ *
 * createJob                                                           *
 * ------------------------------------------------------------------ */

/**
 * Insert a new render job. Caller MUST already hold `social.render` — the
 * gate is re-applied here so a misconfigured action file can't sneak past.
 *
 * `actor.userId` lands on `requested_by`. The DB triggers + audit row pick
 * it up via `current_setting('app.current_user_id')` set by API middleware.
 */
export async function createJob(
  sb: SupabaseClient,
  actor: Actor,
  input: CreateJobInput,
): Promise<{ id: string }> {
  await requirePermAsync(sb, actor, "social.render");
  const parsed = CreateJobInputSchema.parse(input);

  const { data, error } = await sb
    .from("social_render_jobs")
    .insert({
      template_key: parsed.templateKey,
      size: parsed.size,
      format: parsed.format,
      source_data: parsed.sourceData,
      season_id: parsed.seasonId ?? null,
      match_day_id: parsed.matchDayId ?? null,
      status: "pending",
      requested_by: actor.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`createJob failed: ${error?.message ?? "no data"}`);
  }
  return { id: (data as { id: string }).id };
}

/* ------------------------------------------------------------------ *
 * getJob                                                              *
 * ------------------------------------------------------------------ */

/**
 * Read a single job by id. Returns null when the row is missing or
 * soft-deleted. Soft-deleted rows ARE filtered out — admins viewing a
 * deleted job go through `/admin/trash` (Plan 1A pattern).
 *
 * Caller must hold `social.read`.
 */
export async function getJob(
  sb: SupabaseClient,
  actor: Actor,
  id: string,
): Promise<SocialRenderJob | null> {
  await requirePermAsync(sb, actor, "social.read");
  const { data, error } = await sb
    .from("social_render_jobs")
    .select(SELECT_COLS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(`getJob failed: ${error.message}`);
  }
  if (!data) return null;
  return toJob(data as Row);
}

/* ------------------------------------------------------------------ *
 * listRecentJobs                                                      *
 * ------------------------------------------------------------------ */

/**
 * Newest-first job feed for the admin /broadcast/social landing page.
 * Excludes soft-deleted rows. Default cap of 50 keeps the wire shape
 * cheap; admins searching deeper hit a paginated /trash path later.
 */
export async function listRecentJobs(
  sb: SupabaseClient,
  actor: Actor,
  limit: number = 50,
): Promise<SocialRenderJob[]> {
  await requirePermAsync(sb, actor, "social.read");
  const n = Math.min(Math.max(limit, 1), 200);
  const { data, error } = await sb
    .from("social_render_jobs")
    .select(SELECT_COLS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(n);
  if (error) {
    throw new Error(`listRecentJobs failed: ${error.message}`);
  }
  return ((data ?? []) as Row[]).map(toJob);
}

/* ------------------------------------------------------------------ *
 * approveJob                                                          *
 * ------------------------------------------------------------------ */

/**
 * Mark a job approved. Sets `approved_by` to the actor + `approved_at`
 * to NOW(). Caller must hold `social.approve`.
 *
 * Idempotent — re-approving an already-approved job updates `approved_by`
 * + `approved_at` to the latest values. The audit trigger captures every
 * mutation so the historical record stays intact.
 */
export async function approveJob(
  sb: SupabaseClient,
  actor: Actor,
  id: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "social.approve");
  if (!actor.userId) {
    throw new Error("approveJob requires an authenticated actor");
  }
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("social_render_jobs")
    .update({
      approved_by: actor.userId,
      approved_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`approveJob failed: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * softDeleteJob                                                       *
 * ------------------------------------------------------------------ */

/**
 * Soft-delete (set `deleted_at`). Re-running on an already-deleted row
 * is a no-op — the WHERE clause filters them out so we don't overwrite
 * the original `deleted_at` timestamp.
 *
 * Caller must hold `social.delete` (admin-only per spec §5).
 */
export async function softDeleteJob(
  sb: SupabaseClient,
  actor: Actor,
  id: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "social.delete");
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("social_render_jobs")
    .update({
      deleted_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`softDeleteJob failed: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * updateJobStatus                                                     *
 * ------------------------------------------------------------------ */

/**
 * Worker-side status patch. Used by:
 *   - the OG route after a successful render → ('ready', { outputUrl, ... })
 *   - the video worker after a successful render → same
 *   - both on failure → ('failed', { errorMessage })
 *   - either on pickup → ('rendering', { durationMs?: undefined })
 *
 * Caller must hold `social.render` (server context — workers run with
 * service-role + an admin actor; the OG-route render flow uses the
 * authenticated user that triggered it).
 */
export async function updateJobStatus(
  sb: SupabaseClient,
  actor: Actor,
  id: string,
  status: Exclude<SocialJobStatus, "pending" | "cancelled">,
  extras: UpdateJobStatusExtras = {},
): Promise<void> {
  await requirePermAsync(sb, actor, "social.render");
  const parsedExtras = UpdateJobStatusExtrasSchema.parse(extras);

  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (parsedExtras.outputUrl !== undefined) patch.output_url = parsedExtras.outputUrl;
  if (parsedExtras.outputSizeBytes !== undefined) {
    patch.output_size_bytes = parsedExtras.outputSizeBytes;
  }
  if (parsedExtras.durationMs !== undefined) {
    patch.duration_ms = parsedExtras.durationMs;
  }
  if (parsedExtras.errorMessage !== undefined) {
    patch.error_message = parsedExtras.errorMessage;
  }

  const { error } = await sb
    .from("social_render_jobs")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`updateJobStatus failed: ${error.message}`);
  }
}
