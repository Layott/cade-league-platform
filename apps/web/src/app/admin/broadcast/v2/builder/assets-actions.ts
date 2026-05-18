"use server";

import { revalidatePath } from "next/cache";
import { uploadPsd, PsdUploadError } from "@/server/overlays/builder/assets";
import { gate } from "./assets-actions-gate";
import {
  MAX_PSD_BYTES,
  SOFT_WARN_PSD_BYTES,
  type UploadPsdResponse,
} from "./assets-schemas";

/**
 * Wave 2A — admin server action: upload a PSD.
 *
 * Form fields:
 *   - file (File) — required, .psd extension, <= 100 MB.
 *
 * Returns a discriminated-union response so the client can switch on
 * `res.ok` without throwing. Codes map 1:1 to the surfaces the UI
 * needs to handle (missing_file, bad_extension, too_large,
 * parse_failed, storage_failed, db_failed, forbidden, rate_limited).
 *
 * Synchronous parse: ag-psd in-process inside the action. For files
 * up to 100 MB this completes in <30 s on Vercel Functions cold-start;
 * a future Wave 2B may push parsing to a queued background worker.
 */
export async function uploadPsdAction(formData: FormData): Promise<UploadPsdResponse> {
  let actorBox: Awaited<ReturnType<typeof gate>>;
  try {
    actorBox = await gate();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/^Forbidden/.test(msg)) {
      return { ok: false, code: "forbidden", error: msg };
    }
    if (/rate_limited/.test(msg)) {
      return { ok: false, code: "rate_limited", error: "Too many writes; slow down." };
    }
    return { ok: false, code: "unknown", error: msg };
  }
  const { sb, actor } = actorBox;

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, code: "missing_file", error: "Form field `file` is required" };
  }
  if (!file.name.toLowerCase().endsWith(".psd")) {
    return { ok: false, code: "bad_extension", error: `Expected .psd, got ${file.name}` };
  }
  if (file.size > MAX_PSD_BYTES) {
    return {
      ok: false,
      code: "too_large",
      error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max 100 MB`,
    };
  }

  // Pull bytes server-side; File.arrayBuffer is safe inside server actions.
  let bytes: Buffer;
  try {
    const ab = await file.arrayBuffer();
    bytes = Buffer.from(ab);
  } catch (cause) {
    return {
      ok: false,
      code: "unknown",
      error: cause instanceof Error ? cause.message : "could not read upload",
    };
  }

  try {
    const r = await uploadPsd(sb, {
      bytes,
      filename: file.name,
      ownerUserId: actor.userId,
    });
    revalidatePath("/admin/broadcast/v2/builder/assets");
    return {
      ok: true,
      parentAssetId: r.parentAssetId,
      flatAssetId: r.flatAssetId,
      layerAssetIds: r.layerAssetIds,
      canvasWidth: r.canvasWidth,
      canvasHeight: r.canvasHeight,
      softWarnLarge: file.size > SOFT_WARN_PSD_BYTES,
    };
  } catch (cause) {
    if (cause instanceof PsdUploadError || (cause instanceof Error && cause.name === "PsdUploadError")) {
      // PsdUploadError messages cover three classes: parse, storage, DB.
      // We map to the most precise code we can infer from the message.
      const msg = (cause as Error).message ?? "PSD upload failed";
      const code: "storage_failed" | "db_failed" | "parse_failed" =
        /storage/i.test(msg)
          ? "storage_failed"
          : /db|insert|database/i.test(msg)
            ? "db_failed"
            : "parse_failed";
      return { ok: false, code, error: msg };
    }
    return {
      ok: false,
      code: "unknown",
      error: cause instanceof Error ? cause.message : "PSD upload failed",
    };
  }
}
