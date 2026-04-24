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
import { CountdownBadge } from "@/components/squads/CountdownBadge";
import { SquadChangeEditor } from "@/components/squads/SquadChangeEditor";
import type { SquadChangeEditorItem } from "@/components/squads/SquadChangeEditor";
import { requestChangeAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Infer the starting formation from the positions of the 11 starters.
 * Crude heuristic — counts defender/mid/attacker slots, then picks the
 * closest canonical formation. Falls back to 4-3-3 when ambiguous.
 */
function inferInitialFormation(
  positions: string[],
): "433" | "442" | "4231" | "352" | "343" | "532" | "541" {
  const def = positions.filter((p) =>
    /^(LB|RB|CB|LWB|RWB)$/i.test(p),
  ).length;
  const mid = positions.filter((p) =>
    /^(CDM|CM|CAM|LM|RM)$/i.test(p),
  ).length;
  const att = positions.filter((p) => /^(LW|RW|LF|RF|CF|ST)$/i.test(p)).length;
  const sig = `${def}-${mid}-${att}`;
  // Best-effort match; only a handful covered, rest fall through to 4-3-3.
  switch (sig) {
    case "4-3-3":
      return "433";
    case "4-4-2":
      return "442";
    case "4-2-3-1":
    case "4-5-1":
      return "4231";
    case "3-5-2":
      return "352";
    case "3-4-3":
      return "343";
    case "5-3-2":
      return "532";
    case "5-4-1":
      return "541";
    default:
      return "433";
  }
}

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
        eyebrow="Change"
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

  // Existing change request (already used this week)?
  let changeUsed = false;
  if (approved) {
    const { data: existing } = await sb
      .from("squad_change_requests")
      .select("id")
      .eq("submission_id", approved.submission.id)
      .is("deleted_at", null)
      .maybeSingle();
    changeUsed = !!existing;
  }

  const startingXI = (approved?.items ?? []).filter(
    (it) => it.slot_index >= 0 && it.slot_index <= 10,
  );

  const editorItems: SquadChangeEditorItem[] = startingXI.map((it) => ({
    itemId: it.id,
    slotIndex: it.slot_index,
    name: it.name,
    rating: it.rating,
    position: it.position,
    itemType: it.item_type,
    nationalityFlag: it.nationality_flag,
  }));

  // Sort so slot 0 is first — the editor relies on this order to seed.
  editorItems.sort((a, b) => a.slotIndex - b.slotIndex);

  const initialFormation = inferInitialFormation(
    editorItems.map((i) => i.position),
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={`Week of ${weekStart}`}
        title="Friday change window"
        description={`Window opens ${formatWat(window.openAt, "EEE HH:mm")} and closes ${formatWat(window.closeAt, "HH:mm")} WAT. You may change formation, rearrange cards, and/or replace ONE card per week.`}
        action={
          before ? (
            <CountdownBadge targetIso={window.openAt.toISOString()} prefix="Opens in" />
          ) : open ? (
            <CountdownBadge targetIso={window.closeAt.toISOString()} prefix="Closes in" />
          ) : null
        }
      />

      {sp.ok === "1" ? (
        <div
          data-testid="change-success"
          className="rounded-sm border border-[rgba(107,205,6,0.35)] bg-[rgba(107,205,6,0.08)] p-3 text-sm text-[var(--primary)]"
        >
          Change recorded. Referee authorization logged.
        </div>
      ) : null}

      {!approved ? (
        <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-sm text-[var(--chalk-2)]">
          You have no approved squad for this week yet — nothing to change.
        </div>
      ) : after ? (
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-sm text-[var(--chalk-2)]">
          Change window closed. Next opens Friday 21:00 WAT.
        </div>
      ) : changeUsed ? (
        <div
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-sm text-[var(--chalk-2)]"
          data-testid="swap-already-used"
        >
          You have used your change allowance for this week.
        </div>
      ) : before ? (
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-sm text-[var(--chalk-2)]">
          Form unlocks automatically at 21:00 WAT. Reload at that time.
        </div>
      ) : editorItems.length !== 11 ? (
        <div className="rounded-sm border border-[var(--flare)] bg-[rgba(255,91,59,0.08)] p-4 text-sm text-[var(--flare)]">
          Your approved squad has {editorItems.length} starters (expected 11). Contact an admin.
        </div>
      ) : (
        <SquadChangeEditor
          initialFormation={initialFormation}
          existingItems={editorItems}
          refOptions={refs}
          submitAction={async (payload) => {
            "use server";
            await requestChangeAction(approved.submission.id, payload);
          }}
        />
      )}
    </div>
  );
}
