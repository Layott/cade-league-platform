import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync, requirePermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { TournamentTabs } from "./TournamentTabs";
import { TOURNAMENT_TABS } from "./tabs.config";

/**
 * Plan 51 — /admin/tournament/* layout.
 *
 * Acts as the area gate (requires `tournament.read`) plus pre-resolves
 * sub-tab visibility against each tab's perm key so the client tab strip
 * only renders the surfaces this viewer is allowed to reach.
 *
 * Sibling agents fill the individual tab pages:
 *   - /standings, /fixtures, /results-entry, /walkovers, /adjustments,
 *     /tiebreaker-config, /h2h-lookup, /win-prob-preview.
 */

export const dynamic = "force-dynamic";

export default async function TournamentLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/tournament");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/tournament");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const svc = getServiceRoleSupabase();
  const actor = { userId: pub.id, roles };

  // Area gate. Per-tab + per-action perms still re-check below + in pages.
  await requirePermAsync(svc, actor, "tournament.read");

  const checks = await Promise.all(
    TOURNAMENT_TABS.map(async (t) => ({
      href: t.href,
      visible: await hasPermAsync(svc, actor, t.perm),
    })),
  );
  const visibleTabs = checks.filter((c) => c.visible).map((c) => c.href);

  return (
    <div className="space-y-6" data-testid="tournament-shell">
      <SectionHeader
        eyebrow="Tournament"
        title="League console"
        description="Standings, fixtures, results entry, walkovers, manual adjustments, tiebreaker policy, and head-to-head analytics for the active season."
      />
      <TournamentTabs visibleTabs={visibleTabs} />
      {children}
    </div>
  );
}
