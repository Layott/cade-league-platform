import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { CreateOrgForm } from "./CreateOrgForm";

export const dynamic = "force-dynamic";

async function resolveGate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/people/orgs/new");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/people/orgs/new");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "orgs.edit");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: orgs.edit");
    throw e;
  }
  return svc;
}

export default async function NewOrgPage() {
  const sb = await resolveGate();
  const { data: users } = await sb
    .from("users")
    .select("id, display_name, email")
    .is("deleted_at", null)
    .order("display_name", { ascending: true })
    .limit(200);
  const options = (users ?? []) as {
    id: string;
    display_name: string | null;
    email: string;
  }[];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Organizations"
        title="Register a new organization"
        description="Plan 31 — orgs simplified. Logo is the only file field; coach + team-manager assignments happen on the org detail page after players are linked."
      />
      <CreateOrgForm users={options} />
    </div>
  );
}
