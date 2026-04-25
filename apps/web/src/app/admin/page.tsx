import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { formatWat } from "@/lib/time";
import type { Actor } from "@/perms";
import { SquadWindowControls } from "@/components/admin/SquadWindowControls";
import { getSquadWindowOverride } from "@/server/squads/window_override";
import { weekStartThursday } from "@/server/squads/week";
import {
  forceOpenSquadWindowAction,
  forceCloseSquadWindowAction,
  clearSquadWindowOverrideAction,
} from "@/app/admin/squads/window-actions";

export const dynamic = "force-dynamic";

/**
 * Plan 47 — Site Manager dashboard.
 *
 * Landing hub: hero-card context strip + responsive grid of manager
 * tiles. Tile visibility honours `hasPermAsync` so narrow-scope roles
 * (moderator, referee, loc) only see the areas they can act on. Admin
 * sees the full set.
 */

type HeroStats = {
  activeSeason: string;
  activeSessionId: string | null;
  nextMatchDayLabel: string;
  openDisputes: number;
  draftAnnouncements: number;
};

type TileDef = {
  href: string;
  label: string;
  description: string;
  perm: string;
  icon: React.ReactNode;
  badge?: number;
  tone?: "signal" | "amber" | "neutral";
};

// ----- inline SVG icons (write once, no extra deps) ------------------

function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={28}
      height={28}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {d.split("|").map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

const I = {
  brand: "M12 3l3 6 6 1-4 5 1 6-6-3-6 3 1-6-4-5 6-1z",
  players:
    "M16 7a4 4 0 11-8 0 4 4 0 018 0z|M4 21v-1a6 6 0 0112 0v1|M18 8a3 3 0 11-1 5.8|M22 21v-1a4 4 0 00-4-4",
  matches: "M3 6h18v12H3z|M3 12h18|M12 3v18",
  squads: "M6 6l6-3 6 3v6l-6 3-6-3V6z|M6 14l6 3 6-3",
  ann: "M4 11v2a1 1 0 001 1h2l4 4V6L7 10H5a1 1 0 00-1 1z|M16 8a5 5 0 010 8",
  disputes:
    "M12 9v4|M12 16h.01|M5 21h14a2 2 0 002-2l-10-16L2 19a2 2 0 003 2z",
  appeals:
    "M9 11H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-4|M9 11V7a3 3 0 016 0v4",
  gavel: "M14 4l6 6|M10 8l6 6|M3 21l7-7|M12 14l7 7",
  orgs: "M3 21h18|M5 21V7l7-4 7 4v14|M9 9h.01|M13 9h.01|M9 13h.01|M13 13h.01|M9 17h.01|M13 17h.01",
  users: "M16 7a4 4 0 11-8 0 4 4 0 018 0z|M4 21v-1a6 6 0 0112 0v1",
  broadcast:
    "M3 12a9 9 0 0118 0|M6 12a6 6 0 0112 0|M9 12a3 3 0 016 0|M12 14v6",
  youtube:
    "M21 8s-.2-1.4-.8-2a3 3 0 00-2.1-.9C15.2 5 12 5 12 5s-3.2 0-6.1.1a3 3 0 00-2.1.9C3.2 6.6 3 8 3 8s-.2 1.7-.2 3.3v1.4c0 1.6.2 3.3.2 3.3s.2 1.4.8 2a3 3 0 002.1.9c2 .1 8.2.1 8.2.1s3.2 0 6.1-.1a3 3 0 002.1-.9c.6-.6.8-2 .8-2s.2-1.7.2-3.3v-1.4c0-1.6-.2-3.3-.2-3.3z|M10 15l5-3-5-3v6z",
  presets: "M4 4h6v6H4z|M14 4h6v6h-6z|M4 14h6v6H4z|M14 14h6v6h-6z",
  stingers: "M13 2L3 14h7l-1 8 10-12h-7l1-8z",
  sessions: "M3 12h18|M12 3v18|M7 7l10 10|M17 7L7 17",
  trash:
    "M3 6h18|M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2|M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14",
  stats: "M4 4v16h16|M7 16l4-4 4 3 5-7",
  refs: "M7 21l5-4 5 4V5l-5-2-5 2v16z",
  // Plan 51 — trophy (tournament) + monitor-with-overlay (broadcast v2).
  trophy:
    "M8 21h8|M12 17v4|M7 4h10v5a5 5 0 01-10 0V4z|M17 6h2a2 2 0 012 2v1a4 4 0 01-4 4|M7 6H5a2 2 0 00-2 2v1a4 4 0 004 4",
  broadcastV2:
    "M3 5h18v12H3z|M3 17l4 3h10l4-3|M7 9h6|M7 12h4|M14 8l4 4-4 4",
};

async function loadHero(
  sb: Awaited<ReturnType<typeof getServiceRoleSupabase>>,
): Promise<HeroStats> {
  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date(Date.now() + 14 * 86400_000)
    .toISOString()
    .slice(0, 10);

  const [seasonRes, sessionRes, nextMdRes, openDisputesRes, draftAnnRes] =
    await Promise.all([
      sb
        .from("seasons")
        .select("year_range, division_name")
        .is("deleted_at", null)
        .eq("status", "active")
        .maybeSingle(),
      sb
        .from("stream_sessions")
        .select("id, started_at, session_tag")
        .is("deleted_at", null)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1),
      sb
        .from("match_days")
        .select("match_date, venue_name")
        .is("deleted_at", null)
        .gte("match_date", today)
        .lte("match_date", weekOut)
        .order("match_date", { ascending: true })
        .limit(1),
      // Linkage audit (2026-04-24) — the disputes table only knows
      // 'submitted' | 'under_review' | 'resolved' | 'withdrawn'. The
      // dashboard previously filtered on the phantom value 'open' so
      // the counter was permanently zero. Active = unresolved +
      // un-withdrawn, i.e. the two states that need admin action.
      sb
        .from("disputes")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .in("status", ["submitted", "under_review"]),
      sb
        .from("announcements")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .is("published_at", null),
    ]);

  const season = seasonRes.data as
    | { year_range: string; division_name: string | null }
    | null;
  const activeSession = (sessionRes.data?.[0] ?? null) as {
    id: string;
  } | null;
  const nextMd = (nextMdRes.data?.[0] ?? null) as {
    match_date: string;
    venue_name: string;
  } | null;

  return {
    activeSeason: season
      ? `${season.year_range} · ${season.division_name ?? "Elite"}`
      : "No active season",
    activeSessionId: activeSession?.id ?? null,
    nextMatchDayLabel: nextMd
      ? `${formatWat(`${nextMd.match_date}T00:00:00Z`, "EEE MMM d")} · ${nextMd.venue_name}`
      : "None scheduled",
    openDisputes: openDisputesRes.count ?? 0,
    draftAnnouncements: draftAnnRes.count ?? 0,
  };
}

