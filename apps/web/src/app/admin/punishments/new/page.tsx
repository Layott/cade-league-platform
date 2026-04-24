import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { listPlayersInActiveSeason } from "@/server/players";
import { createPunishment } from "./actions";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  FormField,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/admin/FormField";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { SuspensionFields } from "./SuspensionFields";
import { LadderHelper } from "./LadderHelper";

export const dynamic = "force-dynamic";

export default async function NewPunishmentPage() {
  const sb = await getServerSupabase();
  const players = await listPlayersInActiveSeason(sb);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Issue sanction"
        title="New punishment"
        description="Log an incident and its sanction. Public visibility defaults to on — uncheck for private warnings. Suspensions auto-void affected fixtures via Rule 3.4.4.2."
      />

      <form
        action={createPunishment}
        className="max-w-2xl space-y-5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6"
      >
        <FormField label="Player">
          <select name="playerId" required className={selectClass} data-testid="pn-player">
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name} ({p.gamer_tag})
              </option>
            ))}
          </select>
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Incident">
            <select
              name="incidentType"
              required
              className={selectClass}
              defaultValue="other"
            >
              <option value="late_arrival">Late arrival</option>
              <option value="absent">Absence</option>
              <option value="forfeit">Forfeit</option>
              <option value="equipment">Equipment</option>
              <option value="social_media">Social media</option>
              <option value="unauthorized_access">Unauthorized access</option>
              <option value="betting">Betting</option>
              <option value="match_fixing">Match fixing</option>
              <option value="dress_code">Dress code</option>
              <option value="other">Other</option>
            </select>
          </FormField>

          <FormField label="Sanction">
            <select
              name="sanctionType"
              required
              className={selectClass}
              defaultValue="point_deduction"
              data-testid="pn-sanction"
            >
              <option value="warning">Warning</option>
              <option value="point_deduction">Point deduction</option>
              <option value="gd_deduction">GD deduction</option>
              <option value="forfeit">Forfeit (3-0)</option>
              <option value="ban">Suspension (ban)</option>
            </select>
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Magnitude"
            hint="Points / GD / ban-games. Ignored for suspensions (use the date window below)."
          >
            <input
              name="magnitude"
              type="number"
              min={0}
              defaultValue={0}
              className={inputClass + " tabular"}
            />
          </FormField>

          <FormField label="Effective from">
            <input
              name="effectiveFrom"
              type="date"
              className={inputClass + " tabular"}
              data-testid="pn-from"
            />
          </FormField>
        </div>

        {/* Client-side auto-ladder: watches (player, incidentType), fetches
            prior-offense count, pre-fills sanction+magnitude + surfaces an
            inline escalation notice. Admin can still override. */}
        <LadderHelper />

        {/* Client-side helper: reveals suspension fields + live void preview
            when sanctionType='ban' is selected. Hidden otherwise. */}
        <SuspensionFields />

        <label className="flex items-center gap-2 text-sm text-[var(--chalk-2)]">
          <input
            type="checkbox"
            name="publicVisible"
            defaultChecked
            className="h-4 w-4 accent-[var(--signal)]"
          />
          Show on the public /punishments feed
        </label>

        <FormField
          label="Notes"
          hint="Visible to admins; shown on the punishment detail page."
        >
          <textarea name="notes" rows={3} className={textareaClass} />
        </FormField>

        <div className="flex items-center gap-3 pt-2">
          <PrimaryButton type="submit">Issue punishment</PrimaryButton>
          <Link href="/admin/punishments">
            <SecondaryButton type="button">Cancel</SecondaryButton>
          </Link>
        </div>
      </form>
    </div>
  );
}
