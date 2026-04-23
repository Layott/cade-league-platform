import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Plan 48 — signed-upload helper for the `overlay-assets` public bucket.
 *
 * The admin broadcast panel uploads images (player photos, ad posters,
 * shield logos) + videos (ads, transitions). Callers go through the
 * `/api/broadcast/asset-upload-url` route which gates on `broadcast.trigger`
 * and returns a signed PUT URL + the public URL that will serve the asset
 * once the PUT completes. The caller then PUTs the File directly from the
 * browser, avoiding any server-side file buffering.
 *
 * Size + extension limits are enforced server-side so we cannot be tricked
 * into minting a signed URL for a 500 MB .exe.
 */

export const BUCKET = "overlay-assets" as const;

export const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"] as const;
export const VIDEO_EXTS = ["mp4", "webm"] as const;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB

export type UploadKind = "image" | "video";

export class AssetUploadError extends Error {
  readonly code:
    | "perm_denied"
    | "bad_kind"
    | "bad_filename"
    | "bad_extension"
    | "too_large"
    | "storage_error";
  constructor(
    code: AssetUploadError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "AssetUploadError";
  }
}

export type OverlayUploadUrlResult = {
  uploadUrl: string;
  token: string;
  publicUrl: string;
  storagePath: string;
};

function extFromFilename(filename: string): string | null {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(filename.trim());
  if (!m) return null;
  return m[1].toLowerCase();
}

function sanitizeStem(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, "");
  const clean = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean.slice(0, 60) || "asset";
}

function validateKind(
  kind: string,
  filename: string,
  bytes: number,
): { kind: UploadKind; ext: string } {
  if (kind !== "image" && kind !== "video") {
    throw new AssetUploadError("bad_kind", `kind must be image|video, got ${kind}`);
  }
  if (!filename || typeof filename !== "string") {
    throw new AssetUploadError("bad_filename", "filename required");
  }
  const ext = extFromFilename(filename);
  if (!ext) {
    throw new AssetUploadError("bad_filename", "filename needs an extension");
  }
  const allowed: readonly string[] = kind === "image" ? IMAGE_EXTS : VIDEO_EXTS;
  if (!allowed.includes(ext)) {
    throw new AssetUploadError(
      "bad_extension",
      `extension .${ext} not allowed for ${kind} (allowed: ${allowed.join(", ")})`,
    );
  }
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new AssetUploadError("too_large", "bytes required + positive");
  }
  if (bytes > max) {
    throw new AssetUploadError(
      "too_large",
      `${kind} max ${Math.floor(max / (1024 * 1024))}MB (got ${Math.ceil(bytes / (1024 * 1024))}MB)`,
    );
  }
  return { kind: kind as UploadKind, ext };
}

export function buildStoragePath(
  kind: UploadKind,
  filename: string,
  now: Date = new Date(),
): string {
  const ext = extFromFilename(filename) ?? "bin";
  const stem = sanitizeStem(filename);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  // Random suffix avoids collisions when two admins upload the same-named
  // file within the same minute.
  const rand = Math.random().toString(36).slice(2, 8);
  return `${kind}s/${yyyy}/${mm}/${Date.now()}-${rand}-${stem}.${ext}`;
}

export async function requestOverlayUploadUrl(opts: {
  sb: SupabaseClient;
  actor: Actor;
  kind: string;
  filename: string;
  bytes: number;
}): Promise<OverlayUploadUrlResult> {
  const { sb, actor, kind, filename, bytes } = opts;

  try {
    await requirePermAsync(sb, actor, "broadcast.trigger");
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new AssetUploadError("perm_denied", "missing broadcast.trigger");
    }
    throw e;
  }

  const validated = validateKind(kind, filename, bytes);
  const storagePath = buildStoragePath(validated.kind, filename);

  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !data) {
    throw new AssetUploadError(
      "storage_error",
      `signed upload failed: ${error?.message ?? "unknown"}`,
    );
  }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(storagePath);

  return {
    uploadUrl: data.signedUrl,
    token: data.token,
    publicUrl: pub.publicUrl,
    storagePath,
  };
}
