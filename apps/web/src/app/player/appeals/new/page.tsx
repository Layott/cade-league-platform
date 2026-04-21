import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { SubmitAppealForm } from "./SubmitAppealForm";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

async function resolveGate() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/player/appeals/new");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/player/appeals/new");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "appeals.submit");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: appeals.submit");
    throw e;
  }
  return { sb: svc, userId: pub.id };
}

export default async function NewAppealPage({
  searchParams,
}: {
  searchParams: Promise<{ caseId?: string }>;
}) {
  const { sb, userId } = await resolveGate();
  const sp = await searchParams;
  const caseId = sp.caseId;
  if (!caseId) return notFound();

  // Confirm the case exists and belongs to the submitter's player record.
  const { data: discCase } = await sb
    .from("disciplinary_cases")
    .select(
      "id, incident_type, opened_at, notes, player_id, players:players!inner(user_id)",
    )
    .eq("id", caseId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!discCase) return notFound();
  type CaseRow = {
    id: string;
    players: { user_id: string } | null;
  };
  const c = discCase as unknown as CaseRow;
  if (!c.players || c.players.user_id !== userId) return notFound();

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Appeal"
        title="Submit an appeal"
        description={
          <span className="text-xs">
            Against case{" "}
            <span className="font-mono text-[var(--chalk-1)]">{caseId.slice(0, 8)}</span>
            {" · "}
            {(discCase as { incident_type: string }).incident_type}
            {" · "}
            {formatWat(
              (discCase as { opened_at: string | null }).opened_at ?? new Date(),
              "yyyy-MM-dd",
            )}
          </span>
        }
      />
      <SubmitAppealForm caseId={caseId} />
    </div>
  );
}
