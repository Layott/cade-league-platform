"use client";

import { useState } from "react";
import { uploadFontAction } from "./actions";

const MAX_BYTES = 5 * 1024 * 1024;

export function FontUploadForm({
  action = uploadFontAction,
}: {
  action?: typeof uploadFontAction;
} = {}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("File too large — 5MB maximum");
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const base64 = Buffer.from(buf).toString("base64");
      await action({
        filename: file.name,
        mimeType: file.type || "font/ttf",
        base64,
      });
      setFile(null);
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-white/60">
          Font file (TTF / OTF / WOFF / WOFF2, max 5MB)
        </span>
        <input
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/*"
          aria-label="Font file"
          onChange={onPick}
          className="block w-full text-sm text-white"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-rose-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!file || busy}
        className="rounded bg-[#6bcd06] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
      >
        {busy ? "Uploading…" : "Upload font"}
      </button>
    </form>
  );
}
