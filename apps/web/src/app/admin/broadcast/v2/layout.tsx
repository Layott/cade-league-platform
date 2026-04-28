import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync, requirePermAsync } from "@/lib/perms-db";
import { ADMIN_HUBS } from "@/lib/admin-nav";
import { HubSubnav } from "@/components/admin/HubSubnav";
import { Breadcrumbs } from "@/components/admin/Breadcrumbs";

/**
 * Plan 51 — /admin/broadcast/v2/* layout.
 *
 * UI Audit Slice 4 (2026-04-28) — migrated from per-hub BroadcastHubTabs
 * to the shared HubSubnav driven by `lib/admin-nav.ts`. Adds
 * breadcrumbs.
 *
 * Area gate (requires `broadcast.v2.read`). Per-action perms (e.g.
 * `broadcast.v2.trigger`) are re-checked inside the session control
 * surface.
 */

export const dynamic = "force-dynamic";

const HUB = ADMIN_HUBS.find((h) => h.key === "broadcast")!;

export default async function BroadcastV2Layout({
  children,
}: {
  children: ReactNode;
}) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/broadcast/v2");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/broadcast/v2");

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
    <div className="space-y-6" data-testid="broadcast-v2-shell">
      <Breadcrumbs />
      <HubSubnav hub={HUB} visibleSubtabs={visibleSubtabsResolved} />
      {children}
    </div>
  );
}
