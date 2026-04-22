import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  getProfileView,
  PermissionError,
} from "@/server/profile/read";
import { ProfilePanel } from "@/components/profile/ProfilePanel";
import { SectionHeader } from "@/components/admin/SectionHeader";

export const dynamic = "force-dynamic";

/**
 * Plan 40 (P40-B) — `/profile/[userId]` (admin cross-view).
 *
 * Per spec §3.2: self-view and admin-only cross-view. When a non-admin
 * targets another user we translate the PermissionError into `notFound()`
 * (403-as-404 shim) so the route does not leak "this user exists."
 *
 * Uses the service-role client for the cross-view read because Plan 39
 * locks down PII columns (email) to service-role only for non-self rows.
 */
export default async function ProfileByIdPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId: targetUserId } = await params;

  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect(`/login?next=/profile/${targetUserId}`);

  // Plan 39 C2 revoked anon/authenticated SELECT on users.email —
  // getProfileView reads email so use service-role throughout. The
  // route is self-gated by the auth.getUser check above;
  // getProfileView itself enforces the admin cross-view perm check.
  const svc = getServiceRoleSupabase();

  const { data: pub } = await svc
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pub) redirect(`/login?next=/profile/${targetUserId}`);

  const { data: roleRows } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const isSelf = targetUserId === pub.id;
  const sb = svc;

  let profile;
  try {
    profile = await getProfileView(
      sb,
      { userId: pub.id as string, roles },
      targetUserId,
    );
  } catch (err) {
    if (err instanceof PermissionError) {
      // 403-as-404 so the route does not leak user existence.
      notFound();
    }
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-6 md:py-10">
      <SectionHeader
        eyebrow={isSelf ? "Profile" : "Profile · Admin view"}
        title={profile.displayName || "Profile"}
        description={
          isSelf
            ? "Your profile."
            : "Admin view. Display name, photo, and bio are editable; everything else stays read-only."
        }
      />
      <ProfilePanel
        profile={profile}
        editable
        actorUserId={pub.id as string}
      />
    </div>
  );
}