async function resolveViewer(): Promise<{
  actor: Actor;
  sb: Awaited<ReturnType<typeof getServiceRoleSupabase>>;
}> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  const svc = getServiceRoleSupabase();
  if (!auth.user) return { actor: { userId: null, roles: [] }, sb: svc };

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) return { actor: { userId: null, roles: [] }, sb: svc };

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  return { actor: { userId: pub.id, roles }, sb: svc };
}

export default async function AdminHome() {
  const { actor, sb } = await resolveViewer();
  const hero = await loadHero(sb);
  const canManageWindow = await hasPermAsync(sb, actor, "squads.window.manage");
  const weekStart = weekStartThursday(new Date());
  const squadWindowOverride = canManageWindow
    ? await getSquadWindowOverride(sb, weekStart)
    : null;

  const allTiles: TileDef[] = [
    {
      href: "/admin/branding",
      label: "Branding",
      description: "Logos, palette, partner marks.",
      perm: "branding.manage",
      icon: <Icon d={I.brand} />,
    },
    {
      href: "/admin/players",
      label: "Players",
      description: "Roster, gamer tags, photos, orgs.",
      perm: "users.edit",
      icon: <Icon d={I.players} />,
    },
    {
      href: "/admin/match-days",
      label: "Match days",
      description: "Schedule, publish, attendance.",
      perm: "matches.read",
      icon: <Icon d={I.matches} />,
    },
    {
      href: "/admin/squads",
      label: "Squads",
      description: "Submissions, validation, reopen.",
      perm: "squads.validate",
      icon: <Icon d={I.squads} />,
    },
    {
      href: "/admin/announcements",
      label: "Announcements",
      description: "Drafts, briefings, publishing.",
      perm: "announcements.read",
      icon: <Icon d={I.ann} />,
      badge: hero.draftAnnouncements,
      tone: hero.draftAnnouncements > 0 ? "amber" : undefined,
    },
    {
      href: "/admin/disputes",
      label: "Disputes",
      description: "Review, rule, close.",
      perm: "disputes.read",
      icon: <Icon d={I.disputes} />,
      badge: hero.openDisputes,
      tone: hero.openDisputes > 0 ? "amber" : undefined,
    },
    {
      href: "/admin/appeals",
      label: "Appeals",
      description: "Reconsider sanctions.",
      perm: "appeals.read",
      icon: <Icon d={I.appeals} />,
    },
    {
      href: "/admin/punishments",
      label: "Punishments",
      description: "Sanctions + discipline ledger.",
      perm: "punishments.read",
      icon: <Icon d={I.gavel} />,
    },
    {
      href: "/admin/orgs",
      label: "Orgs",
      description: "Organizations + caution ledger.",
      perm: "orgs.read",
      icon: <Icon d={I.orgs} />,
    },
    {
      href: "/admin/users",
      label: "Users & Roles",
      description: "Accounts, role assignments.",
      perm: "users.edit",
      icon: <Icon d={I.users} />,
    },
    {
      href: "/admin/broadcast",
      label: "Broadcast",
      description: "Stream sessions, overlays.",
      perm: "broadcast.manage",
      icon: <Icon d={I.broadcast} />,
      tone: hero.activeSessionId ? "signal" : undefined,
    },
    {
      href: "/admin/tournament",
      label: "Tournament",
      description: "Standings, fixtures, results, walkovers.",
      perm: "tournament.read",
      icon: <Icon d={I.trophy} />,
    },
    {
      href: "/admin/broadcast/v2",
      label: "Broadcast v2",
      description: "Next-gen overlay control room.",
      perm: "broadcast.v2.read",
      icon: <Icon d={I.broadcastV2} />,
    },
    {
      href: "/admin/youtube-channels",
      label: "YouTube channels",
      description: "Live chat source registry.",
      perm: "branding.manage",
      icon: <Icon d={I.youtube} />,
    },
    {
      href: "/admin/broadcast/stingers",
      label: "Stingers",
      description: "One-click transition clips.",
      perm: "broadcast.trigger",
      icon: <Icon d={I.stingers} />,
    },
    {
      href: "/admin/roles",
      label: "Roles",
      description: "Permission matrix editor.",
      perm: "roles.manage",
      icon: <Icon d={I.presets} />,
    },
    {
      href: "/admin/security/sessions",
      label: "Sessions",
      description: "Who's signed in right now.",
      perm: "security.sessions.read",
      icon: <Icon d={I.sessions} />,
    },
    {
      href: "/admin/stats-review",
      label: "Stats review",
      description: "OCR screenshots queue.",
      perm: "stats.screenshot.review",
      icon: <Icon d={I.stats} />,
    },
    {
      href: "/admin/trash",
      label: "Trash",
      description: "Soft-deleted rows, restore.",
      perm: "trash.restore",
      icon: <Icon d={I.trash} />,
    },
    {
      href: "/referee/attendance",
      label: "Referee attendance",
      description: "Mark present/late/absent.",
      perm: "attendance.mark",
      icon: <Icon d={I.refs} />,
    },
  ];

  // Pre-resolve tile visibility in parallel.
  const visibleChecks = await Promise.all(
    allTiles.map(async (t) => ({
      tile: t,
      visible: await hasPermAsync(sb, actor, t.perm),
    })),
  );
  const visibleTiles = visibleChecks.filter((c) => c.visible).map((c) => c.tile);

  return (
    <div className="space-y-10" data-testid="admin-home">
      <SectionHeader
        eyebrow="Site Manager"
        title="League control room"
        description="Every knob, switch, and pane for running the Elite 2025-26 season. Tiles filtered to surfaces your roles can touch."
      />

      <HeroStrip hero={hero} />

      {canManageWindow ? (
        <SquadWindowControls
          weekStart={weekStart}
          override={squadWindowOverride}
          forceOpen={forceOpenSquadWindowAction}
          forceClose={forceCloseSquadWindowAction}
          clearOverride={clearSquadWindowOverrideAction}
        />
      ) : null}

      <section
        aria-label="Manager tiles"
        className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {visibleTiles.map((t) => (
          <TileCard key={t.href} tile={t} />
        ))}
      </section>
    </div>
  );
}

