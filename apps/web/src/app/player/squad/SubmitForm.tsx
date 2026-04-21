"use client";

import { useState, useTransition } from "react";
import { ItemRow } from "@/components/squads/ItemRow";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { createSubmissionAction, requestUploadUrlAction } from "./actions";

/**
 * Plan 10 — player upload + transcribe form.
 *
 * Flow:
 *   1. Player picks a file.
 *   2. Client posts to requestUploadUrlAction → gets signed PUT URL.
 *   3. Browser PUTs the bytes to Supabase Storage directly.
 *   4. On success we surface the storage key + weekStartDate and enable
 *      form submit. createSubmissionAction persists the full row.
 */
export function SubmitForm() {
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<string | null>(null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setUploading(true);
    try {
      const extRaw = f.name.split(".").pop()?.toLowerCase() ?? "png";
      const extension = (["png", "jpg", "jpeg", "webp"].includes(extRaw)
        ? extRaw === "jpeg"
          ? "jpg"
          : extRaw
        : "png") as "png" | "jpg" | "webp";
      const signed = await requestUploadUrlAction({ extension });
      const put = await fetch(signed.signedUrl, {
        method: "PUT",
        body: f,
        headers: { "Content-Type": f.type || "application/octet-stream" },
      });
      if (!put.ok) {
        throw new Error(`upload failed: ${put.status}`);
      }
      setPath(signed.path);
      setWeekStart(signed.weekStartDate);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      action={(fd: FormData) =>
        startTransition(async () => {
          try {
            await createSubmissionAction(fd);
          } catch (err) {
            setError((err as Error).message);
          }
        })
      }
      className="space-y-5"
      data-testid="squad-submit-form"
    >
      <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4">
        <label className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Futbin screenshot
        </label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onFileChange}
          disabled={uploading || isPending}
          className="mt-2 text-sm text-[var(--chalk-1)]"
          data-testid="squad-file-input"
        />
        {uploading ? (
          <p className="mt-2 text-xs text-[var(--chalk-3)]">Uploading…</p>
        ) : null}
        {path ? (
          <p className="mt-2 text-xs text-[var(--signal)]" data-testid="squad-upload-ok">
            ✓ Uploaded
          </p>
        ) : null}
      </div>

      <input type="hidden" name="futbinScreenshotPath" value={path ?? ""} />
      <input type="hidden" name="weekStartDate" value={weekStart ?? ""} />

      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Starting XI (slots 0-10)
        </div>
        {Array.from({ length: 11 }, (_, i) => (
          <ItemRow key={i} slotIndex={i} />
        ))}
        <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Bench (slots 11-22, optional)
        </div>
        {Array.from({ length: 12 }, (_, i) => (
          <ItemRow key={i + 11} slotIndex={i + 11} />
        ))}
      </div>

      {error ? (
        <p className="text-xs text-[var(--flare)]" data-testid="squad-form-error">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <PrimaryButton
          type="submit"
          disabled={!path || !weekStart || uploading || isPending}
          data-testid="squad-submit-btn"
        >
          Submit squad
        </PrimaryButton>
        <SecondaryButton type="reset" disabled={uploading || isPending}>
          Reset form
        </SecondaryButton>
      </div>
    </form>
  );
}
