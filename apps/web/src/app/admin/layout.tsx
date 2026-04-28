import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { ADMIN_HUBS } from "@/lib/admin-nav";

/**
 * /admin/* layout.
 *
 * UI Audit Slice 4 (2026-04-28) — visibility is now resolved per HUB
 * (the 8 ADMIN_HUBS), not per legacy tab href. Each hub's `perm` is
 * the READ gate; sub-tab visibility is resolved inside each hub's
 * own layout. Admin wildcard ⇒ all hubs; moderator/loc/idc/referee
 * see the subset their seeded perms allow.
 */

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const svc = getServiceRoleSupabase();
  const actor = { userId: pub.id, roles };
  const checks = await Promise.all(
    ADMIN_HUBS.map(async (h) => ({
      key: h.key,
      visible: await hasPermAsync(svc, actor, h.perm),
    })),
  );
  const visibleHubKeys = checks.filter((c) => c.visible).map((c) => c.key);

  return <AdminShell visibleHubs={visibleHubKeys}>{children}</AdminShell>;
}
