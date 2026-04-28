import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync, requirePermAsync } from "@/lib/perms-db";
import { ADMIN_HUBS } from "@/lib/admin-nav";
import { HubSubnav } from "@/components/admin/HubSubnav";
import { Breadcrumbs } from "@/components/admin/Breadcrumbs";
import { SectionHeader } from "@/components/admin/SectionHeader";

/**
 * UI Audit Slice 4 (2026-04-28) — Roster hub layout.
 *
 * Wraps every /admin/people/* page with the hub sub-tab strip
 * (Players · Orgs · Users · Roles · Sessions). Pages stay self-contained;
 * this layout only renders the chrome.
 *
 * Area gate: requires `users.edit` (the Roster hub's perm). Per-tab perms
 * are re-validated inside each page; the layout still hides invisible
 * tabs from the strip via per-subtab `hasPermAsync`.
 */

export const dynamic = "force-dynamic";

const HUB = ADMIN_HUBS.find((h) => h.key === "roster")!;

export default async function PeopleLayout({ children }: { children: ReactNode }) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/people");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/people");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const svc = getServiceRoleSupabase();
  const actor = { userId: pub.id, roles };
  await requirePermAsync(svc, actor, HUB.perm);

  const visibleViaCheck = await Promise.all(
    HUB.subtabs?.map(async (t) => ({
      tab: t,
      ok: await hasPermAsync(svc, actor, t.perm ?? HUB.perm),
    })) ?? [],
  );
  const visibleSubtabsResolved = visibleViaCheck.filter((c) => c.ok).map((c) => c.tab);

  return (
    <div className="space-y-6" data-testid="people-shell">
      <SectionHeader
        eyebrow="Roster"
        title="People & access"
        description="Players, orgs, contracts, ledger, accounts, role assignments, and live sessions for the Elite 2025-26 platform."
      />
      <Breadcrumbs />
      <HubSubnav hub={HUB} visibleSubtabs={visibleSubtabsResolved} />
      {children}
    </div>
  );
}
