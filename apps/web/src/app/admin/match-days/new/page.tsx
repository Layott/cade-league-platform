import Link from "next/link";
import { createMatchDayAction } from "./actions";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  FormField,
  inputClass,
  textareaClass,
} from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";

function ErrorBanner({
  error,
  date,
  detail,
}: {
  error?: string;
  date?: string;
  detail?: string;
}) {
  if (!error) return null;
  let message = "Unable to create match day. Try again.";
  if (error === "duplicate-date") {
    message = `A match day already exists on ${date ?? "that date"}. Pick a different date or edit the existing one from the match-days list.`;
  } else if (error === "no-active-season") {
    message =
      "No active season is configured. Check the seasons table — exactly one season must have status='active'.";
  } else if (error === "create-failed" && detail) {
    message = `Create failed: ${detail}`;
  }
  return (
    <div
      role="alert"
      data-testid="md-create-error"
      style={{
        background: "rgba(255,91,59,0.1)",
        border: "1px solid rgba(255,91,59,0.4)",
        color: "var(--flare)",
        padding: "12px 14px",
        borderRadius: 4,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {message}
    </div>
  );
}

export default async function NewMatchDayPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; date?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="New session"
        title="Lock in a match day"
        description="Set the date, venue and call-time. Fixtures are added from the detail page once the match day exists."
      />

      <ErrorBanner error={sp.error} date={sp.date} detail={sp.detail} />

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
            defaultValue={sp.date ?? ""}
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
