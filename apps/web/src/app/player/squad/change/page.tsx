import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  getApprovedSubmissionForPlayer,
  listChangeAuthorizingRefs,
  weekStartThursday,
  fridayWindowBounds,
  isWithinFridayWindow,
} from "@/server/squads";
import { formatWat } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { FormField, inputClass, selectClass } from "@/components/admin/FormField";
import { PrimaryButton } from "@/components/admin/buttons";
import { CountdownBadge } from "@/components/squads/CountdownBadge";
import { requestChangeAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PlayerSquadChangePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const sp = await searchParams;
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/player/squad/change");

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .single();
  if (!pub) redirect("/login?next=/player/squad/change");

  const { data: player } = await sb
    .from("players")
    .select("id")
    .eq("user_id", pub.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!player) {
    return (
      <SectionHeader
        eyebrow="Swap"
        title="Friday change window"
        description="No player profile linked to your account."
      />
    );
  }

  const weekStart = weekStartThursday(new Date());
  const window = fridayWindowBounds(weekStart);
  const now = new Date();
  const open = isWithinFridayWindow(now, weekStart);
  const before = now.getTime() < window.openAt.getTime();
  const after = !open && !before;

  const approved = await getApprovedSubmissionForPlayer(sb, player.id, weekStart);
  const refs = open ? await listChangeAuthorizingRefs(sb) : [];

  // Existing change request (swap already used)?
  let swapUsed = false;
  if (approved) {
    const { data: existing } = await sb
      .from("squad_change_requests")
      .select("id")
      .eq("submission_id", approved.submission.id)
      .is("deleted_at", null)
      .maybeSingle();
    swapUsed = !!existing;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={`Week of ${weekStart}`}
        title="Friday change window"
        description={`Window opens ${formatWat(window.openAt, "EEE HH:mm")} and closes ${formatWat(window.closeAt, "HH:mm")} WAT. One swap per player per week.`}
        action={
          before ? (
            <CountdownBadge targetIso={window.openAt.toISOString()} prefix="Opens in" />
          ) : open ? (
            <CountdownBadge targetIso={window.closeAt.toISOString()} prefix="Closes in" />
          ) : null
        }
      />

      {sp.ok === "1" ? (
        <div className="rounded-sm border border-[rgba(0,255,136,0.35)] bg-[rgba(0,255,136,0.08)] p-3 text-sm text-[var(--signal)]">
          Swap recorded. Referee authorization logged.
        </div>
      ) : null}

      {!approved ? (
        <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-sm text-[var(--chalk-2)]">
          You have no approved squad for this week yet — nothing to swap.
        </div>
      ) : after ? (
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-sm text-[var(--chalk-2)]">
          Change window closed. Next opens Friday 21:00 WAT.
        </div>
      ) : swapUsed ? (
        <div
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-sm text-[var(--chalk-2)]"
          data-testid="swap-already-used"
        >
          You have used your single swap for this week.
        </div>
      ) : before ? (
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-sm text-[var(--chalk-2)]">
          Form unlocks automatically at 21:00 WAT. Reload at that time.
        </div>
      ) : (
        <form action={requestChangeAction} className="space-y-5" data-testid="change-form">
          <input type="hidden" name="submissionId" value={approved.submission.id} />

          <FormField label="Player to swap OUT" hint="Must be one of this week's items.">
            <select
              name="playerOutItemId"
              required
              className={selectClass}
              data-testid="change-out-select"
            >
              <option value="">Select an item…</option>
              {approved.items.map((it) => (
                <option key={it.id} value={it.id}>
                  #{it.slot_index} — {it.name} ({it.rating} {it.position})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Out player (display name)">
            <input
              name="playerOutName"
              required
              className={inputClass}
              placeholder="Copy the name of the swapped-out player"
            />
          </FormField>

          <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Player to swap IN
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name">
                <input name="playerIn.name" required className={inputClass} />
              </FormField>
              <FormField label="Rating">
                <input
                  name="playerIn.rating"
                  type="number"
                  min={1}
                  max={99}
                  required
                  className={inputClass}
                />
              </FormField>
              <FormField label="Value (coins)">
                <input
                  name="playerIn.value"
                  type="number"
                  min={0}
                  required
                  className={inputClass}
                />
              </FormField>
              <FormField label="Item type">
                <select name="playerIn.itemType" className={selectClass} defaultValue="gold">
                  <option value="gold">Gold</option>
                  <option value="silver">Silver</option>
                  <option value="bronze">Bronze</option>
                  <option value="hero">Hero</option>
                  <option value="icon">Icon</option>
                  <option value="legend">Legend</option>
                  <option value="special">Special</option>
                  <option value="other">Other</option>
                </select>
              </FormField>
              <FormField label="Nationality flag">
                <input
                  name="playerIn.nationalityFlag"
                  maxLength={6}
                  className={inputClass}
                  placeholder="NG / GB …"
                />
              </FormField>
            </div>
          </div>

          <FormField label="Authorizing referee" hint="Pick a referee who has authorized this swap on-site.">
            <select
              name="authorizedByRefUserId"
              required
              className={selectClass}
              data-testid="change-ref-select"
            >
              <option value="">Select a referee…</option>
              {refs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.display_name}
                </option>
              ))}
            </select>
          </FormField>

          <PrimaryButton type="submit" data-testid="change-submit">
            Record swap
          </PrimaryButton>
        </form>
      )}
    </div>
  );
}
