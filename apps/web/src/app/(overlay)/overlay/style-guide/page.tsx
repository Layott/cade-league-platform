import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { StyleGuideClient } from "./StyleGuideClient";

export const dynamic = "force-dynamic";

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, "broadcast.manage");
  } catch (err) {
    if (err instanceof PermissionError) throw err;
    throw err;
  }
}

export default async function StyleGuidePage({
  searchParams,
}: {
  searchParams: Promise<{ dev?: string }>;
}) {
  // Audit Slice 1 (2026-04-28) — dev-only gate. Returns 404 unless `?dev=1`
  // is passed so the route is hidden from anyone scanning the URL space.
  const { dev } = await searchParams;
  if (dev !== "1") notFound();

  await resolveAdmin();
  return <StyleGuideClient />;
}
