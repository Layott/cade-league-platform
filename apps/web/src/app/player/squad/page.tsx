import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  getCurrentWeekSubmissionForPlayer,
  weekStartThursday,
  thursdayDeadline,
} from "@/server/squads";
import { formatWat } from "@/lib/time";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { SubmitForm } from "./SubmitForm";

export const dynamic = "force-dynamic";

export default async function PlayerSquadPage() {
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/player/squad");

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .single();
  if (!pub) redirect("/login?next=/player/squad");

  const { data: player } = await sb
    .from("players")
    .select("id")
    .eq("user_id", pub.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!player) {
    return (
      <div className="space-y-4">
        <SectionHeader
          eyebrow="Squad"
          title="This week's squad"
          description="You do not have a player profile linked to your account yet. Contact an admin."
        />
      </div>
    );
  }

  const weekStart = weekStartThursday(new Date());
  const deadline = thursdayDeadline(weekStart);
  const existing = await getCurrentWeekSubmissionForPlayer(sb, player.id, weekStart);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow={`Week of ${weekStart}`}
        title="This week's squad"
        description={`Deadline: Thursday ${formatWat(deadline, "HH:mm")} WAT (${formatWat(deadline, "yyyy-MM-dd")}).`}
      />

      {existing ? (
        <section
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
          data-testid="squad-existing-summary"
        >
          <div className="flex items-center gap-3">
            <StatusPill status={existing.submission.validation_status} />
            <span className="text-xs text-[var(--chalk-2)]">
              Submitted {formatWat(existing.submission.submitted_at, "yyyy-MM-dd HH:mm")} WAT
            </span>
          </div>
          {existing.submission.rejection_reason ? (
            <p className="mt-3 text-sm text-[var(--flare)]">
              Rejection reason: {existing.submission.rejection_reason}
            </p>
          ) : null}
          <ul className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--chalk-1)] md:grid-cols-3">
            {existing.items.map((it) => (
              <li
                key={it.id}
                className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-2"
              >
                <div className="font-semibold text-[var(--chalk-0)]">
                  #{it.slot_index} {it.name}
                </div>
                <div className="font-mono text-[11px] text-[var(--chalk-3)]">
                  {it.rating} · {it.position} · {it.item_type} · {it.nationality_flag ?? "—"}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <SubmitForm />
      )}
    </div>
  );
}
