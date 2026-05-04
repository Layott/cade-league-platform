import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, hasPermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { Breadcrumbs } from "@/components/admin/Breadcrumbs";
import { HubSubnav } from "@/components/admin/HubSubnav";
import { ADMIN_HUBS } from "@/lib/admin-nav";
import { listActiveTemplates } from "@/server/social/templates";
import { listRecentJobs } from "@/server/social/jobs";
import { TemplateGrid } from "@/components/admin/broadcast/social/TemplateGrid";
import { RenderJobsTable } from "@/components/admin/broadcast/social/RenderJobsTable";

/**
 * Plan 54 Wave 2B — `/admin/broadcast/social` landing page.
 *
 * Server component. Renders the 5 Phase-1 template tiles + a recent-
 * renders table sourced from `social_render_jobs`. Tiles deep-link to
 * the per-template config page where the admin picks a size + triggers
 * a render.
 *
 * The page lives OUTSIDE the `/admin/broadcast/v2/` layout so it can
 * stand on its own auth gate (matching the spec's URL `/admin/broadcast/
 * social`). The Broadcast hub subnav is rendered inline so the hub-tab
 * affordance still appears alongside Sessions / Stingers / Design /
 * Branding / YouTube / Social.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §6
 * (Phase 1, file structure: `apps/web/src/app/admin/broadcast/social/page.tsx`).
 */

export const dynamic = "force-dynamic";

const HUB = ADMIN_HUBS.find((h) => h.key === "broadcast")!;

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/broadcast/social");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/broadcast/social");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const sb = getServiceRoleSupabase();
  const actor = { userId: pub.id, roles };
  try {
    await requirePermAsync(sb, actor, "social.read");
  } catch (err) {
    if (err instanceof PermissionError) throw err;
    throw err;
  }
  return { sb, actor };
}

export default async function BroadcastSocialPage() {
  const { sb, actor } = await resolveAdmin();

  // Pre-resolve subtab visibility so the HubSubnav strip renders the
  // same set this user can navigate to. Mirror of broadcast/v2/layout.tsx.
  const subtabChecks = await Promise.all(
    HUB.subtabs?.map(async (t) => ({
      tab: t,
      ok: await hasPermAsync(sb, actor, t.perm ?? HUB.perm),
    })) ?? [],
  );
  const visibleSubtabs = subtabChecks.filter((c) => c.ok).map((c) => c.tab);

  const templates = listActiveTemplates();
  const jobs = await listRecentJobs(sb, actor, 50);

  return (
    <div className="space-y-6" data-testid="admin-broadcast-social">
      <Breadcrumbs />
      <HubSubnav hub={HUB} visibleSubtabs={visibleSubtabs} />

      <SectionHeader
        eyebrow="Broadcast"
        title="Social Media Assets"
        description="Generate IG / TikTok / X / Reel-sized assets from live league data. Pick a template, choose a size, and download — every render is logged below for review and approval."
      />

      <section className="space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
          Templates · {templates.length}
        </h2>
        <TemplateGrid templates={templates} />
      </section>

      <section className="space-y-3" data-testid="recent-renders-section">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
          Recent renders · last {jobs.length}
        </h2>
        <RenderJobsTable jobs={jobs} />
      </section>
    </div>
  );
}
