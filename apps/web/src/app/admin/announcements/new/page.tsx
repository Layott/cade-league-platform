import Link from "next/link";
import { submitAnnouncement } from "./actions";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";
import {
  PrimaryButton,
  SecondaryButton,
} from "@/components/admin/buttons";

/**
 * NOTE: Playwright E2E uses `getByLabel("Title")`, `getByLabel("Body (markdown)")`,
 * `getByLabel("Public")`, and `getByRole("button", { name: "Publish now" })`.
 * Label TEXT must match exactly; do not reword.
 */

export default function NewAnnouncementPage() {
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Compose"
        title="New announcement"
        description="Markdown on the left, audience on the right, one confident button to ship."
      />

      <form
        action={submitAnnouncement}
        className="max-w-3xl space-y-6 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6"
      >
        <label className="block space-y-1.5">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Title
          </span>
          <input
            name="title"
            required
            className={inputClass + " text-base font-display"}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Body (markdown)
          </span>
          <textarea
            name="body_md"
            rows={12}
            className={textareaClass}
            placeholder="# Heading&#10;&#10;Write the briefing here. **Bold** for emphasis."
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Priority
            </span>
            <select name="priority" className={selectClass}>
              <option value="info">info</option>
              <option value="important">important</option>
              <option value="urgent">urgent</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Schedule publish at
            </span>
            <input
              type="datetime-local"
              name="scheduled_publish_at"
              className={inputClass + " tabular"}
            />
          </label>
        </div>

        <fieldset className="space-y-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-4">
          <legend className="px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Audience
          </legend>
          <select name="audience_type" className={selectClass}>
            <option value="all">All users</option>
            <option value="role">Role</option>
            <option value="users">Specific users</option>
            <option value="players_in_season">Players in active season</option>
          </select>
          <input
            name="audience_role"
            placeholder="admin | moderator | player"
            className={inputClass}
          />
          <input
            name="audience_user_ids"
            placeholder="comma-separated user UUIDs (for 'users')"
            className={inputClass + " font-mono text-[12px]"}
          />
        </fieldset>

        <fieldset className="space-y-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-4">
          <legend className="px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Channels
          </legend>
          <div className="flex flex-wrap gap-5 text-sm text-[var(--chalk-1)]">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="channel_in_app"
                defaultChecked
                className="h-4 w-4 accent-[var(--signal)]"
              />
              in_app
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                name="channel_email"
                defaultChecked
                className="h-4 w-4 accent-[var(--signal)]"
              />
              email
            </label>
          </div>
        </fieldset>

        <label className="inline-flex items-center gap-2 text-sm text-[var(--chalk-1)]">
          <input
            type="checkbox"
            name="is_public"
            className="h-4 w-4 accent-[var(--signal)]"
          />
          Public (show on /announcements)
        </label>

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--ink-4)] pt-5">
          <PrimaryButton name="mode" value="publish_now" type="submit">
            Publish now
          </PrimaryButton>
          <SecondaryButton name="mode" value="schedule" type="submit">
            Schedule
          </SecondaryButton>
          <SecondaryButton name="mode" value="draft" type="submit">
            Save draft
          </SecondaryButton>
          <Link href="/admin/announcements" className="ml-auto">
            <SecondaryButton type="button">Cancel</SecondaryButton>
          </Link>
        </div>
      </form>
    </div>
  );
}
