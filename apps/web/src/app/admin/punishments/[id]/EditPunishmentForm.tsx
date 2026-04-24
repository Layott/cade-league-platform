"use client";

import { useState } from "react";
import {
  FormField,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";
import {
  PrimaryButton,
  SecondaryButton,
} from "@/components/admin/buttons";
import { updateAction } from "./actions";

type SanctionType =
  | "warning"
  | "point_deduction"
  | "gd_deduction"
  | "forfeit"
  | "ban";

export type EditPunishmentValues = {
  actionId: string;
  sanctionType: SanctionType;
  magnitude: number;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  publicVisible: boolean;
  notes: string | null;
};

/**
 * Admin edit form for a single disciplinary_action. Collapses by default —
 * click "Edit" to reveal. Separate from revoke (formal withdrawal with
 * reason) and from delete (soft-removal for typo cleanup).
 */
export function EditPunishmentForm({
  initial,
}: {
  initial: EditPunishmentValues;
}) {
  const [open, setOpen] = useState(false);
  const [sanctionType, setSanctionType] = useState<SanctionType>(
    initial.sanctionType,
  );

  if (!open) {
    return (
      <section className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
              Edit punishment
            </div>
            <p className="mt-1 text-xs text-[var(--chalk-3)]">
              Adjust sanction, magnitude, dates, visibility or notes. Audit
              trigger logs the diff.
            </p>
          </div>
          <SecondaryButton type="button" onClick={() => setOpen(true)}>
            Edit
          </SecondaryButton>
        </div>
      </section>
    );
  }

  return (
    <section
      data-testid="edit-punishment-form"
      className="rounded-sm border border-[var(--signal)]/40 bg-[var(--ink-2)] p-5"
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--signal)]">
        Edit punishment
      </div>
      <form action={updateAction} className="mt-4 space-y-4">
        <input type="hidden" name="actionId" value={initial.actionId} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Sanction">
            <select
              name="sanctionType"
              defaultValue={initial.sanctionType}
              onChange={(e) =>
                setSanctionType(e.currentTarget.value as SanctionType)
              }
              required
              className={selectClass}
              data-testid="edit-sanction"
            >
              <option value="warning">Warning</option>
              <option value="point_deduction">Point deduction</option>
              <option value="gd_deduction">GD deduction</option>
              <option value="forfeit">Forfeit (3-0)</option>
              <option value="ban">Suspension (ban)</option>
            </select>
          </FormField>

          <FormField label="Magnitude">
            <input
              name="magnitude"
              type="number"
              min={0}
              defaultValue={initial.magnitude}
              className={inputClass + " tabular"}
              data-testid="edit-magnitude"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Effective from">
            <input
              name="effectiveFrom"
              type="date"
              defaultValue={initial.effectiveFrom ?? ""}
              className={inputClass + " tabular"}
              data-testid="edit-from"
            />
          </FormField>

          <FormField label="Effective until">
            <input
              name="effectiveUntil"
              type="date"
              defaultValue={initial.effectiveUntil ?? ""}
              required={sanctionType === "ban"}
              className={inputClass + " tabular"}
              data-testid="edit-until"
            />
          </FormField>
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--chalk-2)]">
          <input
            type="checkbox"
            name="publicVisible"
            defaultChecked={initial.publicVisible}
            className="h-4 w-4 accent-[var(--signal)]"
          />
          Show on the public /punishments feed
        </label>

        <FormField label="Notes">
          <textarea
            name="notes"
            rows={3}
            defaultValue={initial.notes ?? ""}
            className={textareaClass}
          />
        </FormField>

        <div className="flex items-center gap-3 pt-2">
          <PrimaryButton type="submit">Save changes</PrimaryButton>
          <SecondaryButton type="button" onClick={() => setOpen(false)}>
            Cancel
          </SecondaryButton>
        </div>
      </form>
    </section>
  );
}
