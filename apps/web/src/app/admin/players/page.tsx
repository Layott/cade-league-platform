import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { PrimaryButton } from "@/components/admin/buttons";

export const dynamic = "force-dynamic";

type PlayerRow = {
  id: string;
  user_id: string;
  display_name: string;
  gamer_tag: string;
  psn_id: string | null;
  jersey_number: number | null;
  photo_url: string | null;
  organization_id: string | null;
  organization_name: string | null;
};

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/players");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/players");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const sb = getServiceRoleSupabase();
  await requirePermAsync(sb, { userId: pub.id, roles }, "users.edit");
  return sb;
}

export default async function AdminPlayersPage() {
  const sb = await resolveAdmin();

  const { data: playersRaw, error } = await sb
    .from("players")
    .select(
      `
        id, user_id, gamer_tag, psn_id, jersey_number, photo_url,
        organization_id,
        users:users!players_user_id_fkey!inner ( display_name ),
        organizations:organization_id ( name )
      `,
    )
    .is("deleted_at", null)
    .order("jersey_number", { ascending: true, nullsFirst: false })
    .limit(200);
  if (error) throw error;

  const rows = ((playersRaw ?? []) as unknown as Array<{
    id: string;
    user_id: string;
    gamer_tag: string;
    psn_id: string | null;
    jersey_number: number | null;
    photo_url: string | null;
    organization_id: string | null;
    users: { display_name: string };
    organizations: { name: string } | null;
  }>).map<PlayerRow>((p) => ({
    id: p.id,
    user_id: p.user_id,
    display_name: p.users.display_name,
    gamer_tag: p.gamer_tag,
    psn_id: p.psn_id,
    jersey_number: p.jersey_number,
    photo_url: p.photo_url,
    organization_id: p.organization_id,
    organization_name: p.organizations?.name ?? null,
  }));

  const cols: DataTableColumn<PlayerRow>[] = [
    {
      key: "photo",
      label: "Photo",
      render: (p) => (
        <div className="h-10 w-10 overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]">
          {p.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.photo_url}
              alt={p.display_name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--chalk-3)]">
              —
            </div>
          )}
        </div>
      ),
    },
    {
      key: "display_name",
      label: "Display name",
      render: (p) => (
        <Link
          href={`/admin/players/${p.id}/edit`}
          className="font-display text-sm font-semibold text-[var(--chalk-0)] underline-offset-4 hover:text-[var(--signal)] hover:underline"
        >
          {p.display_name}
        </Link>
      ),
    },
    {
      key: "gamer_tag",
      label: "Gamer tag",
      render: (p) => (
        <span className="font-mono text-xs text-[var(--chalk-1)]">
          {p.gamer_tag}
        </span>
      ),
    },
    {
      key: "psn",
      label: "PSN",
      render: (p) =>
        p.psn_id ? (
          <span className="font-mono text-xs text-[var(--chalk-2)]">
            {p.psn_id}
          </span>
        ) : (
          <span className="text-[var(--chalk-3)]">—</span>
        ),
    },
    {
      key: "jersey",
      label: "#",
      align: "right",
      render: (p) =>
        p.jersey_number !== null ? (
          <span className="tabular font-mono text-sm text-[var(--chalk-0)]">
            {p.jersey_number}
          </span>
        ) : (
          <span className="text-[var(--chalk-3)]">—</span>
        ),
    },
    {
      key: "org",
      label: "Org",
      render: (p) =>
        p.organization_name ? (
          <StatusPill tone="primary">{p.organization_name}</StatusPill>
        ) : (
          <span className="text-[var(--chalk-3)]">—</span>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (p) => (
        <Link
          href={`/admin/players/${p.id}/edit`}
          className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
        >
          Edit →
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Site Manager"
        title="Players"
        description="Full 13-player roster. Click a row to edit display name, gamer tag, PSN, jersey, bio, photo, org, coach, team manager."
        action={
          <Link href="/admin/users/new">
            <PrimaryButton>+ New user</PrimaryButton>
          </Link>
        }
      />

      <DataTable
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        emptyLabel="No players yet"
        emptyHint="Create users via /admin/users/new; the players table is seeded on first import."
      />
    </div>
  );
}
