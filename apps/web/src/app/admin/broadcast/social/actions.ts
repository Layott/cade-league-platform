"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import {
  createJob,
  approveJob,
  softDeleteJob,
  getJob,
  type SocialRenderJob,
} from "@/server/social/jobs";
import {
  SocialTemplateKeyEnum,
  SocialSizeEnum,
} from "@/server/social/schemas";
import type { SocialSize } from "@/lib/social-sizes";

/**
 * Plan 54 Wave 2B — admin server actions for the broadcast social UI.
 *
 * Three triggers + housekeeping:
 *   - triggerStaticRender: fetch the OG endpoint, upload bytes to the
 *     `social-renders` bucket, persist a `social_render_jobs` row.
 *   - triggerVideoRender: Phase 3 placeholder (throws `not_implemented`)
 *     so the admin button can wire through to a server action without
 *     a conditional surface today.
 *   - approveSocialJob / deleteSocialJob: thin wrappers around the
 *     `server/social/jobs.ts` mutations. Revalidate on success.
 *   - copyShareLink: returns the asset URL so the client can
 *     `navigator.clipboard.writeText()` it. Pure read action — no DB
 *     mutation, perm-gated to `social.read`.
 *
 * Server-action constraint (CLAUDE.md §10): only async functions may be
 * exported from `"use server"` files. Sync schemas live in
 * `@/server/social/schemas`.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §6
 * (Phase 1, file structure: `apps/web/src/app/admin/broadcast/social/actions.ts`).
 */

/* ------------------------------------------------------------------ *
 * Auth + perm gate                                                    *
 * ------------------------------------------------------------------ */

type GateResult = {
  sb: ReturnType<typeof getServiceRoleSupabase>;
  publicUserId: string;
  roles: readonly string[];
};

/**
 * Resolve the authenticated admin → require a perm → run the per-user
 * write rate limit. Mirrors the pattern in
 * `apps/web/src/app/admin/broadcast/v2/design/actions.ts::gate`.
 *
 * Throws "Forbidden: missing <perm>" on perm miss, "rate_limited"
 * when the limiter trips. Both surface as plain Errors which Next.js
 * turns into a 500 by default; the caller sees a string they can
 * branch on.
 */
async function gate(perm: string): Promise<GateResult> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/broadcast/social");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/broadcast/social");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, perm);
  } catch (err) {
    if (err instanceof PermissionError) {
      throw new Error(`Forbidden: missing ${perm}`);
    }
    throw err;
  }
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");
  return { sb, publicUserId: pub.id, roles };
}

/* ------------------------------------------------------------------ *
 * triggerStaticRender                                                 *
 * ------------------------------------------------------------------ */

const TriggerStaticRenderInputSchema = z.object({
  templateKey: SocialTemplateKeyEnum,
  size: SocialSizeEnum,
  sessionId: z.string().uuid(),
});
export type TriggerStaticRenderInput = z.infer<typeof TriggerStaticRenderInputSchema>;

export type TriggerStaticRenderResult =
  | { ok: true; id: string; url: string }
  | { ok: false; error: string };

/**
 * Render a static social asset.
 *
 *   1. Fetch the OG endpoint at `/api/social/og/<key>/<size>?session=<id>`
 *      against the deployed origin (Wave 2A built these routes; this
 *      action does not require Wave 2A to be live — when the OG route
 *      404s the action returns `{ ok: false, error: ... }` so the UI can
 *      surface the failure inline).
 *   2. Upload the PNG bytes to the `social-renders` bucket via the
 *      service-role client.
 *   3. Persist a `social_render_jobs` row via `createJob` with
 *      `format='image'`, `status='pending'` (the job module sets pending
 *      automatically) + the resulting `output_url`.
 *   4. Patch the row to `status='ready'` so the admin sees the asset
 *      immediately. The createJob+update split keeps the audit trail
 *      shape consistent with the worker path (Phase 3) which goes
 *      pending→rendering→ready.
 *
 * Returns a discriminated result so the client can branch on success vs.
 * error without unwrapping a thrown Error across the RSC boundary.
 *
 * Perm gate: `social.render`.
 */
