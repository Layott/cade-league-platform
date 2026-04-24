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
import { textareaClass } from "@/components/admin/FormField";
import { formatWat } from "@/lib/time";
import {
  TEMPLATE_KEYS,
  TEMPLATE_REGISTRY,
  getTemplateRoute,
  type TemplateKey,
} from "@/server/overlays/registry";
import {
  listActiveOverlays,
  getActiveForTemplate,
} from "@/server/broadcast/events";
import { listPresets } from "@/server/overlays/presets";
import { listActiveInstances } from "@/server/overlays/instances";
import { getClock } from "@/server/overlays/match_clock";
import { listSelectableMatches } from "@/server/broadcast/match_flow";
import { listUnplayedMatchesToday } from "@/server/matches/unplayed";
import {
  triggerOverlayAction,
  clearOverlayAction,
  endSessionAction,
} from "../actions";
import { STARTER_PAYLOADS } from "./starter-payloads";
import { EditableTemplatePanel } from "./EditableTemplatePanel";
import { MatchClockPanel } from "./MatchClockPanel";
import {
  MatchControlPanel,
  type CurrentMatchDigest,
} from "./MatchControlPanel";
import { YouTubeChatPanel } from "./YouTubeChatPanel";
import { PreviewIframeTrigger } from "./PreviewIframeModal";

export const dynamic = "force-dynamic";

type SessionRow = {
  id: string;
  match_day_id: string;
  session_tag: string | null;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  // Plan 42 — current-match pin (deprecated alias for primary_match_id).
  current_match_id: string | null;
  match_started_at: string | null;
  // Plan 42.1 — dual-slot match pins.
  primary_match_id: string | null;
  primary_match_started_at: string | null;
  secondary_match_id: string | null;
  secondary_match_started_at: string | null;
  // Plan 44 — YouTube live-chat binding (nullable — unbound by default).
  youtube_video_id: string | null;
  youtube_live_chat_id: string | null;
  youtube_bound_at: string | null;
  // Plan 39 M3 — per-session shared secret for unauthenticated
  // overlay endpoints. Null on pre-M3 historical rows.
  view_token: string | null;
};

/** Editable templates upgraded to the rich panel in Plan 37, extended in
 *  Plan 45 with structured forms for the most-used templates. The slot
 *  picker only appears when the template is also multi-instance. */
const EDITABLE_TEMPLATES: ReadonlyArray<TemplateKey> = [
  "lower_third",
  "score_bug",
  "up_next_bug",
  "starting_soon_timer",
  "layout_brb_full",
  "featured_comment",
];
const MULTI_INSTANCE_TEMPLATES: ReadonlySet<TemplateKey> = new Set([
  "lower_third",
]);

/** Audit Slice 1 (2026-04-24) — data-feed overlays the admin can preview
 *  via the PreviewIframeTrigger button. These 3 overlays pull LIVE data
 *  from the DB + re-fetch on Realtime signals, so a pre-push preview
 *  shows the operator exactly what will appear on-stream. */
const LIVE_DATA_PREVIEW_TEMPLATES: ReadonlySet<TemplateKey> = new Set([
  "leaderboard_animated",
  "top_scorers",
  "match_scores_day",
]);

/** Plan 42.1 — templates that render match-specific data and therefore
 *  participate in the dual-slot routing model. The trigger-card slot
 *  selector appears only for these; other templates (standings, intros,
 *  etc.) ignore slot entirely. */
