import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { StatusPill } from "@/components/admin/StatusPill";
import { formatWat } from "@/lib/time";

/**
 * Plan 51 — /admin/broadcast/v2 landing page.
 *
 * Lists every recent stream session and lets the operator open one in
 * the v2 control room (filled in later by sibling agent UI-BC at
 * /admin/broadcast/v2/[sessionId]/page.tsx). Also offers a "create new
 * session" link that defers to the existing v1 broadcast form so we
 * don't duplicate the start-session UX while v2 is still scaffolding.
 *
 * Per-page perm checks: layout already enforces `broadcast.v2.read`.
 * The trigger button visibility flips against `broadcast.v2.trigger`.
 */

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  match_day_id: string;
  session_tag: string | null;
  started_at: string;
  ended_at: string | null;
};

type MatchDayLite = { id: string; match_date: string; venue_name: string };

async function resolveActor() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/broadcast/v2");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/broadcast/v2");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  return { userId: pub.id, roles };
}

export default async function BroadcastV2LandingPage() {
  const actor = await resolveActor();
  const sb = getServiceRoleSupabase();
  const canTrigger = await hasPermAsync(sb, actor, "broadcast.v2.trigger");

  // Pull last 30 days of sessions, joined with their match day for context.
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: sessionRows } = await sb
    .from("stream_sessions")
    .select("id, match_day_id, session_tag, started_at, ended_at")
    .is("deleted_at", null)
    .gte("started_at", since.toISOString())
    .order("started_at", { ascending: false })
    .limit(40);
  const sessions = (sessionRows ?? []) as SessionRow[];

  const matchDayIds = Array.from(new Set(sessions.map((s) => s.match_day_id)));
  let dayMap = new Map<string, MatchDayLite>();
  if (matchDayIds.length > 0) {
    const { data: dayRows } = await sb
      .from("match_days")
      .select("id, match_date, venue_name")
      .in("id", matchDayIds);
    dayMap = new Map(
      ((dayRows ?? []) as MatchDayLite[]).map((d) => [d.id, d]),
    );
  }

  const active = sessions.filter((s) => s.ended_at === null);
  const past = sessions.filter((s) => s.ended_at !== null);

  return (
    <div className="space-y-8" data-testid="broadcast-v2-landing">
      <div className="flex flex-col gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Start a new session
          </div>
          <p className="mt-1 max-w-xl text-sm text-[var(--chalk-2)]">
            Sessions are minted from the v1 broadcast page (one active per match
            day). Open the v2 control room from any active or recent session
            below to drive overlays.
          </p>
        </div>
        {canTrigger ? (
          <Link
            href="/admin/broadcast"
            className="inline-flex items-center gap-2 rounded-sm border border-[var(--signal)] bg-[var(--ink-1)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--signal)] hover:bg-[rgba(107,205,6,0.08)]"
            data-testid="v2-create-link"
          >
            Open v1 → start session →
          </Link>
        ) : null}
      </div>

      <section className="space-y-3" data-testid="v2-active-sessions">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Active sessions
        </h2>
        {active.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-6 text-center text-sm text-[var(--chalk-3)]">
            No live sessions right now.
          </div>
        ) : (
          <ul className="grid gap-2">
            {active.map((s) => (
              <SessionRow key={s.id} s={s} day={dayMap.get(s.match_day_id) ?? null} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" data-testid="v2-past-sessions">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Recent sessions (last 30 days)
        </h2>
        {past.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-6 text-center text-sm text-[var(--chalk-3)]">
            No completed sessions in the last 30 days.
          </div>
        ) : (
          <ul className="grid gap-2">
            {past.map((s) => (
              <SessionRow key={s.id} s={s} day={dayMap.get(s.match_day_id) ?? null} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SessionRow({
  s,
  day,
}: {
  s: SessionRow;
  day: MatchDayLite | null;
}) {
  const live = s.ended_at === null;
  return (
    <li>
      <Link
        href={`/admin/broadcast/v2/${s.id}`}
        className="group flex items-center justify-between gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-4 py-3 transition-colors hover:border-[var(--signal)]"
        data-testid={`v2-session-${s.id}`}
      >
        <div className="flex flex-col gap-0.5">
          <div className="font-display text-sm text-[var(--chalk-0)] group-hover:text-[var(--signal)]">
            {day
              ? `${formatWat(`${day.match_date}T00:00:00Z`, "EEE MMM d")} · ${day.venue_name}`
              : "—"}
            {s.session_tag ? (
              <span className="ml-2 text-[var(--chalk-3)]">· {s.session_tag}</span>
            ) : null}
          </div>
          <div className="text-xs text-[var(--chalk-3)]">
            Started {formatWat(s.started_at, "EEE MMM d · HH:mm")}
            {s.ended_at
              ? ` · Ended ${formatWat(s.ended_at, "HH:mm")}`
              : null}
          </div>
        </div>
        <StatusPill status={live ? "live" : "ended"} />
      </Link>
    </li>
  );
}
