import { createMatchDayAction } from "./actions";

export default function NewMatchDayPage() {
  return (
    <div className="max-w-lg space-y-4">
      <h2 className="text-2xl font-bold">New match day</h2>
      <form action={createMatchDayAction} className="space-y-4 bg-white border rounded p-6">
        <label className="block space-y-1">
          <span className="text-sm">Match date</span>
          <input
            name="matchDate"
            type="date"
            required
            className="w-full border rounded px-3 py-2"
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="text-sm">Arrival cutoff (WAT)</span>
            <input
              name="arrivalCutoffTime"
              type="time"
              required
              defaultValue="18:00"
              className="w-full border rounded px-3 py-2"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm">Match start (WAT)</span>
            <input
              name="matchStartTime"
              type="time"
              required
              defaultValue="19:00"
              className="w-full border rounded px-3 py-2"
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm">Venue</span>
          <input
            name="venueName"
            type="text"
            required
            defaultValue="CADE HQ"
            className="w-full border rounded px-3 py-2"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">Notes (optional)</span>
          <textarea name="notes" rows={3} className="w-full border rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-black text-white px-4 py-2 rounded">
          Create
        </button>
      </form>
    </div>
  );
}
