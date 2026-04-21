"use client";

import { useState, useTransition } from "react";
import {
  FormField,
  textareaClass,
} from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { SignedFileInput } from "@/components/shared/SignedFileInput";
import {
  submitAppealAction,
  requestAppealEvidenceUploadAction,
} from "./actions";

export function SubmitAppealForm({ caseId }: { caseId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-5"
      data-testid="appeal-submit-form"
      action={(fd: FormData) =>
        startTransition(async () => {
          try {
            await submitAppealAction(fd);
          } catch (err) {
            setError((err as Error).message);
          }
        })
      }
    >
      <input type="hidden" name="caseId" value={caseId} />

      <FormField label="Grounds for appeal (min 40 chars)">
        <textarea
          name="grounds"
          required
          minLength={40}
          maxLength={4000}
          rows={8}
          className={textareaClass}
          data-testid="appeal-grounds-input"
          placeholder="Explain why the sanction should be revoked or reduced. Be specific — the panel has 5 business days to rule."
        />
      </FormField>

      <SignedFileInput
        fieldName="evidencePaths"
        accept="image/*,application/pdf,video/mp4"
        requestUpload={requestAppealEvidenceUploadAction}
        label="Evidence (up to 3 files, 50 MB each)"
        data-testid="appeal-evidence"
        allowMultiple
      />

      {error ? (
        <p className="text-xs text-[var(--flare)]" data-testid="appeal-error">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <PrimaryButton
          type="submit"
          disabled={isPending}
          data-testid="appeal-submit-btn"
        >
          Submit appeal
        </PrimaryButton>
        <SecondaryButton type="reset" disabled={isPending}>
          Reset
        </SecondaryButton>
      </div>
    </form>
  );
}
