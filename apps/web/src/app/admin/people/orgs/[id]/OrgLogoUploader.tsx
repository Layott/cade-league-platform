"use client";

import { useState, useTransition } from "react";
import { SignedFileInput } from "@/components/shared/SignedFileInput";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { requestOrgLogoUploadAction, updateOrgAction } from "./actions";

/**
 * Plan 31 follow-up — admin UI to set/replace the org logo on
 * /admin/people/orgs/[id]. Wraps the existing `SignedFileInput` widget
 * + `updateOrgAction` server action; passes `id` in a hidden field so
 * the partial-update pattern (logo only) works without forcing the
 * admin to re-enter name/contact.
 *
 * Action does the storage-path → public-URL resolution before writing
 * to `organizations.logo_url`, so the broadcast 15-orgs overlay reads
 * a ready-to-render `<img src>` value.
 *
 * The widget is INTENTIONALLY a separate form from any future "edit
 * org name" form on this page — keeps logo upload reversible (admin
 * can pick a different file before clicking Save) without coupling to
 * the rest of the metadata.
 *
 * 2026-05-01 — adds a UI hint that the logo will be auto-resized to
 * 800×800 with a transparent background. The actual resize happens
 * server-side on the next overlay refresh via the central
 * `processImage` helper (or, if the file is uploaded via signed-URL,
 * client-side via `<canvas>` before PUT).
 */
export function OrgLogoUploader({
  orgId,
  currentLogoUrl,
  orgName,
}: {
  orgId: string;
  currentLogoUrl: string | null;
  orgName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  return (
    <form
      data-testid="org-logo-uploader-form"
      className="space-y-3"
      action={(fd: FormData) =>
        startTransition(async () => {
          setError(null);
          setSuccess(false);
          try {
            await updateOrgAction(fd);
            setSuccess(true);
          } catch (err) {
            setError((err as Error).message ?? "save failed");
          }
        })
      }
    >
      <input type="hidden" name="id" value={orgId} />
      <SignedFileInput
        fieldName="logoPath"
        accept=".png,.jpg,.jpeg,.svg,.webp"
        requestUpload={requestOrgLogoUploadAction}
        label={currentLogoUrl ? `Replace logo for ${orgName}` : `Upload logo for ${orgName}`}
        data-testid="org-logo-upload"
      />
      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Image will be auto-resized to 800×800 with transparent background.
      </p>
      <div className="flex items-center gap-3">
        <PrimaryButton
          type="submit"
          disabled={isPending}
          size="sm"
          data-testid="org-logo-save"
        >
          {isPending ? "Saving…" : "Save logo"}
        </PrimaryButton>
        <SecondaryButton type="reset" size="sm" disabled={isPending}>
          Reset
        </SecondaryButton>
        {success ? (
          <span
            className="text-xs text-[var(--signal)]"
            data-testid="org-logo-save-ok"
          >
            ✓ Saved
          </span>
        ) : null}
      </div>
      {error ? (
        <p
          className="text-xs text-[var(--flare)]"
          data-testid="org-logo-save-error"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
