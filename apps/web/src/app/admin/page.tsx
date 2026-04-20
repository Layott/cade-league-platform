import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  action: "insert" | "update" | "delete";
  entity_type: string;
  entity_id: string | null;
  created_at: string;
};

async function loadDashboard() {
  const sb = await getServerSupabase();
  const svc = getServiceRoleSupabase();

  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  const [seasonRes, weekMatchDaysRes, openCasesRes, draftAnnouncementsRes, auditRes] =
    await Promise.all([
      sb
        .from("seasons")
        .select("id, year_range, division_name, status")
        .is("deleted_at", null)
        .eq("status", "active")
        .maybeSingle(),
      sb
        .from("match_days")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .gte("match_date", today)
        .lte("match_date", weekOut),
      sb
        .from("disciplinary_actions")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .is("revoked_at", null),
      sb
        .from("announcements")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .is("published_at", null),
      svc
        .from("audit_events")
        .select("id, actor_user_id, action, entity_type, entity_id, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  // Resolve actor display names for the audit feed (one batched query).
  const audit = (auditRes.data ?? []) as AuditRow[];
  const actorIds = Array.from(
    new Set(audit.map((r) => r.actor_user_id).filter((v): v is string => !!v)),
  );
  let actorMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: users } = await svc
      .from("users")
      .select("id, display_name")
      .in("id", actorIds);
    actorMap = new Map(
      ((users ?? []) as { id: string; display_name: string | null }[]).map(
        (u) => [u.id, u.display_name ?? "system"],
      ),
    );
  }

  return {
    season: seasonRes.data as
      | {
          id: string;
          year_range: string;
          division_name: string | null;
          status: string;
        }
      | null,
    weekCount: weekMatchDaysRes.count ?? 0,
    openCases: openCasesRes.count ?? 0,
    draftAnnouncements: draftAnnouncementsRes.count ?? 0,
    audit,
    actorMap,
  };
}

export default async function AdminHome() {
  const {
    season,
    weekCount,
    openCases,
    draftAnnouncements,
    audit,
    actorMap,
  } = await loadDashboard();

  const stats: {
    label: string;
    value: string;
    hint: string;
    tone: "signal" | "amber" | "neutral";
  }[] = [
    {
      label: "Active season",
      value: season?.year_range ?? "—",
      hint: season?.division_name ?? "No active season",
      tone: season ? "signal" : "neutral",
    },
    {
      label: "Match days · 7 days",
      value: String(weekCount),
      hint: weekCount === 0 ? "Schedule pending" : "Locked in",
      tone: weekCount > 0 ? "signal" : "neutral",
    },
    {
      label: "Open cases",
      value: String(openCases),
      hint: openCases === 0 ? "Clean slate" : "Active sanctions",
      tone: openCases > 0 ? "amber" : "neutral",
    },
    {
      label: "Pending announcements",
      value: String(draftAnnouncements),
      hint: draftAnnouncements === 0 ? "Inbox zero" : "Awaiting publish",
      tone: draftAnnouncements > 0 ? "amber" : "neutral",
    },
  ];

  return (
    <div className="space-y-10" data-testid="admin-home">
      <SectionHeader
        eyebrow="Control room"
        title="Matchday ops & league desk"
        description="Schedule the next session, ratify results, publish briefings, and keep the discipline register honest."
      />

      <section
        aria-label="Quick stats"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {stats.map((s) => (
          <div
            key={s.label}
            className={
              "group relative overflow-hidden rounded-sm border bg-[var(--ink-2)] p-4 transition-colors " +
              (s.tone === "signal"
                ? "border-[var(--ink-4)] hover:border-[rgba(0,255,136,0.35)]"
                : s.tone === "amber"
                  ? "border-[var(--ink-4)] hover:border-[rgba(255,176,32,0.35)]"
                  : "border-[var(--ink-4)]")
            }
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
              {s.label}
            </div>
            <div
              className={
                "mt-2 font-display text-3xl font-bold tracking-tight tabular " +
                (s.tone === "signal"
                  ? "text-[var(--signal)]"
                  : s.tone === "amber"
                    ? "text-[var(--amber)]"
                    : "text-[var(--chalk-1)]")
              }
            >
              {s.value}
            </div>
            <div className="mt-1 text-xs text-[var(--chalk-2)]">{s.hint}</div>
            <span
              aria-hidden
              className={
                "absolute inset-x-0 bottom-0 h-[2px] " +
                (s.tone === "signal"
                  ? "bg-[var(--signal)]"
                  : s.tone === "amber"
                    ? "bg-[var(--amber)]"
                    : "bg-[var(--ink-4)]")
              }
            />
          </div>
        ))}
      </section>

      <section
        aria-labelledby="quick-actions-heading"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <h2 id="quick-actions-heading" className="sr-only">
          Quick actions
        </h2>
        <QuickLink
          href="/admin/match-days/new"
          label="New match day"
          hint="Lock in the next session"
        />
        <QuickLink
          href="/admin/punishments/new"
          label="Issue sanction"
          hint="Log an incident + punishment"
        />
        <QuickLink
          href="/admin/announcements/new"
          label="Broadcast news"
          hint="Compose a league briefing"
        />
        <QuickLink
          href="/admin/security/sessions"
          label="Session audit"
          hint="Who's signed in right now"
        />
      </section>

      <section aria-labelledby="activity-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2
            id="activity-heading"
            className="font-display text-lg font-bold text-[var(--chalk-0)]"
          >
            Recent activity
          </h2>
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Last 10 events
          </span>
        </div>
        {audit.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-8 text-center text-sm text-[var(--chalk-3)]">
            No audit events yet — the log lights up the moment you create
            anything.
          </div>
        ) : (
          <ol className="divide-y divide-[var(--ink-4)] overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]">
            {audit.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="shrink-0 text-[11px] text-[var(--chalk-3)] tabular">
                  {formatWat(row.created_at, "MMM d · HH:mm")}
                </span>
                <span
                  className={
                    "inline-flex items-center justify-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] " +
                    (row.action === "insert"
                      ? "border-[rgba(0,255,136,0.4)] bg-[rgba(0,255,136,0.08)] text-[var(--signal)]"
                      : row.action === "update"
                        ? "border-[rgba(255,176,32,0.4)] bg-[rgba(255,176,32,0.08)] text-[var(--amber)]"
                        : "border-[rgba(255,91,59,0.4)] bg-[rgba(255,91,59,0.08)] text-[var(--flare)]")
                  }
                >
                  {row.action}
                </span>
                <span className="text-[var(--chalk-1)]">
                  <span className="font-mono text-[12px] text-[var(--chalk-2)]">
                    {row.entity_type}
                  </span>
                  {row.entity_id ? (
                    <span className="ml-1 font-mono text-[11px] text-[var(--chalk-3)]">
                      #{row.entity_id.slice(0, 8)}
                    </span>
                  ) : null}
                </span>
                <span className="sm:ml-auto text-xs text-[var(--chalk-3)]">
                  by{" "}
                  <span className="text-[var(--chalk-2)]">
                    {row.actor_user_id
                      ? (actorMap.get(row.actor_user_id) ?? "system")
                      : "system"}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function QuickLink({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-1 overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 transition-colors hover:border-[var(--signal)]"
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-base font-semibold text-[var(--chalk-0)] transition-colors group-hover:text-[var(--signal)]">
          {label}
        </span>
        <span
          aria-hidden
          className="text-[var(--chalk-3)] transition-colors group-hover:text-[var(--signal)]"
        >
          →
        </span>
      </div>
      <div className="text-xs text-[var(--chalk-3)]">{hint}</div>
    </Link>
  );
}
