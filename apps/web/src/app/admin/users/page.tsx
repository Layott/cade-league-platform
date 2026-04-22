import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { StatusPill, roleTone } from "@/components/admin/StatusPill";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { formatWat } from "@/lib/time";
import { listUsersWithRoles, type UserWithRoles } from "@/server/roles";

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
  await requirePermAsync(sb, { userId: pub.id, roles }, "users.edit");
  return sb;
}

export default async function UsersListPage() {
  const sb = await resolveAdmin();
  const rows = await listUsersWithRoles(sb);

  const columns: DataTableColumn<UserWithRoles>[] = [
    {
      key: "email",
      label: "Email",
      render: (r) => (
        <Link
          href={`/admin/users/${r.id}`}
          className="font-display text-sm font-semibold text-[var(--chalk-0)] underline-offset-4 hover:text-[var(--signal)] hover:underline"
        >
          {r.email}
        </Link>
      ),
    },
    {
      key: "display_name",
      label: "Display name",
      render: (r) => (
        <span className="text-sm text-[var(--chalk-1)]">
          {r.display_name ?? (
            <span className="text-[var(--chalk-3)]">—</span>
          )}
        </span>
      ),
    },
    {
      key: "roles",
      label: "Roles",
      render: (r) =>
        r.roles.length === 0 ? (
          <span className="text-xs uppercase tracking-[0.2em] text-[var(--chalk-3)]">
            no roles
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {r.roles.map((role) => (
              <StatusPill key={role} tone={roleTone(role)}>
                {role.replace(/_/g, " ")}
              </StatusPill>
            ))}
          </div>
        ),
    },
    {
      key: "last_login",
      label: "Last login",
      render: (r) => (
        <span className="font-mono text-[11px] text-[var(--chalk-3)] tabular">
          {r.last_login_at
            ? formatWat(r.last_login_at, "yyyy-MM-dd HH:mm")
            : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (r) => (
        <Link href={`/admin/users/${r.id}`}>
          <SecondaryButton size="sm" type="button">
            Manage
          </SecondaryButton>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="People & access"
        title="Users & roles"
        description="Everyone registered on the platform. Click through to add or remove roles per user."
        action={
          <Link href="/admin/users/new">
            <PrimaryButton type="button" data-testid="add-user-button">
              + Add user
            </PrimaryButton>
          </Link>
        }
      />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        testId="users-table"
        emptyLabel="No users yet"
        emptyHint="Seed the roster to populate this list."
      />
    </div>
  );
}
