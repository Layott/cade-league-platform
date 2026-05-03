"use client";

/**
 * Plan 53 Task 13 — Upload widget (Mode A auto-strip + Mode B multi/ZIP).
 *
 * Lazy-loaded by <PlayerPhotoModal>. Two upload modes:
 *
 *   Mode A (single): admin picks one image, the widget lazy-imports
 *   `@imgly/background-removal` to strip the bg, then `cropToCardPng`
 *   from `@/lib/photo-card-crop` to derive a 4:5 card crop. Produces 4
 *   files for upload: headshot_100, headshot_100_nobg, card_100,
 *   card_100_nobg.
 *
 *   Mode B (multi-file or ZIP): admin drops 1..6 PNGs that already
 *   match the `_process.py` filename contract (<variant>_<NN>[_nobg].ext),
 *   OR a single .zip. ZIPs are unpacked client-side via lazy-imported
 *   JSZip + filtered through the same regex.
 *
 * Flow per mode:
 *   1. Build `uploadFiles[]` = `{name, blob}[]`.
 *   2. POST /api/broadcast/v2/photos/uploads/url → uploadId + signed PUT URLs.
 *   3. PUT each blob to its signed URL (Content-Type: image/png).
 *   4. POST /api/broadcast/v2/photos/uploads/[id]/finalize with `variants`
 *      map (`headshot|card|fullbody [+ _nobg]` → publicUrl).
 *   5. Call `props.onComplete()` so the modal can refetch the gallery.
 *
 * The "100" filename suffix is a placeholder — `finalize` reassigns the
 * actual pose_index server-side (>=100, monotonic per player).
 *
 * Heavy deps (`@imgly/background-removal` ~30MB ONNX model + `jszip`)
 * are dynamic-imported inside `handleSubmit` so the modal bundle stays
 * tiny and the model only downloads on first Mode-A submit.
 */

import { useState } from "react";
import { cropToCardPng } from "@/lib/photo-card-crop";

type UploadMode = "single" | "multi";

type Status =
  | "idle"
  | "processing"
  | "uploading"
  | "finalizing"
  | "done"
  | "failed";

type UploadFile = { name: string; blob: Blob };

type UrlResponse = {
  uploadId: string;
  uploads: {
    storagePath: string;
    uploadUrl: string;
    token: string;
    publicUrl: string;
  }[];
};

const VARIANT_RE = /^(headshot|card|fullbody)_(\d{2,3})(_nobg)?\.(png|jpg|jpeg|webp)$/i;

/**
 * Pull the canonical variants_json key out of a filename. The gallery
 * feed (T11) reads keys `headshot`, `headshot_nobg`, `card`, `card_nobg`,
 * `fullbody`, `fullbody_nobg` — anything else falls back to the raw
 * filename to keep the JSON value addressable but downgrades coverage.
 */
function variantKeyFromFilename(filename: string): string {
  const m = VARIANT_RE.exec(filename);
  if (!m) return filename;
  const variant = m[1].toLowerCase();
  const nobg = m[3] ? "_nobg" : "";
  return `${variant}${nobg}`;
}

