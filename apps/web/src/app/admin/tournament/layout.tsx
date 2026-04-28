import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync, requirePermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { ADMIN_HUBS } from "@/lib/admin-nav";
import { HubSubnav } from "@/components/admin/HubSubnav";
import { Breadcrumbs } from "@/components/admin/Breadcrumbs";

/**
 * Plan 51 — /admin/tournament/* layout.
 *
 * UI Audit Slice 4 (2026-04-28) — migrated from per-hub TournamentTabs
 * to the shared HubSubnav driven by `lib/admin-nav.ts`. Adds breadcrumbs.
 *
 * Acts as the area gate (requires `tournament.read`) plus pre-resolves
 * sub-tab visibility against each tab's perm key so the client tab strip
 * only renders the surfaces this viewer is allowed to reach.
 */

export const dynamic = "force-dynamic";

const HUB = ADMIN_HUBS.find((h) => h.key === "tournament")!;

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
  await requirePermAsync(svc, actor, HUB.perm);

  const checks = await Promise.all(
    HUB.subtabs?.map(async (t) => ({
      tab: t,
      ok: await hasPermAsync(svc, actor, t.perm ?? HUB.perm),
    })) ?? [],
  );
  const visibleSubtabsResolved = checks.filter((c) => c.ok).map((c) => c.tab);

  return (
    <div className="space-y-6" data-testid="tournament-shell">
      <SectionHeader
        eyebrow="Tournament"
        title="League console"
        description="Standings, fixtures, results entry, walkovers, manual adjustments, tiebreaker policy, and head-to-head analytics for the active season."
      />
      <Breadcrumbs />
      <HubSubnav hub={HUB} visibleSubtabs={visibleSubtabsResolved} />
      {children}
    </div>
  );
}
