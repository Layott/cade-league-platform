import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 10 — signed URL helpers for the private `squad-screenshots` bucket.
 *
 * Read: 5-minute TTL by default (tune via `ttlSeconds`).
 * Write: server issues a signed upload URL; browser POSTs the raw bytes.
 * Path layout: seasons/{seasonId}/players/{playerId}/weeks/{weekStartDate}/{uuid}.ext
 */

export const SQUAD_SCREENSHOTS_BUCKET = "squad-screenshots";

export function buildScreenshotPath(input: {
  seasonId: string;
  playerId: string;
  weekStartDate: string;
  filename: string; // caller-generated uuid + .png/.jpg/.webp
}): string {
  return `seasons/${input.seasonId}/players/${input.playerId}/weeks/${input.weekStartDate}/${input.filename}`;
}

export type SignedUploadResult = {
  path: string;
  signedUrl: string;
  token?: string;
};

export async function createSignedUpload(
  sb: SupabaseClient,
  path: string,
): Promise<SignedUploadResult> {
  const { data, error } = await sb.storage
    .from(SQUAD_SCREENSHOTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`signed upload failed: ${error?.message ?? "unknown"}`);
  }
  return { path: data.path, signedUrl: data.signedUrl, token: data.token };
}

export async function createSignedRead(
  sb: SupabaseClient,
  path: string,
  ttlSeconds = 300,
): Promise<string> {
  const { data, error } = await sb.storage
    .from(SQUAD_SCREENSHOTS_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    throw new Error(`signed read failed: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}
