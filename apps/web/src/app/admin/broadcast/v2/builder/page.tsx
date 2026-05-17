import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { listDesigns } from "@/server/overlays/builder/designs";
import { BuilderLibrary } from "@/components/admin/builder/BuilderLibrary";

export const dynamic = "force-dynamic";

/**
 * Wave 1A — `/admin/broadcast/v2/builder` library page.
 *
 * Perm-gates on `overlay.design.manage` then lists all non-deleted
 * designs and hands them to the client BuilderLibrary component.
 *
 * Mirrors the auth + perm-gate pattern used by
 * `apps/web/src/app/admin/broadcast/v2/design/page.tsx`.
 */

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/broadcast/v2/builder");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/broadcast/v2/builder");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, "overlay.design.manage");
  } catch (err) {
    if (err instanceof PermissionError) {
      redirect("/admin?error=forbidden");
    }
    throw err;
  }
  return { sb };
}

export default async function BuilderLibraryPage() {
  const { sb } = await resolveAdmin();
  const designs = await listDesigns(sb);
  return (
    <main className="min-h-screen bg-black text-white">
      <BuilderLibrary designs={designs} />
    </main>
  );
}
