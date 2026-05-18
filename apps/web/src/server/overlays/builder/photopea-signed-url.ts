/**
 * Wave 2B — signed-URL helper for the Photopea bootstrap.
 *
 * Photopea's `app.open` command needs a URL it can fetch from
 * its own origin. Our `overlay-user-assets` bucket is private,
 * so we mint a short-lived signed URL (60s) at page-render time
 * and inject it into the bootstrap so Photopea can download the
 * PSD into its workspace.
 *
 * 60 seconds is the upper bound — the iframe bootstrap fires
 * `app.open` within ~200ms of load, so a leaked URL has at most
 * a single-digit-second usable window before it expires.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2 + §12
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "overlay-user-assets";
const SIGNED_URL_TTL_SECONDS = 60;

export async function mintPsdSignedUrl(
  sb: SupabaseClient,
  args: { assetId: string },
): Promise<string> {
  const { data: assetRow, error: lookupErr } = await sb
    .from("overlay_user_assets")
    .select("id, asset_type, file_path, deleted_at")
    .eq("id", args.assetId)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookupErr) {
    throw new Error(`asset lookup failed: ${lookupErr.message}`);
  }
  if (!assetRow) {
    throw new Error(`asset not found: ${args.assetId}`);
  }
  const row = assetRow as {
    asset_type: string;
    file_path: string;
  };
  if (row.asset_type !== "psd") {
    throw new Error(`not a psd asset (got ${row.asset_type}): ${args.assetId}`);
  }

  const { data, error: signErr } = await sb.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(row.file_path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !data?.signedUrl) {
    throw new Error(
      `signed url failed: ${signErr?.message ?? "no signedUrl"}`,
    );
  }
  return data.signedUrl;
}
