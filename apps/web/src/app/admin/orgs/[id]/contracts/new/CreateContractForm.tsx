"use client";

import { useState, useTransition } from "react";
import {
  FormField,
  inputClass,
  selectClass,
} from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { SignedFileInput } from "@/components/shared/SignedFileInput";
import {
  createContractAction,
  requestContractUploadAction,
} from "./actions";

type PlayerOpt = { id: string; label: string };
type SeasonOpt = { id: string; label: string };

export function CreateContractForm({
  orgId,
  players,
  seasons,
}: {
  orgId: string;
  players: PlayerOpt[];
  seasons: SeasonOpt[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Boxed handler so we can bind orgId to the signed-upload request.
  const requestUpload = async (input: { extension: string }) =>
    requestContractUploadAction({ orgId, extension: input.extension });

  return (
    <form
      data-testid="contract-create-form"
      className="space-y-5"
      action={(fd: FormData) =>
        startTransition(async () => {
          try {
            await createContractAction(fd);
          } catch (err) {
            setError((err as Error).message);
          }
        })
      }
    >
      <input type="hidden" name="organizationId" value={orgId} />

      <FormField label="Player">
        <select
          name="playerId"
          required
          defaultValue=""
          className={selectClass}
          data-testid="contract-player"
        >
          <option value="" disabled>
            — choose a linked player —
          </option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Season">
        <select
          name="seasonId"
          required
          defaultValue={seasons[0]?.id ?? ""}
          className={selectClass}
          data-testid="contract-season"
        >
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Valid from">
          <input
            type="date"
            name="validFrom"
            required
            className={inputClass}
            data-testid="contract-valid-from"
          />
        </FormField>
        <FormField label="Valid until">
          <input
            type="date"
            name="validUntil"
            required
            className={inputClass}
            data-testid="contract-valid-until"
          />
        </FormField>
      </div>

      <FormField label="Status">
        <select
          name="status"
          defaultValue="draft"
          className={selectClass}
          data-testid="contract-status"
        >
          <option value="draft">draft</option>
          <option value="active">active</option>
        </select>
      </FormField>

      <SignedFileInput
        fieldName="contractPath"
        accept=".pdf,.png,.jpg,.jpeg"
        requestUpload={requestUpload}
        label="Contract file"
        data-testid="contract-file-upload"
      />

      {error ? (
        <p className="text-xs text-[var(--flare)]" data-testid="contract-error">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <PrimaryButton
          type="submit"
          disabled={isPending}
          data-testid="contract-submit"
        >
          Create contract
        </PrimaryButton>
        <SecondaryButton type="reset" disabled={isPending}>
          Reset
        </SecondaryButton>
      </div>
    </form>
  );
}
