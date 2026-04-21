import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { ROLE_NAMES, PERMS } from "@/perms";
import { MatrixEditor } from "./MatrixEditor";

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
    await requirePermAsync(sb, { userId: pub.id, roles }, "roles.edit");
  } catch (err) {
    if (err instanceof PermissionError) {
      throw err; // Next.js surfaces as 500; middleware has already gated
      // non-admin/moderator at /admin. admin's wildcard row covers
      // roles.edit so only genuine admins reach this page.
    }
    throw err;
  }
  return sb;
}

export default async function RolesPage() {
  const sb = await resolveAdmin();

  // Load current matrix from DB.
  const { data: rows } = await sb
    .from("role_permissions")
    .select("role, permission");
  const matrix: Record<string, string[]> = {};
  for (const r of ROLE_NAMES) matrix[r] = [];
  for (const row of (rows ?? []) as { role: string; permission: string }[]) {
    const arr = matrix[row.role] ?? [];
    arr.push(row.permission);
    matrix[row.role] = arr;
  }

  // Permission universe = union of (all currently-granted) ∪ (seed perms).
  // Seed fallback guarantees a sensible starting set on a fresh install where
  // many roles have zero granted rows.
  const seedPerms = new Set<string>();
  for (const r of ROLE_NAMES) for (const p of PERMS[r]) seedPerms.add(p);
  const allPerms = new Set<string>(seedPerms);
  for (const row of (rows ?? []) as { role: string; permission: string }[]) {
    allPerms.add(row.permission);
  }
  // Also include the permission strings we *enforce* elsewhere in code but
  // haven't granted yet — this gives the admin a clean inventory of toggleable
  // actions without requiring a code change to surface them.
  const enforcedPerms = [
    "roles.edit",
    "users.edit",
  ];
  for (const p of enforcedPerms) allPerms.add(p);

  const sortedPerms = Array.from(allPerms).sort((a, b) => {
    // wildcard first, then alphabetical
    if (a === "*") return -1;
    if (b === "*") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Access control"
        title="Role permissions"
        description="Toggle a cell to grant or revoke. Saves atomically, propagates within 30 seconds across all servers, and writes to the audit log."
      />
      <div
        className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
        data-testid="roles-matrix-wrapper"
      >
        <p className="mb-4 text-xs leading-relaxed text-[var(--chalk-2)]">
          <span className="font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
            Heads up —
          </span>{" "}
          The <code className="font-mono text-[var(--signal)]">admin × *</code>{" "}
          cell is locked. To reduce admin power, revoke specific permissions
          from other roles; never remove the wildcard.
        </p>
        <MatrixEditor
          roles={ROLE_NAMES}
          permissions={sortedPerms}
          initialMatrix={matrix}
        />
      </div>
    </div>
  );
}
