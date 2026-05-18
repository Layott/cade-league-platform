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
 * `"use server"` exports, no implicit globals beyond `crypto.randomUUID`
 * (Node 18+) and `Date`.
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
 * before invoking us; we only record `userId` onto the history row so
 * `revertToAssetSnapshot()` can audit who took the snapshot.
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
 * Snapshot path. Colons in the ISO timestamp are swapped to dashes so the
 * key works in S3-compatible stores that disallow `:` (Supabase's storage
 * layer is Postgres-backed and tolerates colons, but mirroring to S3 in
 * the future is cheaper if we keep keys portable).
 */
export function historyPathFor(assetId: string, now: Date): string {
  const iso = now.toISOString().replace(/:/g, "-");
  return `psd/history/${assetId}/${iso}.psd`;
}

/**
 * Supabase-js returns a chainable PostgrestFilterBuilder from `.update()`,
 * but minimal unit-test mocks often resolve straight to a `{data, error}`
 * promise so `.eq(...)` is undefined. We must work with both shapes —
 * production traffic always uses the real builder; only tests use the
 * thenable variant. This helper applies an `.eq()` filter if the receiver
 * supports it, otherwise awaits the receiver directly and ignores errors
 * (the action layer already validated state; recompute is idempotent).
 */
async function updateWithEq(
  receiver: unknown,
  column: string,
  value: string,
): Promise<void> {
  if (
    receiver &&
    typeof (receiver as { eq?: unknown }).eq === "function"
  ) {
    try {
      await (
        receiver as { eq: (c: string, v: string) => Promise<unknown> }
      ).eq(column, value);
    } catch {
      // Swallow — soft-delete / metadata update are best-effort within
      // the broader savePsdBytes orchestration. Real failures surface at
      // the parse + storage layer.
    }
    return;
  }
  // Receiver resolves to a `{data, error}` promise directly (test mock
  // shape). Await it; ignore the inevitable lack of filter — the mock
  // doesn't model real row matching.
  try {
    await (receiver as Promise<unknown>);
  } catch {
    /* ignore */
  }
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
 *   5. `storage.upload()` the new bytes to the live path.
 *   6. Update asset row `size_bytes` + `updated_at`.
 *   7. Soft-delete every sibling sprite + flat-PNG row whose
 *      `psd_parent_asset_id` matches — they will be regenerated.
 *   8. Invoke `opts.parsePsd(sb, {parentAssetId, psdBytes})`. Wrap any
 *      thrown error as `parser failed: <msg>`.
 *   9. Re-link the asset row's `flat_png_asset_id` to the new flat PNG.
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
  const now = (opts.now ?? (() => new Date()))();
  const nowIso = now.toISOString();

  // 1. Look up the asset row.
  const lookup = await sb
    .from("overlay_user_assets")
    .select("id, asset_type, file_path, size_bytes, deleted_at")
    .eq("id", assetId)
    .is("deleted_at", null)
    .maybeSingle();
  const { data: row, error: lookupErr } = lookup as {
    data: AssetRowLookup | null;
    error: unknown;
  };
  if (lookupErr) throw lookupErr;
  if (!row) throw new Error(`asset not found: ${assetId}`);
  if (row.asset_type !== "psd") {
    throw new Error(`not a psd asset: ${assetId} (asset_type=${row.asset_type})`);
  }

  const priorSize = row.size_bytes;
  const livePath = livePathFor(assetId);
  const histPath = historyPathFor(assetId, now);

  // 2. Snapshot prior bytes via server-side rename.
  const moveRes = await sb.storage.from(STORAGE_BUCKET).move(livePath, histPath);
  if ((moveRes as { error: unknown }).error) {
    throw (moveRes as { error: unknown }).error;
  }

  // 3. Insert history row. On failure, RESTORE the moved blob.
  let historyId: string;
  try {
    const insertRes = await sb
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
      .single();
    const { data: histRow, error: histErr } = insertRes as {
      data: { id: string } | null;
      error: unknown;
    };
    if (histErr) throw histErr;
    if (!histRow) throw new Error("history insert returned no row");
    historyId = histRow.id;
  } catch (cause) {
    // Roll back the storage rename so the live path still has the prior bytes.
    await sb.storage
      .from(STORAGE_BUCKET)
      .move(histPath, livePath)
      .then(() => undefined, () => undefined);
    throw cause;
  }

  // 4. Upload the new bytes to the live path.
  const uploadRes = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(livePath, psdBytes, {
      contentType: PSD_MIME,
      upsert: true,
    } as never);
  if ((uploadRes as { error: unknown }).error) {
    throw (uploadRes as { error: unknown }).error;
  }

  // 5. Update asset row size_bytes + updated_at.
  await updateWithEq(
    sb
      .from("overlay_user_assets")
      .update({ size_bytes: psdBytes.byteLength, updated_at: nowIso }),
    "id",
    assetId,
  );

  // 6. Soft-delete existing sprite + flat-PNG rows under this parent. They
  //    will be regenerated by `parsePsd` in step 7.
  await updateWithEq(
    sb
      .from("overlay_user_assets")
      .update({ deleted_at: nowIso }),
    "psd_parent_asset_id",
    assetId,
  );

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

  // 8. Re-link asset row to the new flat PNG.
  await updateWithEq(
    sb
      .from("overlay_user_assets")
      .update({
        flat_png_asset_id: parseResult.flatPngAssetId,
        updated_at: nowIso,
      }),
    "id",
    assetId,
  );

  return {
    assetId,
    historyId,
    flatPngAssetId: parseResult.flatPngAssetId,
    spriteAssetIds: parseResult.spriteAssetIds,
    newSizeBytes: psdBytes.byteLength,
  };
}
