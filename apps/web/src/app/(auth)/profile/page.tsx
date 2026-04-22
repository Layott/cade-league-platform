import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
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

  // Plan 41 — mount player panels when caller has player role.
  const hasPlayerRole = roles.includes("player");
  const params = (await searchParams) ?? {};
  const mhPage = Math.max(1, parseInt(params.mh ?? "1", 10) || 1);
  const PAGE_SIZE = 10;

  let playerBlock: React.ReactNode = null;
  if (hasPlayerRole) {
    const [season, playerRow] = await Promise.all([
      getActiveSeason(sb),
      sb
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
          getSeasonStats(sb, playerRow.id, season.id),
          getFormLastN(sb, playerRow.id, season.id, 5),
          getCurrentStreaks(sb, playerRow.id, season.id),
          getMatchHistory(sb, playerRow.id, season.id, {
            page: mhPage,
            pageSize: PAGE_SIZE,
          }),
          getH2HGrid(sb, playerRow.id, season.id),
          sb
            .from("disciplinary_actions")
            .select(
              "id, disciplinary_case_id, sanction_type, magnitude, incident_type, issued_at, effective_from, effective_until, notes",
            )
            .eq("player_id", playerRow.id)
            .is("deleted_at", null)
            .order("issued_at", { ascending: false })
            .then((r) => r.data ?? []),
          getCurrentSquadStatus(sb, playerRow.id, now),
        ]);

      const { data: appealedRows } = await sb
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
      {playerBlock}
    </div>
  );
}
