import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { SubmitDisputeForm } from "./SubmitDisputeForm";

export const dynamic = "force-dynamic";

async function resolveGate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/player/disputes/new");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/player/disputes/new");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "disputes.submit");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: disputes.submit");
    throw e;
  }
}

export default async function NewDisputePage() {
  await resolveGate();
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Disputes"
        title="Raise a dispute"
        description="Describe the issue clearly. IDC/LOC will review and rule. Redact personal info before uploading evidence — reviewers see the files you upload."
      />
      <SubmitDisputeForm />
    </div>
  );
}
