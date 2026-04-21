import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { SectionHeader } from "@/components/admin/SectionHeader";

export const dynamic = "force-dynamic";

/**
 * Plan 13B — minimal player profile stub. Subnav needs a landing route;
 * richer profile surface is out of scope for this plan.
 */
export default async function PlayerProfilePage() {
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/player/profile");

  const { data: pub } = await sb
    .from("users")
    .select("id, display_name, email")
    .eq("supabase_auth_id", user.id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Profile"
        title={pub?.display_name ?? pub?.email ?? "—"}
        description="Read-only for now. Editing routes will land in a later plan."
      />
      <dl className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Email
            </dt>
            <dd className="font-mono text-xs text-[var(--chalk-1)]">
              {pub?.email ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Display name
            </dt>
            <dd className="text-[var(--chalk-0)]">
              {pub?.display_name ?? "—"}
            </dd>
          </div>
        </div>
      </dl>
    </div>
  );
}
