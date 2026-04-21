import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill, roleTone } from "@/components/admin/StatusPill";
import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import { FormField, selectClass } from "@/components/admin/FormField";
import { formatWat } from "@/lib/time";
import { ROLE_NAMES } from "@/perms";
import { assignRoleAction, removeRoleAction } from "../actions";

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

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await resolveAdmin();

  const { data: user } = await sb
    .from("users")
    .select("id, email, display_name, last_login_at, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!user) notFound();

  const { data: rolesRows } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", id)
    .is("deleted_at", null);
  const currentRoles = ((rolesRows ?? []) as { role: string }[])
    .map((r) => r.role)
    .sort();

  const remainingRoles = ROLE_NAMES.filter(
    (r) => !currentRoles.includes(r),
  );

  const { data: auditRows } = await sb
    .from("audit_events")
    .select("id, action, entity_type, entity_id, created_at, actor_user_id")
    .or(`entity_id.eq.${id},actor_user_id.eq.${id}`)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="People & access"
        title={user.display_name ?? user.email}
        description={user.email}
        action={
          <Link href="/admin/users">
            <SecondaryButton type="button">← All users</SecondaryButton>
          </Link>
        }
      />

      <section
        aria-labelledby="roles-heading"
        className="space-y-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      >
        <h2
          id="roles-heading"
          className="font-display text-lg font-bold text-[var(--chalk-0)]"
        >
          Roles
        </h2>
        {currentRoles.length === 0 ? (
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--chalk-3)]">
            No roles assigned.
          </p>
        ) : (
          <ul
            className="flex flex-wrap gap-2"
            data-testid="current-roles"
          >
            {currentRoles.map((role) => (
              <li key={role} className="flex items-center gap-1.5">
                <StatusPill tone={roleTone(role)}>
                  {role.replace(/_/g, " ")}
                </StatusPill>
                <form action={removeRoleAction}>
                  <input type="hidden" name="userId" value={id} />
                  <input type="hidden" name="role" value={role} />
                  <DangerButton
                    size="sm"
                    type="submit"
                    aria-label={`Remove ${role} role`}
                    data-testid={`remove-role-${role}`}
                  >
                    ×
                  </DangerButton>
                </form>
              </li>
            ))}
          </ul>
        )}

        {remainingRoles.length > 0 ? (
          <form
            action={assignRoleAction}
            className="flex flex-wrap items-end gap-3 border-t border-[var(--ink-4)] pt-4"
            data-testid="add-role-form"
          >
            <input type="hidden" name="userId" value={id} />
            <FormField label="Add role" htmlFor="add-role-select">
              <select
                id="add-role-select"
                name="role"
                className={selectClass}
                defaultValue=""
                required
              >
                <option value="" disabled>
                  Choose a role
                </option>
                {remainingRoles.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </FormField>
            <PrimaryButton type="submit">Add role</PrimaryButton>
          </form>
        ) : (
          <p className="text-xs text-[var(--chalk-3)]">
            Every defined role is already assigned to this user.
          </p>
        )}
      </section>

      <section
        aria-labelledby="sessions-heading"
        className="space-y-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      >
        <h2
          id="sessions-heading"
          className="font-display text-lg font-bold text-[var(--chalk-0)]"
        >
          Sessions
        </h2>
        <p className="text-xs text-[var(--chalk-2)]">
          Last login:{" "}
          <span className="font-mono text-[var(--chalk-1)] tabular">
            {user.last_login_at
              ? formatWat(user.last_login_at, "yyyy-MM-dd HH:mm")
              : "never"}
          </span>
        </p>
        <Link
          href={`/admin/security/sessions?userId=${id}`}
          className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--signal)] underline-offset-4 hover:underline"
        >
          View session history →
        </Link>
      </section>

      <section
        aria-labelledby="audit-heading"
        className="space-y-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      >
        <h2
          id="audit-heading"
          className="font-display text-lg font-bold text-[var(--chalk-0)]"
        >
          Audit trail
        </h2>
        {!auditRows || auditRows.length === 0 ? (
          <p className="text-xs text-[var(--chalk-3)]">No events.</p>
        ) : (
          <ol className="divide-y divide-[var(--ink-4)] overflow-hidden rounded-sm border border-[var(--ink-4)]">
            {(
              auditRows as {
                id: string;
                action: string;
                entity_type: string;
                entity_id: string | null;
                created_at: string;
              }[]
            ).map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 px-4 py-2.5 text-xs sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="font-mono text-[11px] text-[var(--chalk-3)] tabular">
                  {formatWat(row.created_at, "MMM d · HH:mm")}
                </span>
                <span
                  className={
                    "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] " +
                    (row.action === "insert"
                      ? "border-[rgba(0,255,136,0.4)] bg-[rgba(0,255,136,0.08)] text-[var(--signal)]"
                      : row.action === "update"
                        ? "border-[rgba(255,176,32,0.4)] bg-[rgba(255,176,32,0.08)] text-[var(--amber)]"
                        : "border-[rgba(255,91,59,0.4)] bg-[rgba(255,91,59,0.08)] text-[var(--flare)]")
                  }
                >
                  {row.action}
                </span>
                <span className="font-mono text-[11px] text-[var(--chalk-2)]">
                  {row.entity_type}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
