"use client";

import { useRef, useState } from "react";

/**
 * Plan 48 — inline overlay-asset uploader.
 *
 * Flow:
 *   1. Admin clicks "Upload <kind>" → hidden <input type="file"> opens.
 *   2. On file select: POST /api/broadcast/asset-upload-url with the
 *      filename + bytes + kind → server validates perms + size + ext,
 *      returns { uploadUrl, publicUrl }.
 *   3. PUT the File directly to `uploadUrl` (Supabase Storage).
 *   4. Call onUploaded(publicUrl) so the caller can stuff the URL into
 *      the payload text field.
 *
 * Errors bubble into an inline banner. Progress is binary (uploading /
 * done) because browser PUT progress via fetch has no streaming API.
 */

export type AssetUploaderProps = {
  kind: "image" | "video";
  label?: string;
  onUploaded: (publicUrl: string) => void;
  /** Accepts a testid prefix; appended to child elements. */
  "data-testid"?: string;
  /** When true, renders a tiny "Copy URL" button after upload so admins
   * pasting URLs into a raw JSON textarea can grab the minted URL. */
  showCopy?: boolean;
  className?: string;
};

const ACCEPT: Record<"image" | "video", string> = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/webm",
};

export function AssetUploader({
  kind,
  label,
  onUploaded,
  showCopy = false,
  className = "",
  ...rest
}: AssetUploaderProps) {
  const testId = rest["data-testid"];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">(
    "idle",
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("uploading");
    setFileName(file.name);
    setError(null);
    setPublicUrl(null);
    try {
      const metaRes = await fetch("/api/broadcast/asset-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          filename: file.name,
          bytes: file.size,
        }),
      });
      if (!metaRes.ok) {
        const msg = await metaRes.text().catch(() => metaRes.statusText);
        throw new Error(`sign failed (${metaRes.status}): ${msg}`);
      }
      const meta = (await metaRes.json()) as {
        uploadUrl: string;
        publicUrl: string;
        storagePath: string;
      };
      const put = await fetch(meta.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!put.ok) {
        throw new Error(`upload failed (${put.status})`);
      }
      setPublicUrl(meta.publicUrl);
      setStatus("done");
      onUploaded(meta.publicUrl);
    } catch (err) {
      setStatus("error");
      setError((err as Error).message || "upload failed");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleCopy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
    } catch {
      // clipboard api is sometimes blocked; swallow, the URL is visible in
      // the status line anyway.
    }
  }

  return (
    <div
      className={
        "rounded-sm border border-[var(--ink-4)]/70 bg-[var(--ink-3)]/40 p-2 " +
        className
      }
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={status === "uploading"}
          className="rounded-sm border border-[var(--signal)]/60 bg-transparent px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:bg-[var(--signal)]/10 disabled:opacity-50"
          data-testid={testId ? `${testId}-button` : undefined}
        >
          {status === "uploading"
            ? "Uploading…"
            : `Upload ${label ?? kind}`}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT[kind]}
          onChange={handleChange}
          className="hidden"
          data-testid={testId ? `${testId}-input` : undefined}
        />
        {fileName && status !== "error" ? (
          <span className="truncate text-[10px] text-[var(--chalk-3)]">
            {fileName}
          </span>
        ) : null}
        {showCopy && publicUrl ? (
          <button
            type="button"
            onClick={handleCopy}
            className="ml-auto rounded-sm border border-[var(--ink-4)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
            data-testid={testId ? `${testId}-copy` : undefined}
          >
            Copy URL
          </button>
        ) : null}
      </div>
      {status === "done" && publicUrl ? (
        <div
          className="mt-1 truncate text-[10px] text-[var(--signal)]"
          data-testid={testId ? `${testId}-url` : undefined}
          title={publicUrl}
        >
          ✓ {publicUrl}
        </div>
      ) : null}
      {status === "error" && error ? (
        <div
          className="mt-1 text-[10px] text-[var(--flare)]"
          data-testid={testId ? `${testId}-error` : undefined}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
