import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync, requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { Breadcrumbs } from "@/components/admin/Breadcrumbs";
import { HubSubnav } from "@/components/admin/HubSubnav";
import { ADMIN_HUBS } from "@/lib/admin-nav";
import { getTemplate } from "@/server/social/templates";
import { listRecentJobs } from "@/server/social/jobs";
import {
  SocialTemplateKeyEnum,
  type SocialTemplateKeyValue,
} from "@/server/social/schemas";
import { TemplateConfigClient } from "@/components/admin/broadcast/social/TemplateConfigClient";
import { RenderJobsTable } from "@/components/admin/broadcast/social/RenderJobsTable";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 54 Wave 2B — `/admin/broadcast/social/[templateKey]`.
 *
 * Per-template config + preview + render trigger. Resolves the active
 * broadcast session (if any) so the OG endpoint has data to render
 * against. The template key is validated via the locked `SocialTemplateKeyEnum`
 * — invalid keys return a 404 rather than a 500.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §6.
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

/**
 * Find the most-recent ACTIVE broadcast session across all match-days.
 * Used as the OG-endpoint context — the social asset renders whatever
 * data the active session is on.
 *
 * Returns null when no active session exists; the UI then shows a
 * "start a session first" message in the preview pane.
 */
async function findActiveSession(
  sb: SupabaseClient,
): Promise<{ id: string; viewToken: string | null; matchDate: string | null; venueName: string | null } | null> {
  type Row = {
    id: string;
    match_day_id: string;
    started_at: string;
    view_token: string | null;
  };
  // Prefer an active (un-ended) session; if none, fall back to the most
  // recent session so the social page still has render data on a fresh
  // admin visit (most useful right after a match-day ends).
  const { data: active, error } = await sb
    .from("stream_sessions")
    .select("id, match_day_id, started_at, view_token")
    .is("ended_at", null)
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) return null;
  let sess = (active?.[0] ?? null) as Row | null;
  if (!sess) {
    const { data: recent } = await sb
      .from("stream_sessions")
      .select("id, match_day_id, started_at, view_token")
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    sess = (recent?.[0] ?? null) as Row | null;
  }
  if (!sess) return null;
  type MatchDayRow = {
    match_date: string | null;
    venue_name: string | null;
  };
  const { data: md } = await sb
    .from("match_days")
    .select("match_date, venue_name")
    .eq("id", sess.match_day_id)
    .is("deleted_at", null)
    .maybeSingle<MatchDayRow>();
  return {
    id: sess.id,
    viewToken: sess.view_token ?? null,
    matchDate: md?.match_date ?? null,
    venueName: md?.venue_name ?? null,
  };
}

export default async function SocialTemplatePage({
  params,
}: {
  params: Promise<{ templateKey: string }>;
}) {
  const { templateKey: rawKey } = await params;

  // 1. Validate the template key. The Zod enum returns the typed value
  //    on success; on failure we 404 out so the URL boundary stays
  //    strict.
  const parsed = SocialTemplateKeyEnum.safeParse(rawKey);
  if (!parsed.success) {
    notFound();
  }
  const templateKey: SocialTemplateKeyValue = parsed.data;
  const template = getTemplate(templateKey);

  // 2. Auth + perms.
  const { sb, actor } = await resolveAdmin();

  // 3. Pre-resolve subtab visibility for the hub strip.
  const subtabChecks = await Promise.all(
    HUB.subtabs?.map(async (t) => ({
      tab: t,
      ok: await hasPermAsync(sb, actor, t.perm ?? HUB.perm),
    })) ?? [],
  );
  const visibleSubtabs = subtabChecks.filter((c) => c.ok).map((c) => c.tab);

  // 4. Active session lookup + recent-jobs feed for this template.
  const [activeSession, jobs] = await Promise.all([
    findActiveSession(sb),
    listRecentJobs(sb, actor, 50),
  ]);
  const initialSize = template.supportedSizes[0];

  return (
    <div className="space-y-6" data-testid="social-template-page">
      <Breadcrumbs detail={template.label} />
      <HubSubnav hub={HUB} visibleSubtabs={visibleSubtabs} />

      <div className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.18em]">
        <Link
          href="/admin/broadcast/social"
          className="text-[var(--chalk-3)] transition-colors hover:text-[var(--signal)]"
          data-testid="back-to-social-list"
        >
          ← All templates
        </Link>
      </div>

      <SectionHeader
        eyebrow={`Social · ${template.format}`}
        title={template.label}
        description={template.description}
      />

      <section className="space-y-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Active broadcast session
            </div>
            <div className="font-mono text-sm text-[var(--chalk-0)]">
              {activeSession ? (
                <>
                  {activeSession.id}{" "}
                  <span className="text-[var(--chalk-3)]">·</span>{" "}
                  {activeSession.venueName ?? "—"}
                </>
              ) : (
                <span className="text-[var(--chalk-3)]">
                  none — start one from{" "}
                  <Link
                    href="/admin/broadcast/v2"
                    className="underline hover:text-[var(--signal)]"
                  >
                    /admin/broadcast/v2
                  </Link>
                </span>
              )}
            </div>
          </div>
          <Link
            href="/admin/broadcast/v2"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
          >
            Manage sessions →
          </Link>
        </div>
      </section>

      <TemplateConfigClient
        templateKey={templateKey}
        supportedSizes={template.supportedSizes}
        initialSize={initialSize}
        sessionId={activeSession?.id ?? null}
        viewToken={activeSession?.viewToken ?? null}
      />

      <section className="space-y-3" data-testid="render-jobs-section">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
          Renders for {template.label}
        </h2>
        <RenderJobsTable jobs={jobs} currentTemplateKey={templateKey} />
      </section>
    </div>
  );
}
