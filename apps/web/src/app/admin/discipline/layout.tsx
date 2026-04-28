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
 * UI Audit Slice 4 (2026-04-28) — Discipline hub layout.
 *
 * Punishments + Disputes + Appeals + Precedents are one workflow (rule
 * violation → sanction → optional dispute → optional appeal). Putting
 * them under a single hub eliminates context-switching when following a
 * single case across tabs.
 */

export const dynamic = "force-dynamic";

const HUB = ADMIN_HUBS.find((h) => h.key === "discipline")!;

export default async function DisciplineLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/discipline");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/discipline");

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
    <div className="space-y-6" data-testid="discipline-shell">
      <SectionHeader
        eyebrow="Discipline"
        title="Conduct & sanctions"
        description="Issue punishments, review disputes, rule on appeals, and inspect a player's offense history. One workflow, one hub."
      />
      <Breadcrumbs />
      <HubSubnav hub={HUB} visibleSubtabs={visibleSubtabsResolved} />
      {children}
    </div>
  );
}
