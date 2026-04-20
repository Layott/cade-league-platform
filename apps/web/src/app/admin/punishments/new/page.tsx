import { getServerSupabase } from "@/lib/supabase/server";
import { listPlayersInActiveSeason } from "@/server/players";
import { createPunishment } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewPunishmentPage() {
  const sb = await getServerSupabase();
  const players = await listPlayersInActiveSeason(sb);

  return (
    <div className="max-w-xl space-y-6">
      <h2 className="text-2xl font-bold">New punishment</h2>
      <form action={createPunishment} className="space-y-4 border rounded p-6 bg-white">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Player</span>
          <select name="playerId" required className="w-full border rounded px-3 py-2">
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name} ({p.gamer_tag})
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Incident</span>
          <select
            name="incidentType"
            required
            className="w-full border rounded px-3 py-2"
            defaultValue="other"
          >
            <option value="late_arrival">Late arrival</option>
            <option value="forfeit">Forfeit</option>
            <option value="equipment">Equipment</option>
            <option value="social_media">Social media</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Sanction</span>
          <select
            name="sanctionType"
            required
            className="w-full border rounded px-3 py-2"
            defaultValue="point_deduction"
          >
            <option value="warning">Warning</option>
            <option value="point_deduction">Point deduction</option>
            <option value="gd_deduction">GD deduction</option>
            <option value="forfeit">Forfeit (3-0)</option>
            <option value="ban">Ban</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Magnitude (points / GD)</span>
          <input
            name="magnitude"
            type="number"
            min={0}
            defaultValue={0}
            className="w-full border rounded px-3 py-2"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Effective from</span>
          <input
            name="effectiveFrom"
            type="date"
            className="w-full border rounded px-3 py-2"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="publicVisible" defaultChecked />
          Show on public /punishments feed
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Notes</span>
          <textarea
            name="notes"
            rows={3}
            className="w-full border rounded px-3 py-2"
          />
        </label>

        <button type="submit" className="bg-black text-white rounded px-4 py-2">
          Issue punishment
        </button>
      </form>
    </div>
  );
}
