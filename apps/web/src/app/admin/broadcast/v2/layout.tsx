import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";

/**
 * Plan 51 — /admin/broadcast/v2/* layout.
 *
 * Area gate (requires `broadcast.v2.read`). Per-action perms (e.g.
 * `broadcast.v2.trigger`) are re-checked inside the session control
 * surface owned by sibling agent UI-BC.
 */

export const dynamic = "force-dynamic";

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
  await requirePermAsync(svc, { userId: pub.id, roles }, "broadcast.v2.read");

  return (
    <div className="space-y-6" data-testid="broadcast-v2-shell">
      <SectionHeader
        eyebrow="Broadcast v2"
        title="Overlay control room"
        description="Next-gen overlay router. Pick a session to drive overlays, or start a new one. Browser sources continue to read /overlay/v2/<key>?session=<id>&token=<viewToken>."
      />
      {children}
    </div>
  );
}
