import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  getOrgById,
  listPlayersForOrg,
} from "@/server/orgs";
import { CreateContractForm } from "./CreateContractForm";

export const dynamic = "force-dynamic";

async function resolveGate() {
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
  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, { userId: pub.id, roles }, "orgs.edit");
  } catch (e) {
    if (e instanceof PermissionError) throw new Error("Forbidden: orgs.edit");
    throw e;
  }
  return svc;
}

export default async function NewContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const sb = await resolveGate();
  const { id } = await params;
  const org = await getOrgById(sb, id);
  if (!org) return notFound();

  const [players, seasonsRes] = await Promise.all([
    listPlayersForOrg(sb, org.id),
    sb
      .from("seasons")
      .select("id, year_range, status")
      .is("deleted_at", null)
      .order("status", { ascending: false })
      .limit(20),
  ]);
  const seasons = ((seasonsRes.data ?? []) as {
    id: string;
    year_range: string;
    status: string;
  }[]).map((s) => ({
    id: s.id,
    label: `${s.year_range} (${s.status})`,
  }));

  const playerOpts = players.map((p) => ({
    id: p.id,
    label: `${p.display_name} (${p.gamer_tag})`,
  }));

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={org.name}
        title="New contract"
        description="Upload + link a player contract. Active status immediately locks out any other active contract for this (player, season)."
      />

      {players.length === 0 ? (
        <p className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 text-sm text-[var(--chalk-2)]">
          No players linked to this org yet. Link at least one player first.
        </p>
      ) : (
        <CreateContractForm
          orgId={org.id}
          players={playerOpts}
          seasons={seasons}
        />
      )}
    </div>
  );
}
