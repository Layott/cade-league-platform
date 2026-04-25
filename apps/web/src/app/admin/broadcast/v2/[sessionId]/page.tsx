import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  requirePermAsync,
  hasPermAsync,
  PermissionError,
} from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { SecondaryButton } from "@/components/admin/buttons";
import { formatWat } from "@/lib/time";
import { listSelectableMatches } from "@/server/broadcast/match_flow";
import { CopyTokenButton } from "./CopyTokenButton";
import { ControlGrid } from "./ControlGrid";
import type { UpcomingMatch } from "@/components/broadcast/v2/controls/UpNextBugControl";

/**
 * Plan 51 — /admin/broadcast/v2/[sessionId] control room.
 *
 * Resolves the session, joins match-day + season, then renders 16
 * control cards in a responsive grid. Each card embeds a lazy-mounted
 * iframe preview of `/overlay/v2/<key>?session=<id>&token=<view_token>
 * &preview=1` and exposes ENTER + OUT trigger forms wired to the
 * Plan 51 server actions.
 *
 * Perm gates:
 *   - Layout enforces `broadcast.v2.read` (page-level access).
 *   - This page additionally checks `broadcast.v2.trigger` to decide
 *     whether to render the trigger forms; readers see disabled
 *     placeholders so the page still loads for design/QA roles.
 */

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  match_day_id: string;
  session_tag: string | null;
  started_at: string;
  ended_at: string | null;
  view_token: string | null;
};

async function resolveActor() {
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
  return { userId: pub.id, roles };
}

export default async function BroadcastV2SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const actor = await resolveActor();
  const sb = getServiceRoleSupabase();

  try {
    await requirePermAsync(sb, actor, "broadcast.v2.read");
  } catch (err) {
    if (err instanceof PermissionError) {
      redirect("/admin");
    }
    throw err;
  }
  const canTrigger = await hasPermAsync(sb, actor, "broadcast.v2.trigger");

  const { data: sessionRaw } = await sb
    .from("stream_sessions")
    .select(
      "id, match_day_id, session_tag, started_at, ended_at, view_token",
    )
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();

  const session = sessionRaw as SessionRow | null;
  if (!session) {
    return (
      <div className="space-y-8">
        <SectionHeader
          eyebrow="Broadcast v2"
          title="Session not found"
          description="That stream session does not exist or has been removed."
          action={
            <Link href="/admin/broadcast/v2">
              <SecondaryButton>Back</SecondaryButton>
            </Link>
          }
        />
      </div>
    );
  }

  const { data: matchDayRaw } = await sb
    .from("match_days")
    .select("id, match_date, venue_name, season_id")
    .eq("id", session.match_day_id)
    .maybeSingle();
  const matchDay = matchDayRaw as
    | {
        id: string;
        match_date: string;
        venue_name: string;
        season_id: string;
      }
    | null;

  let seasonLabel: string | null = null;
  if (matchDay) {
    const { data: seasonRaw } = await sb
      .from("seasons")
      .select("name, season_label")
      .eq("id", matchDay.season_id)
      .maybeSingle();
    if (seasonRaw) {
      const s = seasonRaw as { name?: string; season_label?: string };
      seasonLabel = s.season_label ?? s.name ?? null;
    }
  }

  // Match dropdown for the up-next-bug control. Pull "today" scope which
  // matches the legacy panel; fall back to all if today's list is empty.
  const selectable = await listSelectableMatches(sb, session.id, {
    scope: "today",
  });
  const upcoming: UpcomingMatch[] = selectable
    .filter(
      (m) =>
        m.status === "scheduled" || m.status === "in_progress",
    )
    .map((m) => ({
      matchId: m.id,
      homeName: m.home.displayName ?? m.home.gamerTag ?? "TBD",
      awayName: m.away.displayName ?? m.away.gamerTag ?? "TBD",
      kickoffAt:
        m.scheduledTime && m.matchDate
          ? new Date(`${m.matchDate}T${m.scheduledTime}+01:00`).toISOString()
          : new Date(Date.now() + 10 * 60_000).toISOString(),
    }));

  const isLive = session.ended_at === null;
  const titleText = matchDay
    ? `${formatWat(`${matchDay.match_date}T00:00:00Z`, "EEE MMM d yyyy")} · ${matchDay.venue_name}`
    : "Session";

  return (
    <div className="space-y-8" data-testid="broadcast-v2-session">
      <SectionHeader
        eyebrow={`v2 control room · ${isLive ? "LIVE" : "Ended"}`}
        title={titleText}
        description={
          <span className="space-y-1">
            <span className="block">
              Started {formatWat(session.started_at, "EEE MMM d · HH:mm")} WAT.
              {seasonLabel ? ` · ${seasonLabel}` : null}
            </span>
            <span className="block">
              Browser source URL stub:{" "}
              <code className="text-[var(--signal)]">
                /overlay/v2/&lt;key&gt;?session={session.id}
                {session.view_token ? `&token=${session.view_token}` : ""}
              </code>
            </span>
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <StatusPill status={isLive ? "live" : "ended"} />
            {session.view_token ? (
              <CopyTokenButton token={session.view_token} />
            ) : null}
            <Link
              href={`/admin/broadcast/${session.id}`}
              data-testid="v2-open-legacy"
            >
              <SecondaryButton>Open legacy control →</SecondaryButton>
            </Link>
            <Link href="/admin/broadcast/v2">
              <SecondaryButton>Back</SecondaryButton>
            </Link>
          </div>
        }
      />

      {!canTrigger ? (
        <div className="rounded-sm border border-[rgba(255,176,32,0.35)] bg-[rgba(255,176,32,0.08)] p-3 text-xs text-[var(--amber)]">
          You have read access only — ENTER / OUT triggers are disabled.
          Switch to a production / admin role to drive overlays.
        </div>
      ) : null}

      <ControlGrid
        sessionId={session.id}
        viewToken={session.view_token}
        upcoming={upcoming}
        canTrigger={canTrigger}
      />
    </div>
  );
}
