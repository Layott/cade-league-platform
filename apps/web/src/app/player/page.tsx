import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentSquadStatus } from "@/server/profile/squadStatus";
import { SquadDueCard } from "@/components/profile/SquadDueCard";
import { SectionHeader } from "@/components/admin/SectionHeader";

export const dynamic = "force-dynamic";

/**
 * Plan 41 — P41-F — /player dashboard landing. Shows the prominent
 * SquadDueCard above a minimal set of deep-links into the existing tabs.
 * Richer content (announcements, opponent preview) is out of P41 scope.
 */
export default async function PlayerDashboardPage() {
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/player");

  // Resolve public users row + linked player.
  const { data: pub } = await sb
    .from("users")
    .select("id, display_name")
    .eq("supabase_auth_id", user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/player");

  const { data: player } = await sb
    .from("players")
    .select("id")
    .eq("user_id", pub.id)
    .is("deleted_at", null)
    .maybeSingle();

  // If the user has no player row, we can still render the dashboard but skip
  // the squad-due card (they're an admin/staff viewer — PlayerSubnav still
  // lets them reach the squad tab, which will show its own "no player" stub).
  const status = player
    ? await getCurrentSquadStatus(sb, player.id, new Date())
    : null;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Dashboard"
        title={`Welcome${pub.display_name ? `, ${pub.display_name}` : ""}`}
        description="Quick jump into this week's squad, disputes, and appeals."
      />

      {status ? <SquadDueCard status={status} /> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Link
          href="/player/squad"
          className="block rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 transition-colors hover:border-[var(--signal)]/40"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--signal)]">
            Squad
          </div>
          <div className="mt-2 text-sm text-[var(--chalk-0)]">
            This week&apos;s submission + Friday change window.
          </div>
        </Link>
        <Link
          href="/player/disputes"
          className="block rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 transition-colors hover:border-[var(--signal)]/40"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--signal)]">
            Disputes
          </div>
          <div className="mt-2 text-sm text-[var(--chalk-0)]">
            Open or track a match-result dispute.
          </div>
        </Link>
        <Link
          href="/player/appeals"
          className="block rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 transition-colors hover:border-[var(--signal)]/40"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--signal)]">
            Appeals
          </div>
          <div className="mt-2 text-sm text-[var(--chalk-0)]">
            Appeal a sanction within the 1-5 business-day window.
          </div>
        </Link>
      </div>
    </div>
  );
}