export async function triggerStaticRender(
  input: TriggerStaticRenderInput,
): Promise<TriggerStaticRenderResult> {
  const parsed = TriggerStaticRenderInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid input: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    };
  }

  let g: GateResult;
  try {
    g = await gate("social.render");
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "auth gate failed",
    };
  }
  const { sb, publicUserId, roles } = g;
  const actor = { userId: publicUserId, roles };

  // Resolve `match_day_id` + `season_id` from the session. Best-effort —
  // a misconfigured session rejects the render up front rather than
  // half-writing a job row with NULL FKs.
  type SessionRow = {
    id: string;
    match_day_id: string;
  };
  const { data: sess, error: sessErr } = await sb
    .from("stream_sessions")
    .select("id, match_day_id")
    .eq("id", parsed.data.sessionId)
    .is("deleted_at", null)
    .maybeSingle<SessionRow>();
  if (sessErr) {
    return { ok: false, error: `session lookup failed: ${sessErr.message}` };
  }
  if (!sess) {
    return { ok: false, error: `session ${parsed.data.sessionId} not found` };
  }
  type MatchDayRow = { id: string; season_id: string };
  const { data: md, error: mdErr } = await sb
    .from("match_days")
    .select("id, season_id")
    .eq("id", sess.match_day_id)
    .is("deleted_at", null)
    .maybeSingle<MatchDayRow>();
  if (mdErr) {
    return { ok: false, error: `match_day lookup failed: ${mdErr.message}` };
  }
  const seasonId = md?.season_id ?? null;
  const matchDayId = md?.id ?? null;

  // Resolve the deployed origin for the OG fetch. The Edge runtime needs
  // an absolute URL because there is no "current origin" in the same
  // sense as a browser. Read x-forwarded-host first so dev/prod parity
  // holds; fall back to the host header.
  const hdrs = await headers();
  const protocol = hdrs.get("x-forwarded-proto") ?? "http";
  const host =
    hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const origin = `${protocol}://${host}`;

  const ogPath = `/api/social/og/${parsed.data.templateKey}/${parsed.data.size}?session=${encodeURIComponent(parsed.data.sessionId)}`;
  const ogUrl = `${origin}${ogPath}`;

  // 1. Fetch the OG endpoint.
  const t0 = Date.now();
  let ogResp: Response;
  try {
    ogResp = await fetch(ogUrl, {
      method: "GET",
      headers: {
        // Forward auth cookies so the OG route — if it's gated — sees
        // the same session. The cookies header is comma-separated
        // name=value pairs; reading from the inbound headers is
        // sufficient for the dev case (server-action invocation rides
        // the same auth cookie set as the page request).
        cookie: hdrs.get("cookie") ?? "",
      },
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      error: `og fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!ogResp.ok) {
    return {
      ok: false,
      error: `og endpoint returned ${ogResp.status} ${ogResp.statusText} (path: ${ogPath})`,
    };
  }
  const contentType = ogResp.headers.get("content-type") ?? "image/png";
  const bytes = Buffer.from(await ogResp.arrayBuffer());
  if (bytes.length === 0) {
    return { ok: false, error: "og endpoint returned empty body" };
  }

  // 2. Upload to Storage. Filename pattern:
  //   <templateKey>/<sessionId>/<size>-<ts>.<ext>
  // Sessions get their own folder so an admin can prune all assets for a
  // given match day in one call.
  const ts = Date.now();
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("jpeg")
      ? "jpg"
      : "bin";
  const filename = `${parsed.data.templateKey}/${parsed.data.sessionId}/${parsed.data.size}-${ts}.${ext}`;

  const { error: uploadErr } = await sb.storage
    .from("social-renders")
    .upload(filename, bytes, {
      contentType,
      cacheControl: "3600",
      upsert: false,
    });
  if (uploadErr) {
    return {
      ok: false,
      error: `storage upload failed: ${uploadErr.message}`,
    };
  }

  // 3. Resolve a 7-day signed URL — bucket is private per spec §4. The
  // admin UI renders this URL directly; consumers outside the admin shell
  // would need to go through the API.
  const { data: signed, error: signErr } = await sb.storage
    .from("social-renders")
    .createSignedUrl(filename, 60 * 60 * 24 * 7);
  if (signErr || !signed?.signedUrl) {
    return {
      ok: false,
      error: `signed URL generation failed: ${signErr?.message ?? "no url"}`,
    };
  }
  const outputUrl = signed.signedUrl;

  // 4. Persist the job + flip to `ready`.
  let jobId: string;
  try {
    const created = await createJob(sb, actor, {
      templateKey: parsed.data.templateKey,
      size: parsed.data.size as SocialSize,
      format: "image",
      sourceData: {
        renderedAt: new Date().toISOString(),
        sessionId: parsed.data.sessionId,
        ogPath,
      },
      seasonId: seasonId ?? undefined,
      matchDayId: matchDayId ?? undefined,
    });
    jobId = created.id;
  } catch (e) {
    return {
      ok: false,
      error: `createJob failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const durationMs = Date.now() - t0;
  // Direct UPDATE — the per-action perm gate already ran; we know the
  // actor has `social.render`. Going through `updateJobStatus` here would
  // re-run requirePermAsync needlessly.
  const { error: patchErr } = await sb
    .from("social_render_jobs")
    .update({
      status: "ready",
      output_url: outputUrl,
      output_size_bytes: bytes.length,
      duration_ms: durationMs,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (patchErr) {
    // The job row exists but is stuck in `pending` — surface the error
    // so the admin can re-trigger or delete the dangling row. The
    // upload + signed URL still landed.
    return {
      ok: false,
      error: `job status update failed: ${patchErr.message}`,
    };
  }

  revalidatePath("/admin/broadcast/social");
  revalidatePath(`/admin/broadcast/social/${parsed.data.templateKey}`);
  return { ok: true, id: jobId, url: outputUrl };
}

/* ------------------------------------------------------------------ *
 * triggerVideoRender (Phase 3 placeholder)                            *
 * ------------------------------------------------------------------ */

export type TriggerVideoRenderInput = TriggerStaticRenderInput;
export type TriggerVideoRenderResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Phase 3 — video render via the external worker. NOT IMPLEMENTED in
 * Phase 1 — the worker repo is its own deliverable (see spec §7).
 *
 * Stubbed so the admin UI can wire a "Render Video" button without
 * branching on a feature flag. Returns a discriminated result the same
 * shape as `triggerStaticRender` so callers don't need to distinguish.
 */
export async function triggerVideoRender(
  input: TriggerVideoRenderInput,
): Promise<TriggerVideoRenderResult> {
  // Validate input even on the not-implemented path so callers learn
  // about a malformed payload immediately. Phase 3 will replace the
  // throw with a `createJob({ format: 'video' })` enqueue.
  const parsed = TriggerStaticRenderInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: `invalid input: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    };
  }
  return {
    ok: false,
    error: "not_implemented: video render lands in Plan 54 Phase 3",
  };
}

/* ------------------------------------------------------------------ *
 * approveSocialJob / deleteSocialJob                                  *
 * ------------------------------------------------------------------ */

const JobIdSchema = z.string().uuid();

export type SocialJobActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Mark a job approved. Idempotent — re-approving updates the timestamp.
 * Perm gate: `social.approve`.
 */
export async function approveSocialJob(
  id: string,
): Promise<SocialJobActionResult> {
  const parsed = JobIdSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "invalid job id" };
  }
  let g: GateResult;
  try {
    g = await gate("social.approve");
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "auth gate failed",
    };
  }
  const { sb, publicUserId, roles } = g;
  try {
    await approveJob(sb, { userId: publicUserId, roles }, parsed.data);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "approveJob failed",
    };
  }
  revalidatePath("/admin/broadcast/social");
  // We don't know the templateKey here without a re-read; the recent-
  // jobs table on every per-template page revalidates from the same
  // row, so a wide revalidate covers all sub-routes. The cost of a
  // wider revalidate is negligible in this admin surface.
  revalidatePath("/admin/broadcast/social", "page");
  return { ok: true };
}

/**
 * Soft-delete a job. Perm gate: `social.delete` (admin-only).
 *
 * NOTE — this does NOT delete the underlying Storage object. The blob
 * stays in the bucket until the (future) cron job sweeps soft-deleted
 * rows older than 30 days. Spec §3 retention rule.
 */
export async function deleteSocialJob(
  id: string,
): Promise<SocialJobActionResult> {
  const parsed = JobIdSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "invalid job id" };
  }
  let g: GateResult;
  try {
    g = await gate("social.delete");
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "auth gate failed",
    };
  }
  const { sb, publicUserId, roles } = g;
  try {
    await softDeleteJob(sb, { userId: publicUserId, roles }, parsed.data);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "softDeleteJob failed",
    };
  }
  revalidatePath("/admin/broadcast/social");
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * copyShareLink                                                       *
 * ------------------------------------------------------------------ */

export type CopyShareLinkResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Re-fetch the job + return its `output_url` so the client can copy it
 * to the clipboard. This goes through a server action (vs. just rendering
 * the URL into the DOM as text) so we can perm-gate the "copy" without
 * leaking the signed URL into HTML for a viewer who doesn't hold
 * `social.read`.
 *
 * The job module's `getJob` itself runs `requirePermAsync` so we don't
 * re-gate here — the underlying call rejects unauthenticated readers.
 */
export async function copyShareLink(id: string): Promise<CopyShareLinkResult> {
  const parsed = JobIdSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "invalid job id" };
  }
  // Resolve actor to honour `social.read` via getJob.
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) {
    return { ok: false, error: "not authenticated" };
  }
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) return { ok: false, error: "user row not found" };
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const sb = getServiceRoleSupabase();
  let job: SocialRenderJob | null;
  try {
    job = await getJob(sb, { userId: pub.id, roles }, parsed.data);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "getJob failed",
    };
  }
  if (!job) return { ok: false, error: "job not found" };
  if (!job.outputUrl) {
    return { ok: false, error: "job has no output_url yet" };
  }
  return { ok: true, url: job.outputUrl };
}

