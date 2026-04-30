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
