/**
 * Overlay Builder Wave 2B — Photopea bridge server module.
 *
 * Pure server function (no `"use server"` — sibling .types.ts holds Zod
 * schemas, the server-action wrapper lives in Task 5). Given PSD bytes
 * received from the Photopea iframe (validated by the action), this
 * module owns the round-trip persistence:
 *
 *   1. Snapshots the prior live PSD blob to a history path so the admin
 *      can revert via `revertToAssetSnapshot()` (Task 6).
 *   2. Writes the new bytes over the live path.
 *   3. Re-parses + re-stores the flat PNG + per-layer sprites (Wave 2A
 *      callback `parsePsdAndStoreSprites`, injected for test mockability).
 *   4. Re-links the asset row's `flat_png_asset_id` to the freshly
 *      generated flat PNG.
 *
 * SupabaseClient is the first argument and the parser is an injected
 * callback — both per CLAUDE.md mock-friendly pattern. No env reads, no
 * `"use server"` exports, no implicit globals beyond `Date`.
 *
 * Spec: docs/superpowers/specs/2026-05-17-overlay-builder-design.md §9.2
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { SavePsdInputSchema, type SavePsdInput, type SavePsdResult } from "./photopea-bridge.types";

/** Storage bucket holding every overlay-builder user asset. */
export const STORAGE_BUCKET = "overlay-user-assets";

/** MIME type Supabase Storage records for `.psd` blobs. */
const PSD_MIME = "image/vnd.adobe.photoshop";

/**
 * Actor metadata threaded from the server-action layer (Task 5). The
 * action layer already enforced `hasPermAsync('overlay.design.manage')`
 * before invoking us; we keep `userId` so the history row records who
 * took the snapshot, and `roles` for future audit hooks (currently
 * unused at the bridge layer but informs the action wrapper's logging).
 */
export type Actor = {
  readonly userId: string;
  readonly roles: readonly string[];
};

/**
 * Injected Wave 2A callback. Real binding is
 * `parsePsdAndStoreSprites(sb, {parentAssetId, psdBytes})` from
 * `./psd-parser` (re-exported by `./assets`). Tests pass a `vi.fn()`
 * so we never load `ag-psd` in unit tests.
 */
export type ParsePsd = (
  sb: SupabaseClient,
  args: { readonly parentAssetId: string; readonly psdBytes: Uint8Array },
) => Promise<{
  readonly flatPngAssetId: string;
  readonly spriteAssetIds: readonly string[];
}>;

/** Options bag passed to `savePsdBytes`. */
export type SavePsdOptions = {
  readonly input: SavePsdInput;
  readonly parsePsd: ParsePsd;
  /** Optional time source for deterministic tests. Defaults to `new Date()`. */
  readonly now?: () => Date;
};

/** Live path for the PSD blob inside the bucket. */
export function livePathFor(assetId: string): string {
  return `psd/${assetId}.psd`;
}

/**
 * Snapshot path. Both `:` and `.` from the ISO timestamp are swapped
 * to `-` so the key works in S3-compatible stores that disallow either
 * character (Supabase's storage layer is Postgres-backed and tolerates
 * them, but mirroring to S3 in the future is cheaper if we keep keys
 * portable). Example: `2026-05-18T11-54-00-123Z.psd`.
 */
export function historyPathFor(assetId: string, now: Date): string {
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `psd/history/${assetId}/${iso}.psd`;
}

/** Shape every Supabase query / mutation resolves to. */
type SbEnvelope<T> = {
  data: T | null;
  error: { message: string } | null;
};

/**
 * Throws if Supabase returned an error envelope; otherwise returns the
 * `data` field. Concentrates error checking in one place so callers can
 * read like ordinary code. Mirrors a pattern recommended for refactoring
 * `assets.ts` later but isolated to this module for now.
 */
