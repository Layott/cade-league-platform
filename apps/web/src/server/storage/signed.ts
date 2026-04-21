import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrivateBucket } from "./paths";

/**
 * Plan 13B — signed URL helpers for the four private plan-13B buckets.
 *
 * Mirrors the `squads/storage.ts` pattern. Always pass a service-role
 * SupabaseClient — these helpers never enforce perms, they just wrap the
 * Storage API. Callers must `requirePermAsync` before reaching here.
 */

export class SignedStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignedStorageError";
  }
}

export type SignedUploadResult = {
  path: string;
  signedUrl: string;
  token?: string;
};

export async function createSignedUpload(
  sb: SupabaseClient,
  bucket: PrivateBucket,
  path: string,
): Promise<SignedUploadResult> {
  const { data, error } = await sb.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new SignedStorageError(
      `signed upload (${bucket}): ${error?.message ?? "unknown"}`,
    );
  }
  return { path: data.path, signedUrl: data.signedUrl, token: data.token };
}

export async function createSignedRead(
  sb: SupabaseClient,
  bucket: PrivateBucket,
  path: string,
  ttlSeconds = 300,
): Promise<string> {
  const { data, error } = await sb.storage
    .from(bucket)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    throw new SignedStorageError(
      `signed read (${bucket}): ${error?.message ?? "unknown"}`,
    );
  }
  return data.signedUrl;
}

/**
 * Best-effort: return a signed read URL, or null if signing fails. Use on
 * detail pages where an asset being missing should not crash the page.
 */
export async function trySignedRead(
  sb: SupabaseClient,
  bucket: PrivateBucket,
  path: string | null | undefined,
  ttlSeconds = 300,
): Promise<string | null> {
  if (!path) return null;
  try {
    return await createSignedRead(sb, bucket, path, ttlSeconds);
  } catch {
    return null;
  }
}
