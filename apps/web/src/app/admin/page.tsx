import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { formatWat } from "@/lib/time";
import type { Actor } from "@/perms";
import { ADMIN_HUBS, type AdminHub } from "@/lib/admin-nav";

export const dynamic = "force-dynamic";

/**
 * Plan 47 — Site Manager dashboard.
 *
 * Landing hub: hero-card context strip + responsive grid of hub tiles.
 *
 * UI Audit Slice 4 (2026-04-28) — tile grid collapsed from 19 disparate
 * tiles to the 8 hubs in `lib/admin-nav.ts`. Tiles render via
 * `.map(ADMIN_HUBS)`; each hub's perm gates visibility through
 * `hasPermAsync`. Description + label come from the hub config —
 * adding/renaming/dropping a hub is now a one-file change.
 *
 * Squad window override moved off this dashboard to /admin/squads (the
 * page about squads). Home is read-only situational awareness only.
 */

type HeroStats = {
  activeSeason: string;
  activeSessionId: string | null;
  nextMatchDayLabel: string;
  openDisputes: number;
  draftAnnouncements: number;
};

type HubBadge = {
  /** badge value (number) */
  count: number;
  /** badge tone */
  tone?: "signal" | "amber" | "secondary";
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
  matches: "M3 6h18v12H3z|M3 12h18|M12 3v18",
  squads: "M6 6l6-3 6 3v6l-6 3-6-3V6z|M6 14l6 3 6-3",
  ann: "M4 11v2a1 1 0 001 1h2l4 4V6L7 10H5a1 1 0 00-1 1z|M16 8a5 5 0 010 8",
  gavel: "M14 4l6 6|M10 8l6 6|M3 21l7-7|M12 14l7 7",
  users: "M16 7a4 4 0 11-8 0 4 4 0 018 0z|M4 21v-1a6 6 0 0112 0v1",
  trophy:
    "M8 21h8|M12 17v4|M7 4h10v5a5 5 0 01-10 0V4z|M17 6h2a2 2 0 012 2v1a4 4 0 01-4 4|M7 6H5a2 2 0 00-2 2v1a4 4 0 004 4",
  broadcast:
    "M3 5h18v12H3z|M3 17l4 3h10l4-3|M7 9h6|M7 12h4|M14 8l4 4-4 4",
  trash:
    "M3 6h18|M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2|M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14",
};

// Map hub key → icon path. Centralises so renaming/swapping a hub key
// also updates the icon mapping in one place.
const HUB_ICONS: Record<string, string> = {
  "match-days": I.matches,
  tournament: I.trophy,
  roster: I.users,
  discipline: I.gavel,
  comms: I.ann,
  broadcast: I.broadcast,
  squads: I.squads,
  system: I.trash,
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

function hubBadge(hub: AdminHub, hero: HeroStats): HubBadge | null {
  if (hub.key === "discipline" && hero.openDisputes > 0) {
    return { count: hero.openDisputes, tone: "amber" };
  }
  if (hub.key === "comms" && hero.draftAnnouncements > 0) {
    return { count: hero.draftAnnouncements, tone: "amber" };
  }
  return null;
}

export default async function AdminHome() {
  const { actor, sb } = await resolveViewer();
  const hero = await loadHero(sb);

  // Pre-resolve hub-tile visibility in parallel.
  const visibleChecks = await Promise.all(
    ADMIN_HUBS.map(async (h) => ({
      hub: h,
      visible: await hasPermAsync(sb, actor, h.perm),
    })),
  );
  const visibleHubs = visibleChecks.filter((c) => c.visible).map((c) => c.hub);

  return (
    <div className="space-y-10" data-testid="admin-home">
      <SectionHeader
        eyebrow="Site Manager"
        title="League control room"
        description="Every knob, switch, and pane for running the Elite 2025-26 season. Hubs filtered to surfaces your roles can touch."
      />

      <HeroStrip hero={hero} />

      <section
        aria-label="Hubs"
        className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {visibleHubs.map((hub) => (
          <HubTile key={hub.key} hub={hub} badge={hubBadge(hub, hero)} hero={hero} />
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
              href={`/admin/broadcast/v2/${hero.activeSessionId}`}
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

function HubTile({
  hub,
  badge,
  hero,
}: {
  hub: AdminHub;
  badge: HubBadge | null;
  hero: HeroStats;
}) {
  // Light up the broadcast tile in signal-green when a session is live.
  const isLiveBroadcast = hub.key === "broadcast" && hero.activeSessionId;
  const tone: "signal" | "amber" | "neutral" =
    isLiveBroadcast ? "signal" : badge?.tone === "amber" ? "amber" : "neutral";

  const toneClass =
    tone === "signal"
      ? "border-[rgba(107,205,6,0.35)] hover:border-[var(--signal)]"
      : tone === "amber"
        ? "border-[rgba(255,176,32,0.35)] hover:border-[var(--amber)]"
        : "border-[var(--ink-4)] hover:border-[var(--signal)]";
  return (
    <Link
      href={hub.href}
      className={`group relative flex min-h-[112px] flex-col justify-between overflow-hidden rounded-sm border bg-[var(--ink-2)] p-4 transition-colors ${toneClass}`}
      data-testid={`admin-tile-${hub.key}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] text-[var(--chalk-1)] transition-colors group-hover:border-[var(--signal)] group-hover:text-[var(--signal)]`}
        >
          <Icon d={HUB_ICONS[hub.key] ?? I.matches} />
        </div>
        {badge && badge.count > 0 ? (
          <StatusPill tone={badge.tone === "signal" ? "signal" : "amber"}>
            {badge.count}
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
          {hub.label}
        </div>
        <div className="mt-1 text-xs text-[var(--chalk-2)]">
          {hub.description}
        </div>
      </div>
    </Link>
  );
}
