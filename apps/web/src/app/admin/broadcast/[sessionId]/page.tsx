import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import { formatWat } from "@/lib/time";
import {
  TEMPLATE_KEYS,
  TEMPLATE_REGISTRY,
  getTemplateRoute,
} from "@/server/overlays/registry";
import { listActiveOverlays } from "@/server/broadcast/events";
import {
  triggerOverlayAction,
  clearOverlayAction,
  endSessionAction,
} from "../actions";

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  match_day_id: string;
  session_tag: string | null;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
};

async function resolveAdmin() {
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

  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, "broadcast.manage");
  } catch (err) {
    if (err instanceof PermissionError) throw err;
    throw err;
  }
  return sb;
}

// Sensible starter payload per template so the Trigger form is one-click
// viable in the common case.
const STARTER_PAYLOADS: Record<string, Record<string, unknown>> = {
  scorebar: {
    homeName: "Home",
    awayName: "Away",
    homeScore: 0,
    awayScore: 0,
  },
  lower_third: {
    playerId: "00000000-0000-4000-8000-000000000000",
    displayName: "Player Name",
    gamerTag: "GAMER_TAG",
    jerseyNumber: 10,
  },
  standings_widget: {
    topN: 3,
    rows: [
      { rank: 1, displayName: "Anon-01", pts: 9, gd: 5 },
      { rank: 2, displayName: "Anon-02", pts: 7, gd: 2 },
      { rank: 3, displayName: "Anon-03", pts: 4, gd: 0 },
    ],
  },
  player_card: {
    playerId: "00000000-0000-4000-8000-000000000000",
    displayName: "Player Name",
    gamerTag: "GAMER_TAG",
    seasonStats: { gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
  },
  punishment_ticker: {
    items: [
      {
        playerName: "Player Name",
        sanction: "warning",
        magnitude: "-1 pt",
        issuedAt: "2026-04-20",
      },
    ],
  },
  intro: {
    matchDayLabel: "Match Day 01",
    seasonLabel: "Elite 25/26",
  },
  outro: {
    matchDayLabel: "Match Day 01",
  },
};

export default async function BroadcastSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const sb = await resolveAdmin();

  const { data: sessionRaw } = await sb
    .from("stream_sessions")
    .select(
      "id, match_day_id, session_tag, started_at, ended_at, notes",
    )
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();

  const session = sessionRaw as SessionRow | null;
  if (!session) {
    return (
      <div className="space-y-8">
        <SectionHeader
          eyebrow="Broadcast"
          title="Session not found"
          description="That stream session does not exist or has been removed."
          action={
            <Link href="/admin/broadcast">
              <SecondaryButton>Back to Broadcast</SecondaryButton>
            </Link>
          }
        />
      </div>
    );
  }

  const active = await listActiveOverlays(sb, session.id);

  const { data: matchDayRaw } = await sb
    .from("match_days")
    .select("id, match_date, venue_name")
    .eq("id", session.match_day_id)
    .maybeSingle();
  const matchDay = matchDayRaw as
    | { id: string; match_date: string; venue_name: string }
    | null;

  const isLive = session.ended_at === null;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow={`Session · ${isLive ? "LIVE" : "Ended"}`}
        title={
          <span>
            {matchDay
              ? formatWat(
                  `${matchDay.match_date}T00:00:00Z`,
                  "EEE MMM d yyyy",
                )
              : "Session"}{" "}
            · {matchDay?.venue_name ?? ""}
          </span>
        }
        description={
          <>
            Started {formatWat(session.started_at, "EEE MMM d · HH:mm")} WAT.
            Browser source URL:{" "}
            <code className="text-[var(--signal)]">
              /overlay/&lt;key&gt;?session={session.id}
            </code>
          </>
        }
        action={
          <div className="flex items-center gap-2">
            <StatusPill status={isLive ? "live" : "ended"} />
            {isLive ? (
              <form action={endSessionAction}>
                <input type="hidden" name="sessionId" value={session.id} />
                <DangerButton
                  type="submit"
                  data-testid="end-session-btn"
                >
                  End session
                </DangerButton>
              </form>
            ) : null}
            <Link href="/admin/broadcast">
              <SecondaryButton>Back</SecondaryButton>
            </Link>
          </div>
        }
      />

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left: template trigger grid (spans 2 cols) */}
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
            Trigger overlays
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {TEMPLATE_KEYS.map((key) => {
              const tpl = TEMPLATE_REGISTRY[key];
              const starter = STARTER_PAYLOADS[key] ?? {};
              return (
                <div
                  key={key}
                  className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
                  data-testid={`trigger-card-${key}`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <div className="font-display text-sm font-bold text-[var(--chalk-0)]">
                        {key
                          .split("_")
                          .map((w) => w[0].toUpperCase() + w.slice(1))
                          .join(" ")}
                      </div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                        {tpl.route}
                      </div>
                    </div>
                    <Link
                      href={`${getTemplateRoute(key)}?session=${session.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
                    >
                      Preview ↗
                    </Link>
                  </div>
                  <form action={triggerOverlayAction} className="space-y-2">
                    <input
                      type="hidden"
                      name="sessionId"
                      value={session.id}
                    />
                    <input
                      type="hidden"
                      name="templateKey"
                      value={key}
                    />
                    <textarea
                      name="payload"
                      rows={5}
                      defaultValue={JSON.stringify(starter, null, 2)}
                      data-testid={`trigger-payload-${key}`}
                      className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-2 font-mono text-[12px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
                    />
                    <div className="flex justify-end">
                      <PrimaryButton
                        type="submit"
                        size="sm"
                        disabled={!isLive}
                        data-testid={`trigger-btn-${key}`}
                      >
                        Trigger
                      </PrimaryButton>
                    </div>
                  </form>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: active overlays + controls */}
        <aside className="space-y-4">
          <div>
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
              Active overlays
            </h2>
            <div
              className="mt-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-3"
              data-testid="active-overlays"
            >
              {active.length === 0 ? (
                <div className="py-4 text-center text-xs text-[var(--chalk-3)]">
                  No active overlays
                </div>
              ) : (
                <ul className="space-y-2">
                  {active.map((o) => (
                    <li
                      key={o.id}
                      className="rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/40 p-2"
                      data-testid={`active-${o.template_key}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--signal)]">
                          {o.template_key}
                        </span>
                        <form action={clearOverlayAction}>
                          <input
                            type="hidden"
                            name="eventId"
                            value={o.id}
                          />
                          <input
                            type="hidden"
                            name="sessionId"
                            value={session.id}
                          />
                          <button
                            type="submit"
                            data-testid={`clear-${o.template_key}`}
                            className="rounded-sm border border-[rgba(255,91,59,0.45)] bg-transparent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--flare)] hover:bg-[rgba(255,91,59,0.12)]"
                          >
                            Clear
                          </button>
                        </form>
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-[var(--chalk-3)]">
                        {formatWat(o.triggered_at, "HH:mm:ss")} ·{" "}
                        {JSON.stringify(o.payload).slice(0, 60)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
