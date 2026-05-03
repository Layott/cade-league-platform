import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Plan 53 — signed-PUT upload + finalize for the `player-photos` bucket.
 *
 * Two-phase flow mirrors `asset_upload.ts` (Plan 48):
 *   1. `requestPlayerPhotoUploadUrls` — perm-gates on `overlay.design.manage`,
 *      validates filenames + sizes + count, inserts a `player_photo_uploads`
 *      row with status `uploading`, mints one signed PUT URL per file under
 *      `raw/<playerId>/<uploadId>/<filename>`, and returns the uploadId +
 *      signed-URL list. The browser PUTs directly — no server buffering.
 *   2. `finalizePlayerPhotoUpload` — perm-gates again, computes the next
 *      `pose_index` (>=100 to stay above the 6 manifest poses), updates the
 *      row with `status='ready'` + `variants_json` + `processed_at`.
 *
 * Filename contract for `mode === 'multi'`: `<variant>_<NN>[_nobg].<ext>`
 *   variant ∈ {headshot, card, fullbody}; NN = 2-3 digits; ext per ALLOWED_EXTS.
 * For `mode === 'single'` (auto-strip path) the regex is relaxed because the
 * server's @imgly pipeline (T13) re-derives the variant filenames before
 * finalize.
 */

export const BUCKET = "player-photos" as const;
export const ALLOWED_EXTS = ["png", "jpg", "jpeg", "webp"] as const;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024; // 60 MB

export class PlayerPhotoUploadError extends Error {
  readonly code:
    | "perm_denied"
    | "bad_mode"
    | "bad_filename"
    | "bad_extension"
    | "too_large"
    | "too_many_files"
    | "storage_error";
  constructor(
    code: PlayerPhotoUploadError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "PlayerPhotoUploadError";
  }
}

const FILENAME_RE =
  /^(headshot|card|fullbody)_(\d{2,3})(_nobg)?\.(png|jpg|jpeg|webp)$/i;

function ext(filename: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(filename);
  return m ? m[1].toLowerCase() : "";
}

export async function requestPlayerPhotoUploadUrls(opts: {
  sb: SupabaseClient;
  actor: Actor;
  playerId: string;
  mode: "single" | "multi";
  files: { filename: string; bytes: number }[];
}): Promise<{
  uploadId: string;
  uploads: {
    storagePath: string;
    uploadUrl: string;
    token: string;
    publicUrl: string;
  }[];
}> {
  const { sb, actor, playerId, mode, files } = opts;
  await requirePermAsync(sb, actor, "overlay.design.manage");

  if (mode !== "single" && mode !== "multi") {
    throw new PlayerPhotoUploadError("bad_mode", `bad mode ${mode}`);
  }
  if (mode === "single" && files.length > 4) {
    throw new PlayerPhotoUploadError(
      "too_many_files",
      "single mode max 4 files",
    );
  }
  if (mode === "multi" && files.length > 6) {
    throw new PlayerPhotoUploadError(
      "too_many_files",
      "multi mode max 6 files",
    );
  }

  let total = 0;
  for (const f of files) {
    if (mode === "multi" && !FILENAME_RE.test(f.filename)) {
      throw new PlayerPhotoUploadError(
        "bad_filename",
        `${f.filename} not in <variant>_<NN>[_nobg].<ext> form`,
      );
    }
    const e = ext(f.filename);
    if (!(ALLOWED_EXTS as readonly string[]).includes(e)) {
      throw new PlayerPhotoUploadError(
        "bad_extension",
        `${e} not allowed (allowed: ${ALLOWED_EXTS.join(", ")})`,
      );
    }
    if (f.bytes <= 0 || f.bytes > MAX_FILE_BYTES) {
      throw new PlayerPhotoUploadError(
        "too_large",
        `too_large: file ${f.filename} > ${MAX_FILE_BYTES} bytes`,
      );
    }
    total += f.bytes;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new PlayerPhotoUploadError(
      "too_large",
      `too_large: total ${total} > ${MAX_TOTAL_BYTES} bytes`,
    );
  }

  const { data: upRow, error: upErr } = await sb
    .from("player_photo_uploads")
    .insert({
      player_id: playerId,
      status: "uploading",
      upload_mode: mode,
      uploaded_by: actor.userId,
      storage_paths: {},
    })
    .select("id")
    .single();
  if (upErr || !upRow) {
    throw new PlayerPhotoUploadError(
      "storage_error",
      upErr?.message ?? "insert row failed",
    );
  }
  const uploadId = (upRow as { id: string }).id;

  const uploads: {
    storagePath: string;
    uploadUrl: string;
    token: string;
    publicUrl: string;
  }[] = [];
  for (const f of files) {
    const storagePath = `raw/${playerId}/${uploadId}/${f.filename}`;
    const { data, error } = await sb.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);
    if (error || !data) {
      throw new PlayerPhotoUploadError(
        "storage_error",
        error?.message ?? "sign failed",
      );
    }
    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
    uploads.push({
      storagePath,
      uploadUrl: data.signedUrl,
      token: data.token,
      publicUrl: pub.publicUrl,
    });
  }
  return { uploadId, uploads };
}

export async function finalizePlayerPhotoUpload(opts: {
  sb: SupabaseClient;
  actor: Actor;
  uploadId: string;
  variants: Record<string, string>;
}): Promise<{ poseIndex: number }> {
  const { sb, actor, uploadId, variants } = opts;
  await requirePermAsync(sb, actor, "overlay.design.manage");

  const { data: row, error: rowErr } = await sb
    .from("player_photo_uploads")
    .select("player_id, upload_mode")
    .eq("id", uploadId)
    .single();
  if (rowErr || !row) {
    throw new PlayerPhotoUploadError(
      "storage_error",
      "upload row not found",
    );
  }

  const playerId = (row as { player_id: string }).player_id;
  const { data: existingPoses } = await sb
    .from("player_photo_uploads")
    .select("pose_index")
    .eq("player_id", playerId)
    .not("pose_index", "is", null);
  const maxPose = ((existingPoses ?? []) as { pose_index: number | null }[])
    .reduce((m, r) => Math.max(m, r.pose_index ?? 99), 99);
  const nextPose = Math.max(100, maxPose + 1);

  const { error } = await sb
    .from("player_photo_uploads")
    .update({
      status: "ready",
      pose_index: nextPose,
      variants_json: variants,
      processed_at: new Date().toISOString(),
    })
    .eq("id", uploadId);
  if (error) {
    throw new PlayerPhotoUploadError("storage_error", error.message);
  }
  return { poseIndex: nextPose };
}
