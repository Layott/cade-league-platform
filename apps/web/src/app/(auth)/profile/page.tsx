import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getProfileView } from "@/server/profile/read";
import { ProfilePanel } from "@/components/profile/ProfilePanel";
import { SectionHeader } from "@/components/admin/SectionHeader";

export const dynamic = "force-dynamic";

/**
 * Plan 40 (P40-B) — `/profile` (self view).
 *
 * Server component. Unauthenticated callers are redirected to
 * `/login?next=/profile`. Anon SSR client is fine here because the
 * `users_self_select` RLS policy grants the caller SELECT on their own
 * PII row (email, display_name); Plan 39 column-level grants do NOT apply
 * when the session is authenticated against the same row.
 */
export default async function ProfileSelfPage() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login?next=/profile");

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pub) redirect("/login?next=/profile");

  const { data: roleRows } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const profile = await getProfileView(sb, {
    userId: pub.id as string,
    roles,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-6 md:py-10">
      <SectionHeader
        eyebrow="Profile"
        title={profile.displayName || "Your profile"}
        description="Edit your display name, photo, and bio. Role assignments + email live on the admin surface."
      />
      <ProfilePanel
        profile={profile}
        editable
        actorUserId={pub.id as string}
      />
    </div>
  );
}
