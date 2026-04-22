import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { getProfileView } from "@/server/profile/read";
import {
  getSeasonStats,
  getFormLastN,
  getCurrentStreaks,
  getMatchHistory,
} from "@/server/profile/playerStats";
import { getH2HGrid } from "@/server/profile/h2h";
import { getCurrentSquadStatus } from "@/server/profile/squadStatus";
import { isAppealWindowOpen } from "@/server/appeals/window";
import { getActiveSeason } from "@/server/seasons";
import { ProfilePanel } from "@/components/profile/ProfilePanel";
import { SeasonStatsCard } from "@/components/profile/SeasonStatsCard";
import { FormStrip } from "@/components/profile/FormStrip";
import { CurrentStreaks } from "@/components/profile/CurrentStreaks";
import { MatchHistory } from "@/components/profile/MatchHistory";
import { H2HGrid } from "@/components/profile/H2HGrid";
import { SanctionsList } from "@/components/profile/SanctionsList";
import { SquadStatusWidget } from "@/components/profile/SquadStatusWidget";
import { SectionHeader } from "@/components/admin/SectionHeader";
import Link from "next/link";

const STAFF_ROLES = new Set(["admin", "loc", "idc", "referee", "production", "moderator"]);
function consoleLinkForRoles(roles: readonly string[]): { href: string; label: string } {
  if (roles.some((r) => STAFF_ROLES.has(r))) return { href: "/admin", label: "Back to console" };
  if (roles.includes("player")) return { href: "/player", label: "Back to player dashboard" };
  return { href: "/", label: "Back to home" };
}

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
type SearchParams = { mh?: string };

export default async function ProfileSelfPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login?next=/profile");

  // Plan 39 C2 revoked anon+authenticated SELECT on users.email + other PII
  // columns, so every server read touching those columns must use the
  // service-role client. /profile routes are already self-gated by the
  // auth.getUser() check above and getProfileView's actor check.
  const svc = getServiceRoleSupabase();

  const { data: pub } = await svc
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pub) redirect("/login?next=/profile");

  const { data: roleRows } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const profile = await getProfileView(svc, {
    userId: pub.id as string,
    roles,
  });

  // Plan 41 — mount player panels when caller has player role.
  const hasPlayerRole = roles.includes("player");
  const params = (await searchParams) ?? {};
  const mhPage = Math.max(1, parseInt(params.mh ?? "1", 10) || 1);
  const PAGE_SIZE = 10;

  let playerBlock: React.ReactNode = null;
  if (hasPlayerRole) {
    const [season, playerRow] = await Promise.all([
      getActiveSeason(svc),
      svc
        .from("players")
        .select("id")
        .eq("user_id", pub.id)
        .is("deleted_at", null)
        .maybeSingle()
        .then((r) => r.data as { id: string } | null),
    ]);

    if (season && playerRow) {
      const now = new Date();
      const [stats, form, streaks, history, h2h, sanctions, squadStatus] =
        await Promise.all([
          getSeasonStats(svc, playerRow.id, season.id),
          getFormLastN(svc, playerRow.id, season.id, 5),
          getCurrentStreaks(svc, playerRow.id, season.id),
          getMatchHistory(svc, playerRow.id, season.id, {
            page: mhPage,
            pageSize: PAGE_SIZE,
          }),
          getH2HGrid(svc, playerRow.id, season.id),
          svc
            .from("disciplinary_actions")
            .select(
              "id, disciplinary_case_id, sanction_type, magnitude, incident_type, issued_at, effective_from, effective_until, notes",
            )
            .eq("player_id", playerRow.id)
            .is("deleted_at", null)
            .order("issued_at", { ascending: false })
            .then((r) => r.data ?? []),
          getCurrentSquadStatus(svc, playerRow.id, now),
        ]);

      const { data: appealedRows } = await svc
        .from("appeals")
        .select("disciplinary_action_id, status")
        .in(
          "disciplinary_action_id",
          sanctions.map((s) => s.id),
        )
        .neq("status", "withdrawn")
        .is("deleted_at", null);
      const appealedSet = new Set(
        (appealedRows ?? []).map((r: { disciplinary_action_id: string }) =>
          r.disciplinary_action_id,
        ),
      );

      const sanctionRows = sanctions.map((s) => ({
        id: s.id as string,
        disciplinaryCaseId: s.disciplinary_case_id as string,
        sanctionType: s.sanction_type as never,
        magnitude: s.magnitude as number,
        incidentType: s.incident_type as string,
        issuedAt: s.issued_at as string,
        effectiveFrom: (s.effective_from as string | null) ?? null,
        effectiveUntil: (s.effective_until as string | null) ?? null,
        notes: (s.notes as string | null) ?? null,
        isAppealWindowOpen: isAppealWindowOpen(
          new Date(s.issued_at as string),
          now,
          s.sanction_type as never,
        ),
        alreadyAppealed: appealedSet.has(s.id as string),
      }));

      // Adapt P41-D server shapes → P41-E component prop shapes.
      const formForComponent = form.map((f) => ({
        result: f.result,
        opponent: f.opponentDisplayName,
        matchDate: f.matchDate,
        homeScore: f.homeScore,
        awayScore: f.awayScore,
      }));

      const matchHistoryForComponent = history.rows.map((r) => ({
        matchId: r.matchId,
        matchDate: r.matchDate,
        opponent: r.opponentDisplayName,
        opponentGamerTag: "",
        playerWasHome: r.wasHome,
        homeScore: r.homeScore,
        awayScore: r.awayScore,
        result: r.result,
        resultType: r.resultType,
      }));

      const h2hForComponent = h2h.map((r) => ({
        ...r,
        opponentGamerTag: "",
      }));

      const squadStatusForComponent =
        squadStatus.kind === "pre_deadline"
          ? {
              kind: "pre_deadline" as const,
              hoursUntil: squadStatus.hoursUntil,
              deadline: squadStatus.deadline.toISOString(),
            }
          : squadStatus.kind === "reopened_by_admin"
            ? {
                kind: "reopened_by_admin" as const,
                reopenedAt: squadStatus.reopenedAt.toISOString(),
                reopenedBy: squadStatus.reopenedBy,
              }
            : squadStatus;

      playerBlock = (
        <>
          <SeasonStatsCard stats={stats} />
          <FormStrip form={formForComponent} />
          <CurrentStreaks streaks={streaks} />
          <SquadStatusWidget status={squadStatusForComponent} />
          <SanctionsList rows={sanctionRows} selfView now={now} />
          <MatchHistory
            rows={matchHistoryForComponent}
            page={history.page}
            pageCount={history.pageCount}
            baseHref="/profile"
          />
          <H2HGrid rows={h2hForComponent} />
        </>
      );
    }
  }

  const back = consoleLinkForRoles(roles);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-6 md:py-10">
      <div className="flex items-center justify-between">
        <Link
          href={back.href}
          className="inline-flex items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
          data-testid="profile-back-link"
        >
          <span aria-hidden>←</span>
          {back.label}
        </Link>
      </div>
      <SectionHeader
        eyebrow="Profile"
        title={profile.displayName || "Your profile"}
        description="Edit your display name and bio. Photo + role assignments + email live on the admin surface."
      />
      <ProfilePanel
        profile={profile}
        editable
        actorUserId={pub.id as string}
      />
      {playerBlock}
    </div>
  );
}