function unwrapSupabase<T>(env: unknown, context: string): T | null {
  const e = env as SbEnvelope<T>;
  if (e?.error) {
    throw new Error(`${context}: ${e.error.message}`);
  }
  return e?.data ?? null;
}

type AssetRowLookup = {
  id: string;
  asset_type: string;
  file_path: string;
  size_bytes: number;
  deleted_at: string | null;
};

/**
 * Persist a Photopea-round-tripped PSD over an existing asset row.
 *
 * Sequence (each step rolls back the previous on failure where storage
 * + DB allow):
 *   1. Validate input via `SavePsdInputSchema` (defense in depth — the
 *      caller already validated, but we double-check magic bytes + size).
 *   2. Look up the live asset row; reject if missing / soft-deleted /
 *      wrong type.
 *   3. `storage.move()` live → history path (server-side rename, no
 *      double-write of bytes).
 *   4. Insert `overlay_user_asset_history` row pointing at the moved
 *      historical path. On failure, ROLLBACK the move so the live path
 *      is restored.
 *   5. `storage.upload()` the new bytes to the live path. On failure,
 *      reverse the move AND soft-delete the history row (which would
 *      otherwise point at bytes that are now at the live path again).
 *   6. Update asset row `size_bytes` + `updated_at` (best-effort log).
 *   7. Soft-delete every sibling sprite + flat-PNG row whose
 *      `psd_parent_asset_id` matches — they will be regenerated
 *      (best-effort log).
 *   8. Invoke `opts.parsePsd(sb, {parentAssetId, psdBytes})`. Wrap any
 *      thrown error as `parser failed: <msg>`.
 *   9. Re-link the asset row's `flat_png_asset_id` to the new flat PNG.
 *      LOAD-BEARING — on error, throw (caller must surface).
 *  10. Return `{assetId, historyId, flatPngAssetId, spriteAssetIds,
 *      newSizeBytes}`.
 */
