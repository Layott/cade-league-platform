import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
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
import { FormField, inputClass, selectClass } from "@/components/admin/FormField";
import { formatWat } from "@/lib/time";
import { ROLE_NAMES } from "@/perms";
import {
  assignRoleAction,
  removeRoleAction,
  updateUserAction,
  resetPasswordAction,
  softDeleteUserAction,
} from "../actions";

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ otp?: string }>;
}) {
  const { id } = await params;
  const { otp } = await searchParams;
  const sb = await resolveAdmin();

  const { data: user } = await sb
    .from("users")
    .select("id, email, display_name, last_login_at, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!user) notFound();

  const { data: player } = await sb
    .from("players")
    .select("id, gamer_tag, jersey_number")
    .eq("user_id", id)
    .is("deleted_at", null)
    .maybeSingle();

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

  // Plan 39 sanitize — alnum/hyphen/underscore-only validate before
  // composing into a `.or()` filter. Punctuation rejected so the id
  // can't escape the filter expression.
  const safeUserId = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "id contains forbidden characters")
    .parse(id);
  const { data: auditRows } = await sb
    .from("audit_events")
    .select("id, action, entity_type, entity_id, created_at, actor_user_id")
    .or(`entity_id.eq.${safeUserId},actor_user_id.eq.${safeUserId}`)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="People & access"
        title={user.display_name ?? user.email}
        description={user.email}
        action={
          <Link href="/admin/people/users">
            <SecondaryButton type="button">← All users</SecondaryButton>
          </Link>
        }
      />

      {otp ? (
        <section
          data-testid="otp-flash"
          className="rounded-sm border border-[var(--signal)] bg-[rgba(107,205,6,0.06)] p-5"
        >
          <h2 className="font-display text-base font-bold text-[var(--signal)]">
            One-time password generated
          </h2>
          <p className="mt-1 text-xs text-[var(--chalk-2)]">
            Copy this now — it will not be shown again. Hand it to the user
            via a secure channel; they should reset on first login.
          </p>
          <code
            className="mt-3 block break-all rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 font-mono text-sm text-[var(--chalk-0)]"
            data-testid="otp-value"
          >
            {otp}
          </code>
        </section>
      ) : null}

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
        aria-labelledby="profile-heading"
        className="space-y-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      >
        <h2
          id="profile-heading"
          className="font-display text-lg font-bold text-[var(--chalk-0)]"
        >
          Edit profile
        </h2>
        <form
          action={updateUserAction}
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
          data-testid="edit-profile-form"
        >
          <input type="hidden" name="id" value={id} />
          <FormField label="Display name" htmlFor="edit-display-name">
            <input
              id="edit-display-name"
              name="display_name"
              type="text"
              defaultValue={user.display_name ?? ""}
              className={inputClass}
              data-testid="edit-display-name"
            />
          </FormField>
          <FormField label="Gamer tag" htmlFor="edit-gamer-tag">
            <input
              id="edit-gamer-tag"
              name="gamer_tag"
              type="text"
              defaultValue={(player as { gamer_tag?: string } | null)?.gamer_tag ?? ""}
              className={inputClass}
              data-testid="edit-gamer-tag"
            />
          </FormField>
          <FormField label="Jersey #" htmlFor="edit-jersey">
            <input
              id="edit-jersey"
              name="jersey_number"
              type="number"
              min={1}
              max={99}
              defaultValue={
                (player as { jersey_number?: number | null } | null)
                  ?.jersey_number ?? ""
              }
              className={inputClass}
              data-testid="edit-jersey"
            />
          </FormField>
          <div className="sm:col-span-3">
            <PrimaryButton type="submit" data-testid="edit-profile-submit">
              Save profile
            </PrimaryButton>
          </div>
        </form>
      </section>

      <section
        aria-labelledby="password-heading"
        className="space-y-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
      >
        <h2
          id="password-heading"
          className="font-display text-lg font-bold text-[var(--chalk-0)]"
        >
          Reset password
        </h2>
        <p className="text-xs text-[var(--chalk-3)]">
          Sets a temporary password. The user keeps signing in with it until
          they reset it themselves.
        </p>
        <form
          action={resetPasswordAction}
          className="flex flex-wrap items-end gap-3"
          data-testid="reset-password-form"
        >
          <input type="hidden" name="id" value={id} />
          <FormField label="New password" htmlFor="reset-password-input">
            <input
              id="reset-password-input"
              name="new_password"
              type="text"
              minLength={12}
              required
              className={inputClass + " font-mono"}
              data-testid="reset-password-input"
            />
          </FormField>
          <SecondaryButton type="submit" data-testid="reset-password-submit">
            Set new password
          </SecondaryButton>
        </form>
      </section>

      <section
        aria-labelledby="danger-heading"
        className="space-y-4 rounded-sm border border-[rgba(255,91,59,0.35)] bg-[rgba(255,91,59,0.04)] p-5"
      >
        <h2
          id="danger-heading"
          className="font-display text-lg font-bold text-[var(--flare)]"
        >
          Danger zone
        </h2>
        <p className="text-xs text-[var(--chalk-2)]">
          Soft-deletes the user. The auth account stays in place so the audit
          history remains intact, and an admin can restore from{" "}
          <Link
            href="/admin/system/trash/users"
            className="text-[var(--signal)] underline-offset-4 hover:underline"
          >
            /admin/system/trash/users
          </Link>
          .
        </p>
        <details className="group rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-[var(--flare)]">
            Delete this user
          </summary>
          <form
            action={softDeleteUserAction}
            className="mt-3 flex flex-wrap items-center gap-3"
            data-testid="delete-user-form"
          >
            <input type="hidden" name="id" value={id} />
            <DangerButton type="submit" data-testid="delete-user-confirm">
              Confirm delete
            </DangerButton>
            <span className="text-[11px] text-[var(--chalk-3)]">
              This action is reversible from the trash.
            </span>
          </form>
        </details>
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
          href={`/admin/people/security/sessions?userId=${id}`}
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
                      ? "border-[rgba(107,205,6,0.4)] bg-[rgba(107,205,6,0.08)] text-[var(--primary)]"
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
