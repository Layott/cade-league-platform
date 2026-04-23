import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { StatusPill } from "@/components/admin/StatusPill";
import { STARTER_PAYLOADS } from "../[sessionId]/starter-payloads";
import { listSessions } from "@/server/broadcast/sessions";
import { triggerOverlayAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Plan 47 — consolidated stinger panel.
 *
 * Six stingers surface as large trigger buttons in a responsive grid.
 * Each button posts to `triggerOverlayAction` with the matching
 * STARTER_PAYLOADS entry. Requires an active session; if none exists,
 * the page invites the admin back to `/admin/broadcast`.
 */

const STINGERS: Array<{
  key: string;
  label: string;
  description: string;
  accent: string;
}> = [
  {
    key: "stinger_intro",
    label: "Intro",
    description: "Long-form show opener — use once at broadcast start.",
    accent: "rgba(107,205,6,0.12)",
  },
  {
    key: "stinger_normal",
    label: "Normal",
    description: "Generic mid-show bridge sting.",
    accent: "rgba(86,183,255,0.12)",
  },
  {
    key: "stinger_replay",
    label: "Replay",
    description: "Transition into or out of a replay clip.",
    accent: "rgba(255,176,32,0.12)",
  },
  {
    key: "stinger_goal",
    label: "Goal",
    description: "Fire immediately after a goal — scorer name required.",
    accent: "rgba(107,205,6,0.18)",
  },
  {
    key: "stinger_miss",
    label: "Miss",
    description: "For near-misses / crossbar-rattlers.",
    accent: "rgba(254,3,109,0.12)",
  },
  {
    key: "stinger_winner",
    label: "Winner",
    description: "Match/day winner reveal — gets the champion payload.",
    accent: "rgba(171,130,255,0.14)",
  },
];

async function resolveAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/broadcast/stingers");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/broadcast/stingers");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(
      sb,
      { userId: pub.id, roles },
      "broadcast.trigger",
    );
  } catch (e) {
    if (e instanceof PermissionError) throw e;
    throw e;
  }
  return sb;
}

async function findAnyActiveSessionId(
  sb: Awaited<ReturnType<typeof resolveAdmin>>,
): Promise<string | null> {
  const { data } = await sb
    .from("stream_sessions")
    .select("id")
    .is("ended_at", null)
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  return (data?.[0] as { id: string } | undefined)?.id ?? null;
}

export default async function StingersPanelPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const sb = await resolveAdmin();
  const sp = await searchParams;

  let sessionId = sp.sessionId ?? "";
  if (!sessionId) {
    sessionId = (await findAnyActiveSessionId(sb)) ?? "";
  }

  // Also list recent sessions for context.
  const { data: recentRaw } = await sb
    .from("stream_sessions")
    .select("id, session_tag, started_at, ended_at")
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(5);
  const recent = (recentRaw ?? []) as Array<{
    id: string;
    session_tag: string | null;
    started_at: string;
    ended_at: string | null;
  }>;
  void listSessions; // keep the import under lint even if unused

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Broadcast"
        title="Stingers"
        description="One-click transition clips. Active session auto-selected; use the session picker below to switch targets."
        action={
          <Link href="/admin/broadcast">
            <SecondaryButton>All sessions →</SecondaryButton>
          </Link>
        }
      />

      {sessionId ? (
        <div
          className="flex items-center justify-between rounded-sm border border-[var(--primary)] bg-[rgba(107,205,6,0.06)] p-4"
          data-testid="active-session-banner"
        >
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--signal)]">
              Target session
            </div>
            <div className="mt-1 font-mono text-sm text-[var(--chalk-0)]">
              {sessionId}
            </div>
          </div>
          <StatusPill tone="signal">live</StatusPill>
        </div>
      ) : (
        <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] p-6 text-center text-xs text-[var(--chalk-3)]">
          No active stream session. Open /admin/broadcast, start a session,
          then come back here.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STINGERS.map((s) => {
          const payload = STARTER_PAYLOADS[s.key] ?? {};
          return (
            <form
              key={s.key}
              action={triggerOverlayAction}
              className="flex flex-col rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 transition-colors hover:border-[var(--signal)]"
              style={{ backgroundImage: `linear-gradient(180deg, ${s.accent} 0%, transparent 100%)` }}
            >
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="templateKey" value={s.key} />
              <input
                type="hidden"
                name="payload"
                value={JSON.stringify(payload)}
              />

              <div className="flex-1">
                <div className="font-display text-lg font-bold uppercase tracking-[0.12em] text-[var(--chalk-0)]">
                  {s.label}
                </div>
                <div className="mt-1 font-mono text-[11px] text-[var(--chalk-3)]">
                  {s.key}
                </div>
                <p className="mt-3 text-xs text-[var(--chalk-2)] leading-relaxed">
                  {s.description}
                </p>
              </div>

              <div className="mt-5">
                <PrimaryButton
                  type="submit"
                  disabled={!sessionId}
                  data-testid={`trigger-${s.key}`}
                >
                  Fire
                </PrimaryButton>
              </div>
            </form>
          );
        })}
      </section>

      {recent.length > 0 ? (
        <section>
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
            Recent sessions
          </h2>
          <ul className="space-y-1 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex justify-between rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-2">
                <span className="font-mono text-[12px] text-[var(--chalk-1)]">
                  {r.id.slice(0, 8)} · {r.session_tag ?? "untagged"}
                </span>
                <Link
                  href={`/admin/broadcast/stingers?sessionId=${r.id}`}
                  className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)] hover:text-[var(--signal)]"
                >
                  Target →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
