"use client";

import { useState } from "react";

/**
 * Plan 13B — reusable file-upload widget that (1) calls a passed server
 * action to mint a signed upload URL, (2) PUTs the file to Supabase
 * Storage directly from the browser, (3) emits a hidden `<input
 * name={fieldName}>` with the resulting storage path so the parent form
 * submits the already-uploaded key.
 *
 * 50 MB file cap (spec §constraints).
 */

const MAX_BYTES = 50 * 1024 * 1024;

type RequestUpload = (input: {
  extension: string;
  filename?: string;
}) => Promise<{ path: string; signedUrl: string; token?: string }>;

export function SignedFileInput({
  fieldName,
  accept,
  requestUpload,
  label = "Upload file",
  "data-testid": testId,
  allowMultiple = false,
}: {
  fieldName: string;
  accept?: string;
  requestUpload: RequestUpload;
  label?: string;
  "data-testid"?: string;
  allowMultiple?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paths, setPaths] = useState<string[]>([]);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const f of files) {
        if (f.size > MAX_BYTES) {
          throw new Error(`file exceeds 50MB: ${f.name}`);
        }
        const extRaw = f.name.split(".").pop()?.toLowerCase() ?? "bin";
        const extension = extRaw === "jpeg" ? "jpg" : extRaw;
        const signed = await requestUpload({ extension, filename: f.name });
        const put = await fetch(signed.signedUrl, {
          method: "PUT",
          body: f,
          headers: { "Content-Type": f.type || "application/octet-stream" },
        });
        if (!put.ok) {
          throw new Error(`upload failed (${put.status})`);
        }
        uploaded.push(signed.path);
      }
      setPaths((prev) => (allowMultiple ? [...prev, ...uploaded] : uploaded));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3"
      data-testid={testId}
    >
      <label className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </label>
      <input
        type="file"
        accept={accept}
        onChange={handleChange}
        disabled={uploading}
        multiple={allowMultiple}
        className="mt-2 text-sm text-[var(--chalk-1)]"
        data-testid={testId ? `${testId}-input` : undefined}
      />
      {uploading ? (
        <p className="mt-2 text-xs text-[var(--chalk-3)]">Uploading…</p>
      ) : null}
      {paths.length > 0 ? (
        <p
          className="mt-2 text-xs text-[var(--signal)]"
          data-testid={testId ? `${testId}-ok` : undefined}
        >
          ✓ Uploaded {paths.length} file{paths.length === 1 ? "" : "s"}
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-2 text-xs text-[var(--flare)]"
          data-testid={testId ? `${testId}-error` : undefined}
        >
          {error}
        </p>
      ) : null}
      {allowMultiple
        ? paths.map((p, i) => (
            <input
              key={p + i}
              type="hidden"
              name={`${fieldName}[]`}
              value={p}
            />
          ))
        : paths.length > 0 && (
            <input type="hidden" name={fieldName} value={paths[0]} />
          )}
    </div>
  );
}