export async function savePsdBytes(
  sb: SupabaseClient,
  actor: Actor,
  opts: SavePsdOptions,
): Promise<SavePsdResult> {
  const parsed = SavePsdInputSchema.parse(opts.input);
  const { assetId, psdBytes } = parsed;
  const now = opts.now ? opts.now() : new Date();
  const nowIso = now.toISOString();

  // 1. Look up the asset row. DB is the source of truth for the live path.
  const lookupRow = unwrapSupabase<AssetRowLookup>(
    await sb
      .from("overlay_user_assets")
      .select("id, asset_type, file_path, size_bytes, deleted_at")
      .eq("id", assetId)
      .is("deleted_at", null)
      .maybeSingle(),
    "asset lookup failed",
  );
  if (lookupRow == null) throw new Error(`asset not found: ${assetId}`);
  if (lookupRow.asset_type !== "psd") {
    throw new Error(
      `not a psd asset: ${assetId} (asset_type=${lookupRow.asset_type})`,
    );
  }

  const priorSize = lookupRow.size_bytes;
  // Prefer the canonical DB-stored path over our derived one — keeps the
  // bridge correct if the upload layer ever changes its path convention.
  const livePath = lookupRow.file_path || livePathFor(assetId);
  const histPath = historyPathFor(assetId, now);

  // 2. Snapshot prior bytes via server-side rename.
  const moveRes = (await sb.storage
    .from(STORAGE_BUCKET)
    .move(livePath, histPath)) as { error: { message: string } | null };
  if (moveRes.error != null) {
    throw new Error(`history move failed: ${moveRes.error.message}`);
  }

  // 3. Insert history row. On failure, RESTORE the moved blob.
  let historyId: string;
  try {
    const histRow = unwrapSupabase<{ id: string }>(
      await sb
        .from("overlay_user_asset_history")
        .insert({
          asset_id: assetId,
          storage_path: histPath,
          size_bytes: priorSize,
          mime_type: PSD_MIME,
          note: parsed.note ?? null,
          created_by: actor.userId,
        })
        .select("id")
        .single(),
      "history insert failed",
    );
    if (histRow == null) throw new Error("history insert returned no row");
    historyId = histRow.id;
  } catch (cause) {
    // Roll back the storage rename so the live path still has the prior bytes.
    await sb.storage
      .from(STORAGE_BUCKET)
      .move(histPath, livePath)
      .then(() => undefined, () => undefined);
    throw cause;
  }

  // 4. Upload the new bytes to the live path. On failure, undo both the
  //    history insert and the storage rename so the asset returns to the
  //    pre-call state.
  const uploadRes = (await sb.storage
    .from(STORAGE_BUCKET)
    .upload(livePath, psdBytes, {
      contentType: PSD_MIME,
      upsert: true,
    } as never)) as { error: { message: string } | null };
  if (uploadRes.error != null) {
    // Soft-delete the orphaned history row (the bytes it pointed at are
    // about to be moved back to the live path).
    await sb
      .from("overlay_user_asset_history")
      .update({ deleted_at: nowIso })
      .eq("id", historyId)
      .then(() => undefined, () => undefined);
    // Reverse the storage move so the live path is recoverable.
    await sb.storage
      .from(STORAGE_BUCKET)
      .move(histPath, livePath)
      .then(() => undefined, () => undefined);
    throw new Error(`upload failed: ${uploadRes.error.message}`);
  }

  // 5. Update asset row size_bytes + updated_at. BEST-EFFORT — the live
  //    path bytes are already correct; a metadata drift is recoverable.
  const sizeUpdate = (await sb
    .from("overlay_user_assets")
    .update({ size_bytes: psdBytes.byteLength, updated_at: nowIso })
    .eq("id", assetId)) as SbEnvelope<null>;
  if (sizeUpdate?.error != null) {
    console.warn(
      `[photopea-bridge] size_bytes update failed (asset ${assetId}): ${sizeUpdate.error.message}`,
    );
  }

  // 6. Soft-delete existing sprite + flat-PNG rows under this parent. They
  //    will be regenerated by `parsePsd` in step 7. BEST-EFFORT — ghosts
  //    are visible to consumers but the parser will re-create the canonical
  //    set; admin can clean up via UI.
  //    TODO: hard-delete soft-deleted sibling rows older than 30d via cron.
  const spriteDelete = (await sb
    .from("overlay_user_assets")
    .update({ deleted_at: nowIso })
    .eq("psd_parent_asset_id", assetId)) as SbEnvelope<null>;
  if (spriteDelete?.error != null) {
    console.warn(
      `[photopea-bridge] sprite soft-delete failed (parent ${assetId}): ${spriteDelete.error.message}`,
    );
  }

  // 7. Re-parse + re-store flat PNG + sprites. Wrap parser failure with
  //    a stable error message so the action layer can surface it.
  let parseResult: Awaited<ReturnType<ParsePsd>>;
  try {
    parseResult = await opts.parsePsd(sb, {
      parentAssetId: assetId,
      psdBytes,
    });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    const wrapped = new Error(`parser failed: ${msg}`);
    (wrapped as { cause?: unknown }).cause = cause;
    throw wrapped;
  }

  // 8. Re-link asset row to the new flat PNG. LOAD-BEARING — if this
  //    silently fails, the asset row points at the freshly soft-deleted
  //    prior flat PNG and the UI renders broken thumbnails.
  const relink = (await sb
    .from("overlay_user_assets")
    .update({
      flat_png_asset_id: parseResult.flatPngAssetId,
      updated_at: nowIso,
    })
    .eq("id", assetId)) as SbEnvelope<null>;
  if (relink?.error != null) {
    throw new Error(
      `flat_png_asset_id relink failed: ${relink.error.message}`,
    );
  }

  return {
    assetId,
    historyId,
    flatPngAssetId: parseResult.flatPngAssetId,
    spriteAssetIds: parseResult.spriteAssetIds,
    newSizeBytes: psdBytes.byteLength,
  };
}