export function PlayerPhotoUploadWidget(props: {
  playerId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<UploadMode>("single");
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setPreviewUrl(null);
    try {
      let uploadFiles: UploadFile[] = [];

      if (mode === "single") {
        if (files.length !== 1) {
          throw new Error("Single mode needs exactly 1 file");
        }
        setStatus("processing");
        const { removeBackground } = await import("@imgly/background-removal");
        const stripped: Blob = await removeBackground(files[0]);
        const card: Blob = await cropToCardPng(stripped);
        uploadFiles = [
          { name: "headshot_100.png", blob: files[0] },
          { name: "headshot_100_nobg.png", blob: stripped },
          { name: "card_100.png", blob: card },
          { name: "card_100_nobg.png", blob: card },
        ];
        setPreviewUrl(URL.createObjectURL(stripped));
      } else {
        if (files.length === 0) {
          throw new Error("Multi mode needs 1+ files");
        }
        if (
          files.length === 1 &&
          files[0].name.toLowerCase().endsWith(".zip")
        ) {
          setStatus("processing");
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(files[0]);
          const entries: UploadFile[] = [];
          for (const path in zip.files) {
            const f = zip.files[path];
            if (f.dir) continue;
            // Strip directory prefix — the regex matches the basename.
            const basename = path.split("/").pop() ?? path;
            const m = VARIANT_RE.exec(basename);
            if (m) {
              const blob = await f.async("blob");
              entries.push({ name: m[0], blob });
            }
          }
          if (entries.length === 0) {
            throw new Error(
              "ZIP has no files matching <variant>_<NN>[_nobg].<ext>",
            );
          }
          uploadFiles = entries;
        } else {
          // Validate filenames client-side so we surface a clean error
          // before round-tripping through the API (which will also reject).
          for (const f of files) {
            if (!VARIANT_RE.test(f.name)) {
              throw new Error(
                `${f.name}: filename must match <variant>_<NN>[_nobg].<ext>`,
              );
            }
          }
          uploadFiles = files.map((f) => ({ name: f.name, blob: f }));
        }
      }

      setStatus("uploading");
      const urlRes = await fetch("/api/broadcast/v2/photos/uploads/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: props.playerId,
          mode,
          files: uploadFiles.map((u) => ({
            filename: u.name,
            bytes: u.blob.size,
          })),
        }),
      });
      if (!urlRes.ok) {
        let msg = `URL request failed (${urlRes.status})`;
        try {
          const j = (await urlRes.json()) as {
            error?: string;
            message?: string;
          };
          if (j.message) msg = j.message;
          else if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const { uploadId, uploads } = (await urlRes.json()) as UrlResponse;

      for (let i = 0; i < uploadFiles.length; i++) {
        const target = uploads[i];
        const put = await fetch(target.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": uploadFiles[i].blob.type || "image/png",
          },
          body: uploadFiles[i].blob,
        });
        if (!put.ok) {
          throw new Error(
            `PUT ${uploadFiles[i].name} failed (${put.status})`,
          );
        }
      }

      setStatus("finalizing");
      const variants: Record<string, string> = {};
      for (let i = 0; i < uploadFiles.length; i++) {
        const key = variantKeyFromFilename(uploadFiles[i].name);
        variants[key] = uploads[i].publicUrl;
      }

      const finRes = await fetch(
        `/api/broadcast/v2/photos/uploads/${uploadId}/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variants }),
        },
      );
      if (!finRes.ok) {
        let msg = `finalize failed (${finRes.status})`;
        try {
          const j = (await finRes.json()) as {
            error?: string;
            message?: string;
          };
          if (j.message) msg = j.message;
          else if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }

      setStatus("done");
      props.onComplete();
    } catch (e) {
      setStatus("failed");
      setError((e as Error).message);
    }
  }

  const submitDisabled = files.length === 0 || status === "processing" ||
    status === "uploading" || status === "finalizing";

  return (
    <div
      className="mt-4 rounded border border-white/20 bg-black/50 p-4"
      data-testid="player-photo-upload-widget"
    >
      <h4 className="mb-2 text-sm font-semibold">Upload new photo</h4>
      <div className="mb-2 flex gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={mode === "single"}
            onChange={() => setMode("single")}
          />{" "}
          Single (auto-strip)
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={mode === "multi"}
            onChange={() => setMode("multi")}
          />{" "}
          Multi / ZIP from _process.py
        </label>
      </div>
      <input
        type="file"
        accept={
          mode === "single"
            ? "image/png,image/jpeg,image/webp"
            : "image/png,image/jpeg,image/webp,application/zip,.zip"
        }
        multiple={mode === "multi"}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="block w-full text-xs"
      />
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="background-stripped preview"
          className="mt-2 max-h-40 rounded border border-white/10"
        />
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitDisabled}
          className="rounded bg-[#6bcd06] px-3 py-1 text-xs text-black disabled:opacity-50"
        >
          {status === "idle" ? "Process & upload" : status}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded border border-white/20 px-3 py-1 text-xs hover:border-white/40"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p
          className="mt-2 text-xs text-[#fe036d]"
          data-testid="upload-widget-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
