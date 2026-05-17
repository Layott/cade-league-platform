import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { getDesign } from "@/server/overlays/builder/designs";
import { CanvasEditorShell } from "@/components/admin/builder/CanvasEditorShell";

export const dynamic = "force-dynamic";

/**
 * Wave 1A — `/admin/broadcast/v2/builder/[slug]/edit` canvas editor page.
 *
 * Perm-gates on `overlay.design.manage`, loads the design by slug, and
 * renders the full-screen CanvasEditorShell which hydrates the zustand
 * store and lays out all editor panels.
 *
 * Mirrors the auth + perm-gate pattern used by the library page sibling
 * at `apps/web/src/app/admin/broadcast/v2/builder/page.tsx`.
 */

async function resolveAdmin(returnPath: string) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect(`/login?next=${returnPath}`);
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect(`/login?next=${returnPath}`);
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

export default async function BuilderEditPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { sb } = await resolveAdmin(`/admin/broadcast/v2/builder/${slug}/edit`);
  const design = await getDesign(sb, slug);
  if (!design) notFound();
  return <CanvasEditorShell design={design} />;
}
