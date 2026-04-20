import Link from "next/link";
import { createMatchDayAction } from "./actions";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  FormField,
  inputClass,
  textareaClass,
} from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";

export default function NewMatchDayPage() {
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="New session"
        title="Lock in a match day"
        description="Set the date, venue and call-time. Fixtures are added from the detail page once the match day exists."
      />

      <form
        action={createMatchDayAction}
        className="max-w-xl space-y-5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6"
      >
        <FormField label="Match date">
          <input
            name="matchDate"
            type="date"
            required
            aria-label="Match date"
            className={inputClass}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Arrival cutoff"
            hint="West Africa Time (WAT)"
          >
            <input
              name="arrivalCutoffTime"
              type="time"
              required
              defaultValue="18:00"
              className={inputClass}
            />
          </FormField>
          <FormField label="Kick-off" hint="West Africa Time (WAT)">
            <input
              name="matchStartTime"
              type="time"
              required
              defaultValue="19:00"
              className={inputClass}
            />
          </FormField>
        </div>
        <FormField label="Venue">
          <input
            name="venueName"
            type="text"
            required
            aria-label="Venue"
            defaultValue="CADE HQ"
            className={inputClass}
          />
        </FormField>
        <FormField label="Notes" hint="Optional. Call-up rules, dress code, etc.">
          <textarea name="notes" rows={3} className={textareaClass} />
        </FormField>

        <div className="flex items-center gap-3 pt-2">
          <PrimaryButton type="submit">Create</PrimaryButton>
          <Link href="/admin/match-days">
            <SecondaryButton type="button">Cancel</SecondaryButton>
          </Link>
        </div>
      </form>
    </div>
  );
}
