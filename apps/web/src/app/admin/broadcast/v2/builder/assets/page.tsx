import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { listPsdAssets } from "@/server/overlays/builder/assets";
import { AssetsLibrary } from "@/components/admin/builder/AssetsLibrary";
import { featureFlags } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

/**
 * Wave 2A — `/admin/broadcast/v2/builder/assets` library page.
 *
 * Perm-gates on overlay.design.manage. Currently lists PSD assets only;
 * image + font tabs ship in Wave 1B with their own server-side reads.
 */

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/broadcast/v2/builder/assets");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/broadcast/v2/builder/assets");
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

export default async function AssetsLibraryPage() {
  if (!featureFlags.overlayBuilder.enabled) {
    notFound();
  }
  const { sb } = await resolveAdmin();
  const psdAssets = await listPsdAssets(sb);
  return (
    <main className="min-h-screen bg-black text-white">
      <AssetsLibrary
        psdAssets={psdAssets}
        photopeaEnabled={featureFlags.overlayBuilder.photopeaEnabled}
      />
    </main>
  );
}