const SLOT_CAPABLE_TEMPLATES: ReadonlySet<TemplateKey> = new Set([
  "score_bug",
  "lower_third",
  "up_next_bug",
  "h2h_2",
  "h2h_3",
  "h2h_5",
  "stinger_goal",
  "stinger_miss",
  "leaderboard_animated",
  "top_scorers",
  "match_scores_day",
  "orgs_roster",
  "coach_intros",
  "player_penalties",
]);

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
      "id, match_day_id, session_tag, started_at, ended_at, notes, current_match_id, match_started_at, primary_match_id, primary_match_started_at, secondary_match_id, secondary_match_started_at, youtube_video_id, youtube_live_chat_id, youtube_bound_at, view_token",
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

  // Parallel fetch: active overlays + per-template presets + multi-instance
  // active rows + match_clock state + (Plan 42) selectable matches + active
  // score_bug rows (Plan 42.1 — one per slot).
  const [
    active,
    presetsAll,
    lowerThirdInstances,
    primaryClock,
    secondaryClock,
    selectableMatches,
    primaryScoreBug,
    secondaryScoreBug,
    unplayedToday,
  ] = await Promise.all([
    listActiveOverlays(sb, session.id),
    listPresets(sb),
    listActiveInstances(sb, session.id, "lower_third"),
    getClock(sb, session.id, "primary"),
    getClock(sb, session.id, "secondary"),
    listSelectableMatches(sb, session.id, { scope: "today" }),
    getActiveForTemplate(sb, session.id, "score_bug", "primary"),
    getActiveForTemplate(sb, session.id, "score_bug", "secondary"),
    listUnplayedMatchesToday(sb, session.id),
  ]);

  const presetsByTemplate = new Map<string, typeof presetsAll>();
  for (const p of presetsAll) {
    const arr = presetsByTemplate.get(p.templateKey) ?? [];
    arr.push(p);
    presetsByTemplate.set(p.templateKey, arr);
  }

  const activeByTemplate = new Map<string, typeof active[number]>();
  for (const a of active) activeByTemplate.set(a.template_key, a);

  const { data: matchDayRaw } = await sb
    .from("match_days")
    .select("id, match_date, venue_name")
    .eq("id", session.match_day_id)
    .maybeSingle();
  const matchDay = matchDayRaw as
    | { id: string; match_date: string; venue_name: string }
    | null;

  const isLive = session.ended_at === null;
  const legacyTemplates = TEMPLATE_KEYS.filter(
    (k) => !EDITABLE_TEMPLATES.includes(k),
  );

  // Plan 42 / 42.1 — derive a digest per slot from session + live score_bug
  // rows. Each slot is independent: primary can be live with secondary idle
  // or vice versa.
  function deriveDigest(
    slot: "primary" | "secondary",
    matchId: string | null,
    bug: typeof primaryScoreBug,
  ): CurrentMatchDigest | null {
    if (!matchId) return null;
    const bugPayload = (bug?.payload ?? null) as {
      players?: Array<{ displayName: string; score: number }>;
    } | null;
    const players = bugPayload?.players ?? [];
    return {
      slot,
      matchId,
      homeDisplayName: players[0]?.displayName ?? "Home",
      awayDisplayName: players[1]?.displayName ?? "Away",
      homeScore: players[0]?.score ?? 0,
      awayScore: players[1]?.score ?? 0,
    };
  }
  const primaryDigest = deriveDigest(
    "primary",
    session.primary_match_id ?? session.current_match_id,
    primaryScoreBug,
  );
  const secondaryDigest = deriveDigest(
    "secondary",
    session.secondary_match_id,
    secondaryScoreBug,
  );

  // Plan 42 / 42.1 — pre-fill scorer default on stinger_goal from the
  // PRIMARY match's home player when a primary match is pinned. Overrides
  // the static STARTER_PAYLOADS entry for just that template. Secondary
  // goals are triggered manually via the slot selector on the trigger card.
  const starterOverrides: Record<string, Record<string, unknown>> = {};
  if (primaryDigest) {
    starterOverrides.stinger_goal = {
      scorerDisplayName: primaryDigest.homeDisplayName,
      soundSlot: "stinger-goal",
      slot: "primary",
    };
  }

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

      {/* Match control — Plan 42 / 42.1 (dual-slot side-by-side; mounted
          above clock so select/start/end is the producer's primary action). */}
      <MatchControlPanel
        sessionId={session.id}
        selectable={selectableMatches}
        primaryCurrent={primaryDigest}
        secondaryCurrent={secondaryDigest}
        isLive={isLive}
      />

      {/* Plan 44 — YouTube chat picker + Feature-on-stream. Session-scoped
          (shared across both match slots); the panel itself lets the admin
          pick primary/secondary per featured comment. */}
      <YouTubeChatPanel
        sessionId={session.id}
        initialVideoId={session.youtube_video_id}
        initialLiveChatId={session.youtube_live_chat_id}
      />

      {/* Match clocks — Plan 37 + Plan 48.1 per-instance.
          Primary clock drives /overlay/layout-timer?slot=primary.
          Secondary drives /overlay/layout-timer?slot=secondary. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <MatchClockPanel
          sessionId={session.id}
          clock={primaryClock}
          isLive={isLive}
          instanceKey="primary"
          title="Primary match clock"
        />
        <MatchClockPanel
          sessionId={session.id}
          clock={secondaryClock}
          isLive={isLive}
          instanceKey="secondary"
          title="Secondary match clock"
        />
      </div>

      {/* Editable rich panels */}
      <div className="space-y-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
          Editable templates
        </h2>
        <div className="space-y-4">
          {EDITABLE_TEMPLATES.map((key) => (
            <EditableTemplatePanel
              key={key}
              sessionId={session.id}
              templateKey={key}
              isLive={isLive}
              presets={presetsByTemplate.get(key) ?? []}
              activeInstances={
                key === "lower_third" ? lowerThirdInstances : undefined
              }
              activeSingle={
                key === "lower_third"
                  ? null
                  : activeByTemplate.get(key)
                    ? {
                        id: activeByTemplate.get(key)!.id,
                        payload: activeByTemplate.get(key)!.payload,
                        triggered_at:
                          activeByTemplate.get(key)!.triggered_at,
                      }
                    : null
              }
              multiInstance={MULTI_INSTANCE_TEMPLATES.has(key)}
              selectable={selectableMatches}
              unplayed={unplayedToday}
            />
          ))}
        </div>
      </div>

      {/* Legacy textarea grid for non-editable 23 templates */}
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
            Other overlays
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {legacyTemplates.map((key) => {
              const tpl = TEMPLATE_REGISTRY[key];
              const starter =
                starterOverrides[key] ?? STARTER_PAYLOADS[key] ?? {};
              // Plan 42.1 — match-aware templates get a slot selector that
              // flows the slot through the payload so the overlay `?slot=`
              // filter picks it up. Non-match templates skip the selector.
              const isSlotCapable = SLOT_CAPABLE_TEMPLATES.has(key);
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
                    <div className="flex items-center gap-2">
                      {LIVE_DATA_PREVIEW_TEMPLATES.has(key) ? (
                        <PreviewIframeTrigger
                          sessionId={session.id}
                          viewToken={session.view_token}
                          templateKey={key}
                        />
                      ) : null}
                      <Link
                        href={`${getTemplateRoute(key)}?session=${session.id}${session.view_token ? `&t=${session.view_token}` : ""}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
                      >
                        Preview ↗
                      </Link>
                    </div>
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
                    {isSlotCapable ? (
                      <fieldset
                        className="flex items-center gap-3 rounded-sm border border-[var(--ink-4)]/50 bg-[var(--ink-3)]/30 px-2 py-1"
                        data-testid={`trigger-slot-${key}`}
                      >
                        <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                          Slot
                        </span>
                        <label className="flex items-center gap-1 text-[10px] text-[var(--chalk-1)]">
                          <input
                            type="radio"
                            name="slot"
                            value="primary"
                            defaultChecked
                          />
                          primary
                        </label>
                        <label className="flex items-center gap-1 text-[10px] text-[var(--chalk-1)]">
                          <input
                            type="radio"
                            name="slot"
                            value="secondary"
                          />
                          secondary
                        </label>
                      </fieldset>
                    ) : null}
                    <textarea
                      name="payload"
                      rows={5}
                      defaultValue={JSON.stringify(starter, null, 2)}
                      data-testid={`trigger-payload-${key}`}
                      className={textareaClass}
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

        {/* Right: active overlays summary */}
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
                            className="rounded-sm border border-[var(--flare)]/45 bg-transparent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--flare)] hover:bg-[var(--flare)]/12"
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
