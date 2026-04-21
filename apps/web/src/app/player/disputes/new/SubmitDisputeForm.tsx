"use client";

import { useState, useTransition } from "react";
import {
  FormField,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { SignedFileInput } from "@/components/shared/SignedFileInput";
import {
  submitDisputeAction,
  requestEvidenceUploadAction,
} from "./actions";

export function SubmitDisputeForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subjectType, setSubjectType] = useState<
    "match" | "sanction" | "registration" | "other"
  >("match");

  return (
    <form
      className="space-y-5"
      data-testid="dispute-submit-form"
      action={(fd: FormData) =>
        startTransition(async () => {
          try {
            await submitDisputeAction(fd);
          } catch (err) {
            setError((err as Error).message);
          }
        })
      }
    >
      <FormField label="Subject type">
        <select
          name="subjectType"
          value={subjectType}
          onChange={(e) => setSubjectType(e.target.value as typeof subjectType)}
          required
          className={selectClass}
          data-testid="dispute-subject-type"
        >
          <option value="match">Match</option>
          <option value="sanction">Sanction</option>
          <option value="registration">Registration</option>
          <option value="other">Other</option>
        </select>
      </FormField>

      {subjectType !== "other" ? (
        <FormField
          label="Subject ID"
          hint="Match ID or sanction action ID — paste from the ref or admin."
        >
          <input
            type="text"
            name="subjectId"
            maxLength={64}
            className={inputClass}
            data-testid="dispute-subject-id"
          />
        </FormField>
      ) : null}

      <FormField label="Description (min 20 chars)">
        <textarea
          name="description"
          required
          minLength={20}
          maxLength={4000}
          rows={6}
          className={textareaClass}
          data-testid="dispute-description-input"
        />
      </FormField>

      <SignedFileInput
        fieldName="evidencePaths"
        accept="image/*,application/pdf,video/mp4"
        requestUpload={requestEvidenceUploadAction}
        label="Evidence (up to 3 files, 50 MB each)"
        data-testid="dispute-evidence"
        allowMultiple
      />

      {error ? (
        <p className="text-xs text-[var(--flare)]" data-testid="dispute-error">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <PrimaryButton
          type="submit"
          disabled={isPending}
          data-testid="dispute-submit-btn"
        >
          Submit dispute
        </PrimaryButton>
        <SecondaryButton type="reset" disabled={isPending}>
          Reset
        </SecondaryButton>
      </div>
    </form>
  );
}
