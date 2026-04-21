"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import {
  buildStoragePath,
  downloadBuffer,
  parse,
  applyReview,
  rejectReview,
  BudgetExceededError,
  type MimeType,
  type ReviewInput,
} from "@/server/stats_ocr";

/**
 * Plan 14 — server actions for the stats-upload flow.
 *
 * All actions double-gate: the page itself also calls `requirePermAsync`, so
 * a direct POST still goes through the perm check here. Non-admin + non-
 * moderator roles get a thrown error (converted to the Next error page or a
 * 403 depending on where the POST landed).
 */

type PermName =
  | "stats.screenshot.upload"
  | "stats.screenshot.review"
  | "stats.screenshot.delete"
  | "stats.ocr.rerun";

async function requireActor(perm: PermName) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const sb = getServiceRoleSupabase();
  if (!(await hasPermAsync(sb, { userId: pub.id, roles }, perm))) {
    throw new Error("forbidden");
  }

  return { sb, actorUserId: pub.id as string };
}

function mimeFromFile(file: File): MimeType | null {
  const t = file.type.toLowerCase();
  if (t === "image/png") return "image/png";
  if (t === "image/jpeg" || t === "image/jpg") return "image/jpeg";
  if (t === "image/webp") return "image/webp";
  return null;
}

/**
 * Create a match_stat_screenshots row (parse_status='pending') + upload the
 * file. We use the service-role client to bypass the storage bucket policies
 * (which would otherwise reject a browser POST to a private bucket).
 */
export async function uploadScreenshotAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  const file = formData.get("file");
  if (!matchDayId || !matchId)
    throw new Error("matchDayId + matchId required");
  if (!(file instanceof File))
    throw new Error("file required");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("file exceeds 10 MB hard cap");
  const mime = mimeFromFile(file);
  if (!mime) throw new Error(`unsupported mime type: ${file.type}`);

  const { sb, actorUserId } = await requireActor("stats.screenshot.upload");

  const screenshotId = randomUUID();
  const storagePath = buildStoragePath(matchId, screenshotId, mime);

  // 1. Upload bytes via service role (server-side; no browser handshake).
  const arrayBuffer = await file.arrayBuffer();
  const { error: upErr } = await sb.storage
    .from("match-stat-screenshots")
    .upload(storagePath, Buffer.from(arrayBuffer), {
      contentType: mime,
      upsert: false,
    });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);

  // 2. Insert the screenshot row.
  const { error: insErr } = await sb.from("match_stat_screenshots").insert({
    id: screenshotId,
    match_id: matchId,
    storage_path: storagePath,
    uploaded_by: actorUserId,
    parse_status: "pending",
  });
  if (insErr) {
    // Best-effort cleanup: delete the uploaded blob if the DB row fails.
    await sb.storage.from("match-stat-screenshots").remove([storagePath]);
    throw new Error(`insert failed: ${insErr.message}`);
  }

  // 3. Fire-and-wait: dispatch parse immediately so the UI flips straight
  //    to 'parsed' (or 'pending' under OCR_DISABLED, or 'failed' on error).
  await triggerParseInternal(sb, screenshotId, matchId, storagePath, mime);

  revalidatePath(`/admin/match-days/${matchDayId}/stats-upload`);
}

