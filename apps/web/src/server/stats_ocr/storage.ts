import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 14 — signed-URL helpers for the private `match-stat-screenshots`
 * bucket. The bucket has no public policy; every browser interaction
 * (upload, view in review) goes through a short-lived signed URL minted
 * by the server.
 *
 * Path format: matches/{matchId}/{screenshotId}.{ext}
 *
 * The extension comes from the MIME type so we never write a file whose
 * name-inferred type disagrees with its content-type on the HTTP PUT.
 */

export const BUCKET = "match-stat-screenshots";

export type MimeType = "image/png" | "image/jpeg" | "image/webp";

export function extForMime(mime: MimeType): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
  }
}

export function buildStoragePath(
  matchId: string,
  screenshotId: string,
  mime: MimeType,
): string {
  return `matches/${matchId}/${screenshotId}.${extForMime(mime)}`;
}

export interface SignedUpload {
  url: string;
  token: string;
  path: string;
}

export async function createSignedUpload(
  sb: SupabaseClient,
  matchId: string,
  screenshotId: string,
  mime: MimeType,
): Promise<SignedUpload> {
  const path = buildStoragePath(matchId, screenshotId, mime);
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(
      `createSignedUpload failed: ${error?.message ?? "no data"}`,
    );
  }
  return { url: data.signedUrl, token: data.token, path };
}

/**
 * Short-lived read URL for the admin review screen. TTL defaults to 5 min;
 * reviewing beyond that clicks a "Refresh image" button (see review page).
 * Never cache this URL — each refresh mints a new token.
 */
export async function createSignedRead(
  sb: SupabaseClient,
  path: string,
  ttlSeconds = 300,
): Promise<string> {
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    throw new Error(
      `createSignedRead failed: ${error?.message ?? "no data"}`,
    );
  }
  return data.signedUrl;
}

/**
 * Download the stored file as a Buffer for server-side OCR dispatch. We pull
 * the bytes into memory because the Anthropic SDK expects a base64 string
 * and Tesseract wants a Buffer — streaming buys nothing for ≤10 MB PNGs.
 */
export async function downloadBuffer(
  sb: SupabaseClient,
  path: string,
): Promise<Buffer> {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) {
    throw new Error(`downloadBuffer failed: ${error?.message ?? "no data"}`);
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
