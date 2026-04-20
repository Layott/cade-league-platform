import { submitAnnouncement } from "./actions";

export default function NewAnnouncementPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">New announcement</h2>
      <form action={submitAnnouncement} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm">Title</span>
          <input name="title" required className="w-full border rounded px-3 py-2" />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Body (markdown)</span>
          <textarea
            name="body_md"
            rows={10}
            className="w-full border rounded px-3 py-2 font-mono text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Priority</span>
          <select name="priority" className="border rounded px-3 py-2">
            <option value="info">info</option>
            <option value="important">important</option>
            <option value="urgent">urgent</option>
          </select>
        </label>

        <fieldset className="space-y-2 border rounded p-3">
          <legend className="text-sm px-1">Audience</legend>
          <select name="audience_type" className="border rounded px-2 py-1">
            <option value="all">All users</option>
            <option value="role">Role</option>
            <option value="users">Specific users</option>
            <option value="players_in_season">Players in active season</option>
          </select>
          <input
            name="audience_role"
            placeholder="admin | moderator | player"
            className="border rounded px-2 py-1 ml-2"
          />
          <input
            name="audience_user_ids"
            placeholder="comma-separated user UUIDs (for 'users')"
            className="w-full border rounded px-2 py-1"
          />
        </fieldset>

        <fieldset className="space-y-2 border rounded p-3">
          <legend className="text-sm px-1">Channels</legend>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="channel_in_app" defaultChecked /> in_app
          </label>
          <label className="inline-flex items-center gap-2 ml-4">
            <input type="checkbox" name="channel_email" defaultChecked /> email
          </label>
        </fieldset>

        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="is_public" /> Public (show on /announcements)
        </label>

        <label className="block space-y-1">
          <span className="text-sm">Schedule publish at (optional)</span>
          <input
            type="datetime-local"
            name="scheduled_publish_at"
            className="border rounded px-3 py-2"
          />
        </label>

        <div className="flex gap-2">
          <button
            name="mode"
            value="publish_now"
            className="bg-black text-white rounded px-4 py-2"
            type="submit"
          >
            Publish now
          </button>
          <button
            name="mode"
            value="schedule"
            className="bg-slate-700 text-white rounded px-4 py-2"
            type="submit"
          >
            Schedule
          </button>
          <button name="mode" value="draft" className="border rounded px-4 py-2" type="submit">
            Save draft
          </button>
        </div>
      </form>
    </div>
  );
}