async function triggerParseInternal(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  screenshotId: string,
  matchId: string,
  storagePath: string,
  mime: MimeType,
): Promise<void> {
  // Flip to 'parsing' so the UI can show the in-flight state if the caller
  // comes back mid-parse.
  await sb
    .from("match_stat_screenshots")
    .update({ parse_status: "parsing" })
    .eq("id", screenshotId);

  try {
    const imageBuffer = await downloadBuffer(sb, storagePath);
    const outcome = await parse(sb, {
      screenshotId,
      matchId,
      imageBuffer,
      mimeType: mime,
    });

    if (outcome.status === "disabled") {
      // Stay at pending; the review screen shows the manual-entry banner.
      await sb
        .from("match_stat_screenshots")
        .update({
          parse_status: "pending",
          notes: "OCR_DISABLED — manual entry required",
        })
        .eq("id", screenshotId);
      return;
    }

    if (outcome.status === "parsed") {
      await sb
        .from("match_stat_screenshots")
        .update({
          parse_status: "parsed",
          parsed_json: outcome.parsed,
          parsed_by_engine: outcome.engine,
          parsed_at: new Date().toISOString(),
        })
        .eq("id", screenshotId);
      return;
    }

    // failed
    await sb
      .from("match_stat_screenshots")
      .update({
        parse_status: "failed",
        notes: `parse failed: ${outcome.reason}`,
      })
      .eq("id", screenshotId);
  } catch (err) {
    const message =
      err instanceof BudgetExceededError
        ? `budget cap: ${err.message}`
        : (err as Error).message;
    await sb
      .from("match_stat_screenshots")
      .update({
        parse_status: "failed",
        notes: `parse error: ${message}`,
      })
      .eq("id", screenshotId);
  }
}

export async function rerunOcrAction(formData: FormData) {
  const screenshotId = String(formData.get("screenshotId") ?? "");
  const matchDayId = String(formData.get("matchDayId") ?? "");
  if (!screenshotId) throw new Error("screenshotId required");

  const { sb } = await requireActor("stats.ocr.rerun");

  const { data: row } = await sb
    .from("match_stat_screenshots")
    .select("match_id, storage_path")
    .eq("id", screenshotId)
    .maybeSingle();
  if (!row) throw new Error("screenshot not found");

  // Infer mime from extension.
  const ext = (row.storage_path as string).split(".").pop()?.toLowerCase();
  const mime: MimeType =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : "image/png";

  await triggerParseInternal(
    sb,
    screenshotId,
    row.match_id as string,
    row.storage_path as string,
    mime,
  );

  if (matchDayId)
    revalidatePath(`/admin/match-days/${matchDayId}/stats-upload`);
  revalidatePath(
    `/admin/match-days/${matchDayId}/stats-upload/${screenshotId}/review`,
  );
}

export async function confirmReviewAction(formData: FormData) {
  const screenshotId = String(formData.get("screenshotId") ?? "");
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const correctedJsonRaw = String(formData.get("correctedJson") ?? "");
  const homePlayerId = String(formData.get("homePlayerId") ?? "");
  const awayPlayerId = String(formData.get("awayPlayerId") ?? "");

  if (!screenshotId || !correctedJsonRaw || !homePlayerId || !awayPlayerId) {
    throw new Error("missing required review fields");
  }

  const correctedJson = JSON.parse(correctedJsonRaw);
  const { sb, actorUserId } = await requireActor("stats.screenshot.review");

  const input: ReviewInput = {
    screenshotId,
    correctedJson,
    homePlayerId,
    awayPlayerId,
  };
  await applyReview(sb, actorUserId, input);

  if (matchDayId)
    revalidatePath(`/admin/match-days/${matchDayId}/stats-upload`);
  revalidatePath(`/players/${homePlayerId}`);
  revalidatePath(`/players/${awayPlayerId}`);
  redirect(`/admin/match-days/${matchDayId}/stats-upload`);
}

export async function rejectReviewAction(formData: FormData) {
  const screenshotId = String(formData.get("screenshotId") ?? "");
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!screenshotId) throw new Error("screenshotId required");
  if (reason.length < 3) throw new Error("reason must be ≥ 3 chars");

  const { sb, actorUserId } = await requireActor("stats.screenshot.review");
  await rejectReview(sb, actorUserId, { screenshotId, reason });

  if (matchDayId)
    revalidatePath(`/admin/match-days/${matchDayId}/stats-upload`);
  redirect(`/admin/match-days/${matchDayId}/stats-upload`);
}
