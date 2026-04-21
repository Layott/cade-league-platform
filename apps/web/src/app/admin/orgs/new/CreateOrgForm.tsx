"use client";

import { useState, useTransition } from "react";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  FormField,
  inputClass,
  selectClass,
} from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { SignedFileInput } from "@/components/shared/SignedFileInput";
import { createOrgAction, requestCacUploadAction } from "./actions";

type UserOption = { id: string; display_name: string | null; email: string };

export function CreateOrgForm({ users }: { users: UserOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      data-testid="org-create-form"
      className="space-y-5"
      action={(fd: FormData) =>
        startTransition(async () => {
          try {
            await createOrgAction(fd);
          } catch (err) {
            // Next.js uses a thrown "redirect" error to trigger navigation
            // from server actions; rethrow so the framework can handle it.
            if (isRedirectError(err)) throw err;
            setError((err as Error).message);
          }
        })
      }
    >
      <FormField label="Organization name">
        <input
          name="name"
          required
          maxLength={200}
          className={inputClass}
          data-testid="org-name-input"
          placeholder="e.g. Lagos Crown Esports"
        />
      </FormField>

      <FormField label="CAC number" hint="Optional but unique across all orgs">
        <input
          name="cacNumber"
          maxLength={64}
          className={inputClass}
          data-testid="org-cac-input"
          placeholder="RC-1234567"
        />
      </FormField>

      <FormField
        label="Contact rep (user)"
        hint="Who represents this org in-league"
      >
        <select
          name="contactRepUserId"
          defaultValue=""
          className={selectClass}
          data-testid="org-rep-select"
        >
          <option value="">— none —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name ?? u.email}
            </option>
          ))}
        </select>
      </FormField>

      <SignedFileInput
        fieldName="cacCertPath"
        accept=".pdf,.png,.jpg,.jpeg"
        requestUpload={requestCacUploadAction}
        label="CAC certificate (optional)"
        data-testid="org-cac-upload"
      />

      {error ? (
        <p className="text-xs text-[var(--flare)]" data-testid="org-create-error">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <PrimaryButton
          type="submit"
          disabled={isPending}
          data-testid="org-create-submit"
        >
          Create organization
        </PrimaryButton>
        <SecondaryButton type="reset" disabled={isPending}>
          Reset
        </SecondaryButton>
      </div>
    </form>
  );
}
