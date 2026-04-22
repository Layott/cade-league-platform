import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import {
  FormField,
  inputClass,
  selectClass,
} from "@/components/admin/FormField";
import {
  PrimaryButton,
  SecondaryButton,
} from "@/components/admin/buttons";
import { ROLE_NAMES } from "@/perms";
import { createUserAction } from "../actions";

export const dynamic = "force-dynamic";

async function gate() {
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
  await requirePermAsync(sb, { userId: pub.id, roles }, "users.create");
}

export default async function NewUserPage() {
  await gate();

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="People & access"
        title="Add user"
        description="Create a new account. The user will receive an email confirmation; a default password is issued if you leave the field blank."
        action={
          <Link href="/admin/users">
            <SecondaryButton type="button">← All users</SecondaryButton>
          </Link>
        }
      />

      <form
        action={createUserAction}
        className="max-w-2xl space-y-6 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6"
        data-testid="new-user-form"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Email" htmlFor="new-user-email">
            <input
              id="new-user-email"
              name="email"
              type="email"
              required
              className={inputClass}
              data-testid="new-user-email"
            />
          </FormField>

          <FormField label="Display name" htmlFor="new-user-display-name">
            <input
              id="new-user-display-name"
              name="display_name"
              type="text"
              required
              className={inputClass}
              data-testid="new-user-display-name"
            />
          </FormField>

          <FormField label="Gamer tag (optional)" htmlFor="new-user-gamer-tag">
            <input
              id="new-user-gamer-tag"
              name="gamer_tag"
              type="text"
              className={inputClass}
              data-testid="new-user-gamer-tag"
            />
          </FormField>

          <FormField label="Jersey # (optional)" htmlFor="new-user-jersey">
            <input
              id="new-user-jersey"
              name="jersey_number"
              type="number"
              min={1}
              max={99}
              className={inputClass}
              data-testid="new-user-jersey"
            />
          </FormField>

          <FormField
            label="Password (optional)"
            htmlFor="new-user-password"
            hint="Leave blank to issue the dev default; the user must reset on first login."
          >
            <input
              id="new-user-password"
              name="password"
              type="text"
              className={inputClass + " font-mono"}
              minLength={8}
              data-testid="new-user-password"
            />
          </FormField>

          <FormField label="Initial role (optional)" htmlFor="new-user-role">
            <select
              id="new-user-role"
              name="role"
              className={selectClass}
              defaultValue=""
              data-testid="new-user-role"
            >
              <option value="">No role</option>
              {ROLE_NAMES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--ink-4)] pt-5">
          <PrimaryButton type="submit" data-testid="new-user-submit">
            Create user
          </PrimaryButton>
          <Link href="/admin/users" className="ml-auto">
            <SecondaryButton type="button">Cancel</SecondaryButton>
          </Link>
        </div>
      </form>
    </div>
  );
}
