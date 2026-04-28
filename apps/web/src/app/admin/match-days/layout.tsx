import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync, requirePermAsync } from "@/lib/perms-db";
import { ADMIN_HUBS } from "@/lib/admin-nav";
import { HubSubnav } from "@/components/admin/HubSubnav";
import { Breadcrumbs } from "@/components/admin/Breadcrumbs";

/**
 * UI Audit Slice 4 (2026-04-28) — Match days hub layout.
 *
 * The match-days surface keeps its canonical URL (/admin/match-days)
 * because Mon-Fri operational rhythm makes it the most-trafficked admin
 * surface during a season. Now wraps every page with breadcrumbs +
 * HubSubnav (Calendar · Stats Review).
 */

export const dynamic = "force-dynamic";

const HUB = ADMIN_HUBS.find((h) => h.key === "match-days")!;

export default async function MatchDaysLayout({ children }: { children: ReactNode }) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/match-days");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/match-days");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const svc = getServiceRoleSupabase();
  const actor = { userId: pub.id, roles };
  await requirePermAsync(svc, actor, HUB.perm);

  const checks = await Promise.all(
    HUB.subtabs?.map(async (t) => ({
      tab: t,
      ok: await hasPermAsync(svc, actor, t.perm ?? HUB.perm),
    })) ?? [],
  );
  const visibleSubtabsResolved = checks.filter((c) => c.ok).map((c) => c.tab);

  return (
    <div className="space-y-6" data-testid="match-days-shell">
      <Breadcrumbs />
      <HubSubnav hub={HUB} visibleSubtabs={visibleSubtabsResolved} />
      {children}
    </div>
  );
}