function HeroStrip({ hero }: { hero: HeroStats }) {
  return (
    <section
      aria-label="Session summary"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="admin-hero"
    >
      <HeroCard
        label="Active season"
        value={hero.activeSeason}
        tone="signal"
      />
      <HeroCard
        label="Broadcast"
        value={hero.activeSessionId ? "Live session" : "Offline"}
        hint={
          hero.activeSessionId ? (
            <Link
              href={`/admin/broadcast/${hero.activeSessionId}`}
              className="text-[var(--signal)] hover:underline"
            >
              Open control panel →
            </Link>
          ) : (
            "No session running."
          )
        }
        tone={hero.activeSessionId ? "signal" : "neutral"}
      />
      <HeroCard
        label="Next match day"
        value={hero.nextMatchDayLabel}
        tone={hero.nextMatchDayLabel === "None scheduled" ? "neutral" : "signal"}
      />
      <HeroCard
        label="Open cases"
        value={`${hero.openDisputes} dispute${hero.openDisputes === 1 ? "" : "s"} · ${hero.draftAnnouncements} draft${hero.draftAnnouncements === 1 ? "" : "s"}`}
        tone={
          hero.openDisputes > 0
            ? "secondary"
            : hero.draftAnnouncements > 0
              ? "amber"
              : "neutral"
        }
      />
    </section>
  );
}

function HeroCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  tone: "signal" | "amber" | "neutral" | "secondary";
}) {
  const accent =
    tone === "signal"
      ? "border-[rgba(107,205,6,0.35)]"
      : tone === "amber"
        ? "border-[rgba(255,176,32,0.35)]"
        : tone === "secondary"
          ? "border-[rgba(254,3,109,0.45)]"
          : "border-[var(--ink-4)]";
  return (
    <div
      className={`group relative overflow-hidden rounded-sm border bg-[var(--ink-2)] p-4 ${accent}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
        {label}
      </div>
      <div className="mt-2 font-display text-lg font-bold leading-tight text-[var(--chalk-0)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-[var(--chalk-2)]">{hint}</div>
      ) : null}
      <span
        aria-hidden
        className={`absolute inset-x-0 bottom-0 h-[2px] ${
          tone === "signal"
            ? "bg-[var(--signal)]"
            : tone === "amber"
              ? "bg-[var(--amber)]"
              : tone === "secondary"
                ? "bg-[var(--secondary)]"
                : "bg-[var(--ink-4)]"
        }`}
      />
    </div>
  );
}

function TileCard({ tile }: { tile: TileDef }) {
  const toneClass =
    tile.tone === "signal"
      ? "border-[rgba(107,205,6,0.35)] hover:border-[var(--signal)]"
      : tile.tone === "amber"
        ? "border-[rgba(255,176,32,0.35)] hover:border-[var(--amber)]"
        : "border-[var(--ink-4)] hover:border-[var(--signal)]";
  return (
    <Link
      href={tile.href}
      className={`group relative flex min-h-[112px] flex-col justify-between overflow-hidden rounded-sm border bg-[var(--ink-2)] p-4 transition-colors ${toneClass}`}
      data-testid={`admin-tile-${tile.href}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] text-[var(--chalk-1)] transition-colors group-hover:border-[var(--signal)] group-hover:text-[var(--signal)]`}
        >
          {tile.icon}
        </div>
        {tile.badge && tile.badge > 0 ? (
          <StatusPill tone={tile.tone === "signal" ? "signal" : "amber"}>
            {tile.badge}
          </StatusPill>
        ) : (
          <span
            aria-hidden
            className="text-[var(--chalk-3)] transition-colors group-hover:text-[var(--signal)]"
          >
            →
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="font-display text-base font-semibold text-[var(--chalk-0)] transition-colors group-hover:text-[var(--signal)]">
          {tile.label}
        </div>
        <div className="mt-1 text-xs text-[var(--chalk-2)]">
          {tile.description}
        </div>
      </div>
    </Link>
  );
}
