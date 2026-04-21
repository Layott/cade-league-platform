import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";

/**
 * /admin/* layout. Resolves `visibleTabs` once per request using
 * `hasPermAsync` so the client-side AdminSubnav can render only the tabs
 * the viewer can use. Admin wildcard perm ⇒ all tabs; moderator sees most;
 * narrow-scope roles (idc, loc, referee) see only their subset.
 *
 * Permission map per Plan 13B §4.3 for the plan-13 tabs, plus the
 * historical tab set (Dashboard, Match days, Punishments, etc.) which
 * uses `audit.read` as a reasonable visibility proxy for LOC/moderator
 * (every existing admin-reachable role either has audit.read or is
 * admin wildcard).
 */

// List of every tab href registered in AdminSubnav.tsx.
const TAB_PERMS: Array<{ href: string; perm: string }> = [
  { href: "/admin", perm: "audit.read" },
  { href: "/admin/match-days", perm: "matches.read" },
  { href: "/admin/punishments", perm: "punishments.read" },
  { href: "/admin/squads", perm: "squads.validate" },
  { href: "/admin/orgs", perm: "orgs.read" },
  { href: "/admin/disputes", perm: "disputes.read" },
  { href: "/admin/appeals", perm: "appeals.read" },
  { href: "/admin/content", perm: "content.verify" },
  { href: "/admin/preseason", perm: "preseason.manage" },
  { href: "/admin/announcements", perm: "announcements.read" },
  { href: "/admin/broadcast", perm: "broadcast.manage" },
  { href: "/admin/roles", perm: "roles.manage" },
  { href: "/admin/users", perm: "users.manage" },
  { href: "/admin/trash", perm: "trash.restore" },
  { href: "/admin/security/sessions", perm: "security.sessions.read" },
];

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
    TAB_PERMS.map(async (t) => ({
      href: t.href,
      visible: await hasPermAsync(svc, actor, t.perm),
    })),
  );
  const visibleTabs = checks.filter((c) => c.visible).map((c) => c.href);

  return <AdminShell visibleTabs={visibleTabs}>{children}</AdminShell>;
}
